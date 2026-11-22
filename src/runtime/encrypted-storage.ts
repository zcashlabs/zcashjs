// Authenticated at-rest encryption for the Node filesystem wallet host.
//
// The wrapper sits between the bundled SQLite VFS (storage-host scalar ABI) and the
// Linux filesystem host. Only two files exist: `wallet.db` (rollback database) and
// `wallet.db-journal` (TRUNCATE-mode rollback journal). SQLite runs with
// synchronous=FULL, a 4096-byte sector size and no device atomicity guarantees.
//
// wallet.db uses fixed 4096-byte plaintext blocks. Each block is stored as
// nonce || ciphertext || tag (AES-256-GCM, random 96-bit nonce, block index as AAD).
// Database writes are page-aligned and SQLite journals every page in a 4096-byte
// sector, so a torn block write is always restored by hot-journal rollback.
//
// wallet.db-journal is an append-only log of authenticated frames. A write never
// rewrites bytes that an earlier write produced, so a torn append cannot damage
// journal content that SQLite already synced. Frames carry a sequence number in
// their AAD; parsing stops at the first frame that does not authenticate.
//
// Each file has a random 32-byte salt in its header. The file key is
// HKDF-SHA256(master, salt). A truncated HMAC over the salt detects a wrong key
// before SQLite reads any page.

import type * as NodeCrypto from 'node:crypto';

type Handle = unknown;
export interface StorageBackend {
  readonly owned: boolean;
  open(path: string, make: boolean, readOnly: boolean): Handle;
  close(handle: Handle): void;
  read(handle: Handle, target: Uint8Array, at: number): number;
  write(handle: Handle, source: Uint8Array, at: number): number;
  truncate(handle: Handle, size: number): void;
  sync(handle: Handle, flags?: number): void;
  size(handle: Handle): number;
  delete(path: string, sync: boolean): void;
  access(path: string, flags: number): boolean;
  release(): void;
}
type Crypto = Pick<typeof NodeCrypto, 'createCipheriv' | 'createDecipheriv' | 'randomFillSync'
  | 'hkdfSync' | 'createHmac' | 'timingSafeEqual'>;

export const ENCRYPTION_KEY_BYTES = 32;
const MAGIC = new TextEncoder().encode('ZJSWENC1');
const HEADER = 64,
  SALT_AT = 16,
  CHECK_AT = 48,
  CHECK = 16;
const BLOCK = 4096,
  NONCE = 12,
  TAG = 16,
  FRAME = BLOCK + NONCE + TAG;
const LOG_FRAME_HEADER = 16;
const KIND = { 'wallet.db': 1, 'wallet.db-journal': 2 } as const;
type Path = keyof typeof KIND;
const SQLITE_MAGIC = new TextEncoder().encode('SQLite format 3\0');

export const KEY_MISMATCH = 'STORAGE_KEY_MISMATCH';
const ioError = (message: string) => Object.assign(Error(message), { code: 'EIO' });
const mismatch = () => Error(KEY_MISMATCH);

function kindOf(path: string): 1 | 2 {
  if (!Object.hasOwn(KIND, path)) throw Object.assign(Error('unsupported path'), { code: 'EINVAL' });
  return KIND[path as Path];
}

function readFully(backend: StorageBackend, handle: Handle, target: Uint8Array, at: number) {
  let done = 0;
  while (done < target.length) {
    const count = backend.read(handle, target.subarray(done), at + done);
    if (!Number.isInteger(count) || count < 0 || count > target.length - done) throw ioError('read bounds');
    if (count === 0) break;
    done += count;
  }
  return done;
}
function writeFully(backend: StorageBackend, handle: Handle, source: Uint8Array, at: number) {
  let done = 0;
  while (done < source.length) {
    const count = backend.write(handle, source.subarray(done), at + done);
    if (!Number.isInteger(count) || count <= 0 || count > source.length - done) throw ioError('write bounds');
    done += count;
  }
}
const le64 = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
};
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

class Keys {
  constructor(private readonly crypto: Crypto, private readonly master: Uint8Array) {}
  check(kind: number, salt: Uint8Array) {
    const mac = this.crypto.createHmac('sha256', this.master);
    mac.update(new TextEncoder().encode('zcash.js wallet storage check v1'));
    mac.update(Uint8Array.of(kind));
    mac.update(salt);
    return new Uint8Array(mac.digest().subarray(0, CHECK));
  }

  fileKey(kind: number, salt: Uint8Array) {
    return new Uint8Array(this.crypto.hkdfSync('sha256', this.master, salt,
      new TextEncoder().encode(`zcash.js wallet storage v1/${kind}`), 32));
  }

  header(kind: number) {
    const header = new Uint8Array(HEADER);
    header.set(MAGIC, 0);
    header[8] = kind;
    const salt = header.subarray(SALT_AT, SALT_AT + 32);
    this.crypto.randomFillSync(salt);
    header.set(this.check(kind, salt), CHECK_AT);
    return { header, key: this.fileKey(kind, salt) };
  }

  /** Validates a complete header and returns its file key. */
  admit(kind: number, header: Uint8Array) {
    if (!equal(header.subarray(0, 8), MAGIC)) throw mismatch();
    if (header[8] !== kind || header.subarray(9, SALT_AT).some(byte => byte !== 0)) throw ioError('header');
    const salt = header.subarray(SALT_AT, SALT_AT + 32);
    const check = header.subarray(CHECK_AT, CHECK_AT + CHECK);
    if (!this.crypto.timingSafeEqual(check, this.check(kind, salt))) throw mismatch();
    return this.fileKey(kind, salt);
  }

  seal(key: Uint8Array, plain: Uint8Array, aad: Uint8Array, out: Uint8Array) {
    const nonce = out.subarray(0, NONCE);
    this.crypto.randomFillSync(nonce);
    const cipher = this.crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG });
    cipher.setAAD(aad);
    const body = cipher.update(plain);
    const final = cipher.final();
    out.set(body, NONCE);
    out.set(final, NONCE + body.length);
    out.set(cipher.getAuthTag(), NONCE + plain.length);
    body.fill(0);
  }

  /** Returns plaintext, or undefined when the sealed bytes do not authenticate. */
  open(key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array | undefined {
    const length = sealed.length - NONCE - TAG;
    if (length < 0) return undefined;
    try {
      const nonce = sealed.subarray(0, NONCE);
      const decipher = this.crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG });
      decipher.setAAD(aad);
      decipher.setAuthTag(sealed.subarray(NONCE + length));
      const body = decipher.update(sealed.subarray(NONCE, NONCE + length));
      const final = decipher.final();
      const plain = new Uint8Array(length);
      plain.set(body, 0);
      plain.set(final, body.length);
      body.fill(0);
      return plain;
    } catch {
      return undefined;
    }
  }
}

interface EncryptedFile {
  readonly handle: Handle;
  readonly readOnly: boolean;
  read(target: Uint8Array, at: number): number;
  write(source: Uint8Array, at: number): void;
  truncate(size: number): void;
  size(): number;
  dispose(): void;
}

/** Fixed-size authenticated blocks for the rollback database. */
class PageFile implements EncryptedFile {
  private key: Uint8Array | undefined;
  private length = 0; // logical bytes
  constructor(private readonly backend: StorageBackend, private readonly keys: Keys,
    readonly handle: Handle, readonly readOnly: boolean) {
    const physical = backend.size(handle);
    if (physical === 0) return;
    if (physical < HEADER) throw ioError('truncated header');
    const header = new Uint8Array(HEADER);
    if (readFully(backend, handle, header, 0) !== HEADER) throw ioError('truncated header');
    this.key = keys.admit(KIND['wallet.db'], header);
    const body = physical - HEADER,
      blocks = Math.floor(body / FRAME),
      tail = body % FRAME;
    // A tail without room for any ciphertext is an interrupted append; ignore it.
    this.length = blocks * BLOCK + (tail > NONCE + TAG ? tail - NONCE - TAG : 0);
  }

  size() {
    return this.length;
  }

  private blockLength(index: number) {
    return Math.min(BLOCK, Math.max(0, this.length - index * BLOCK));
  }

  private readBlock(index: number): Uint8Array {
    const length = this.blockLength(index);
    if (length === 0) return new Uint8Array(0);
    const sealed = new Uint8Array(length + NONCE + TAG);
    const count = readFully(this.backend, this.handle, sealed, HEADER + index * FRAME);
    if (count !== sealed.length) throw ioError('short block');
    const plain = this.keys.open(this.key!, sealed, le64(index));
    if (!plain) throw ioError('block authentication failed');
    return plain;
  }

  private writeBlock(index: number, plain: Uint8Array) {
    if (!this.key) {
      const { header, key } = this.keys.header(KIND['wallet.db']);
      writeFully(this.backend, this.handle, header, 0);
      this.key = key;
    }
    const sealed = new Uint8Array(plain.length + NONCE + TAG);
    this.keys.seal(this.key, plain, le64(index), sealed);
    writeFully(this.backend, this.handle, sealed, HEADER + index * FRAME);
  }

  read(target: Uint8Array, at: number) {
    const end = Math.min(at + target.length, this.length);
    let done = 0;
    for (let position = at; position < end;) {
      const index = Math.floor(position / BLOCK),
        offset = position - index * BLOCK;
      const plain = this.readBlock(index);
      const count = Math.min(plain.length - offset, end - position);
      target.set(plain.subarray(offset, offset + count), position - at);
      plain.fill(0);
      position += count;
      done += count;
    }
    return done;
  }

  write(source: Uint8Array, at: number) {
    // Writing beyond the end first extends the file with zero bytes.
    while (this.length < at) {
      const gap = Math.min(at - this.length, BLOCK - this.length % BLOCK);
      this.write(new Uint8Array(gap), this.length);
    }
    const end = at + source.length;
    for (let position = at; position < end;) {
      const index = Math.floor(position / BLOCK),
        start = index * BLOCK;
      const from = position - start,
        to = Math.min(end, start + BLOCK) - start;
      const existing = this.blockLength(index);
      let plain: Uint8Array;
      if (from === 0 && to >= existing) {
        plain = source.subarray(position - at, position - at + to);
      } else {
        plain = new Uint8Array(Math.max(existing, to));
        if (existing) {
          const old = this.readBlock(index);
          plain.set(old);
          old.fill(0);
        }
        plain.set(source.subarray(position - at, position - at + to - from), from);
      }
      this.writeBlock(index, plain);
      if (plain.buffer !== source.buffer) plain.fill(0);
      this.length = Math.max(this.length, start + plain.length);
      position = start + to;
    }
  }

  truncate(size: number) {
    if (size >= this.length) {
      if (size > this.length) this.write(new Uint8Array(0), size);
      return;
    }
    const blocks = Math.floor(size / BLOCK),
      rest = size % BLOCK;
    if (rest) {
      const old = this.readBlock(blocks);
      this.writeBlock(blocks, old.subarray(0, rest));
      old.fill(0);
      this.backend.truncate(this.handle, HEADER + blocks * FRAME + NONCE + rest + TAG);
    } else {
      this.backend.truncate(this.handle, this.key ? HEADER + blocks * FRAME : 0);
    }
    this.length = size;
  }

  dispose() {
    this.key?.fill(0);
    this.key = undefined;
  }
}

/** Append-only authenticated frames for the rollback journal. */
class LogFile implements EncryptedFile {
  private key: Uint8Array | undefined;
  private data = new Uint8Array(0);
  private length = 0;
  private end = 0; // physical end of the last authenticated frame
  private sequence = 0;
  constructor(private readonly backend: StorageBackend, private readonly keys: Keys,
    readonly handle: Handle, readonly readOnly: boolean) {
    const physical = backend.size(handle);
    if (physical === 0) return;
    if (physical < HEADER) {
      // An interrupted first header write: no frame was ever durable.
      if (!readOnly) backend.truncate(handle, 0);
      return;
    }
    const bytes = new Uint8Array(physical);
    if (readFully(backend, handle, bytes, 0) !== physical) throw ioError('short journal');
    try {
      this.key = keys.admit(KIND['wallet.db-journal'], bytes.subarray(0, HEADER));
      this.end = HEADER;
      while (this.end + LOG_FRAME_HEADER + NONCE + TAG <= physical) {
        const view = new DataView(bytes.buffer, this.end, LOG_FRAME_HEADER);
        const length = view.getUint32(0, true),
          flags = view.getUint32(4, true);
        const offset = Number(view.getBigUint64(8, true));
        if (flags > 1 || (flags === 1 && length !== 0) || !Number.isSafeInteger(offset)) break;
        const frameEnd = this.end + LOG_FRAME_HEADER + NONCE + length + TAG;
        if (frameEnd > physical) break;
        const plain = this.keys.open(this.key,
          bytes.subarray(this.end + LOG_FRAME_HEADER, frameEnd),
          this.aad(bytes.subarray(this.end, this.end + LOG_FRAME_HEADER)));
        if (!plain) break;
        if (flags === 1) this.resize(offset);
        else this.place(plain, offset);
        plain.fill(0);
        this.sequence++;
        this.end = frameEnd;
      }
    } finally {
      bytes.fill(0);
    }
    // Drop an unauthenticated tail so later appends follow the last valid frame.
    if (this.end < physical && !readOnly) backend.truncate(handle, this.end);
  }

  private aad(header: Uint8Array) {
    const aad = new Uint8Array(LOG_FRAME_HEADER + 8);
    aad.set(header);
    aad.set(le64(this.sequence), LOG_FRAME_HEADER);
    return aad;
  }

  private reserve(size: number) {
    if (size <= this.data.length) return;
    const next = new Uint8Array(Math.max(size, this.data.length * 2, BLOCK));
    next.set(this.data.subarray(0, this.length));
    this.data.fill(0);
    this.data = next;
  }

  private resize(size: number) {
    this.reserve(size);
    if (size < this.length) this.data.fill(0, size, this.length);
    this.length = size;
  }

  private place(plain: Uint8Array, offset: number) {
    this.reserve(offset + plain.length);
    this.data.set(plain, offset);
    this.length = Math.max(this.length, offset + plain.length);
  }

  private append(flags: 0 | 1, offset: number, plain: Uint8Array) {
    if (!this.key) {
      const { header, key } = this.keys.header(KIND['wallet.db-journal']);
      writeFully(this.backend, this.handle, header, 0);
      this.key = key;
      this.end = HEADER;
      this.sequence = 0;
    }
    const frame = new Uint8Array(LOG_FRAME_HEADER + NONCE + plain.length + TAG);
    const view = new DataView(frame.buffer);
    view.setUint32(0, plain.length, true);
    view.setUint32(4, flags, true);
    view.setBigUint64(8, BigInt(offset), true);
    this.keys.seal(this.key, plain, this.aad(frame.subarray(0, LOG_FRAME_HEADER)), frame.subarray(LOG_FRAME_HEADER));
    writeFully(this.backend, this.handle, frame, this.end);
    this.end += frame.length;
    this.sequence++;
  }

  size() {
    return this.length;
  }

  read(target: Uint8Array, at: number) {
    const count = Math.max(0, Math.min(target.length, this.length - at));
    target.set(this.data.subarray(at, at + count));
    return count;
  }

  write(source: Uint8Array, at: number) {
    this.append(0, at, source);
    this.place(source, at);
  }

  truncate(size: number) {
    if (size === 0) {
      this.backend.truncate(this.handle, 0);
      this.key?.fill(0);
      this.key = undefined;
      this.end = 0;
      this.sequence = 0;
      this.resize(0);
      return;
    }
    if (size === this.length) return;
    this.append(1, size, new Uint8Array(0));
    this.resize(size);
  }

  dispose() {
    this.key?.fill(0);
    this.key = undefined;
    this.data.fill(0);
    this.data = new Uint8Array(0);
    this.length = 0;
  }
}

function readHeader(backend: StorageBackend, path: Path) {
  if (!backend.access(path, 0)) return undefined;
  const handle = backend.open(path, false, true);
  try {
    const size = backend.size(handle);
    const header = new Uint8Array(Math.min(size, HEADER));
    readFully(backend, handle, header, 0);
    return header;
  } finally {
    backend.close(handle);
  }
}

/** Rejects a database whose encryption does not match the supplied option before SQLite opens it. */
export function checkUnencryptedStorage(backend: StorageBackend) {
  for (const path of Object.keys(KIND) as Path[]) {
    const header = readHeader(backend, path);
    if (header && header.length >= 8 && equal(header.subarray(0, 8), MAGIC)) throw mismatch();
  }
  return backend;
}

/** Wraps an owned filesystem backend. The caller's key copy is not retained. */
export function encryptStorage(backend: StorageBackend, crypto: Crypto, master: Uint8Array): StorageBackend {
  if (!(master instanceof Uint8Array) || master.length !== ENCRYPTION_KEY_BYTES) throw Error('INVALID_ARGUMENT');
  const keys = new Keys(crypto, Uint8Array.from(master));
  // Admission: wrong keys and plaintext databases fail before SQLite reads anything.
  for (const path of Object.keys(KIND) as Path[]) {
    const header = readHeader(backend, path);
    if (!header || header.length === 0) continue;
    const sqlite = header.length >= SQLITE_MAGIC.length && equal(header.subarray(0, SQLITE_MAGIC.length), SQLITE_MAGIC);
    if (sqlite) throw mismatch();
    if (header.length < HEADER) {
      if (path === 'wallet.db') throw ioError('truncated header');
      continue;
    }
    keys.admit(kindOf(path), header);
  }
  const files = new Map<Handle, EncryptedFile>();
  const file = (handle: Handle) => {
    const found = files.get(handle);
    if (!found) throw ioError('unknown handle');
    return found;
  };
  const wrapped: StorageBackend = {
    get owned() {
      return backend.owned;
    },
    open(path, make, readOnly) {
      const kind = kindOf(path);
      const handle = backend.open(path, make, readOnly);
      try {
        files.set(handle, kind === 1
          ? new PageFile(backend, keys, handle, readOnly)
          : new LogFile(backend, keys, handle, readOnly));
      } catch (error) {
        backend.close(handle);
        throw error;
      }
      return handle;
    },
    close(handle) {
      const found = file(handle);
      try {
        backend.close(handle);
      } finally {
        found.dispose();
        files.delete(handle);
      }
    },
    read(handle, target, at) {
      return file(handle).read(target, at);
    },
    write(handle, source, at) {
      const found = file(handle);
      if (found.readOnly) throw Object.assign(Error('read-only'), { code: 'EACCES' });
      found.write(source, at);
      return source.length;
    },
    truncate(handle, size) {
      file(handle).truncate(size);
    },
    sync(handle, flags) {
      file(handle);
      backend.sync(handle, flags);
    },
    size(handle) {
      return file(handle).size();
    },
    delete(path, sync) {
      kindOf(path);
      backend.delete(path, sync);
    },
    access(path, flags) {
      return backend.access(path, flags);
    },
    release() {
      for (const found of files.values()) found.dispose();
      files.clear();
      backend.release();
    },
  };
  return wrapped;
}
