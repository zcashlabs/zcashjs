import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWalletClient, defineNetwork } from '@zcashlabs/zcash.js';
import { encryptStorage, checkUnencryptedStorage } from '../../dist/src/runtime/encrypted-storage.js';

// In-memory stand-in for the Linux filesystem host. Each handle addresses one named file.
function memoryHost(files = new Map()) {
  let next = 1;
  const handles = new Map();
  const host = {
    files,
    owned: true,
    open(path, make) {
      if (!files.has(path)) {
        if (!make) throw Object.assign(Error('missing'), { code: 'ENOENT' });
        files.set(path, new Uint8Array(0));
      }
      const handle = next++;
      handles.set(handle, path);
      return handle;
    },
    close(handle) { handles.delete(handle); },
    read(handle, target, at) {
      const data = files.get(handles.get(handle));
      const count = Math.max(0, Math.min(target.length, data.length - at));
      target.set(data.subarray(at, at + count));
      return count;
    },
    write(handle, source, at) {
      const path = handles.get(handle);
      let data = files.get(path);
      if (at + source.length > data.length) {
        const grown = new Uint8Array(at + source.length);
        grown.set(data);
        data = grown;
      }
      data.set(source, at);
      files.set(path, data);
      return source.length;
    },
    truncate(handle, size) {
      const path = handles.get(handle), data = files.get(path);
      const next = new Uint8Array(size);
      next.set(data.subarray(0, Math.min(size, data.length)));
      files.set(path, next);
    },
    sync() {},
    size(handle) { return files.get(handles.get(handle)).length; },
    delete(path) { files.delete(path); },
    access(path) { return files.has(path); },
    release() { host.owned = false; },
  };
  return host;
}

const key = () => crypto.randomBytes(32);
const random = n => new Uint8Array(crypto.randomBytes(n));

function check(wrapped, handle, model) {
  assert.equal(wrapped.size(handle), model.length);
  const out = new Uint8Array(model.length + 100);
  const count = wrapped.read(handle, out, 0);
  assert.equal(count, model.length);
  assert.deepEqual(out.subarray(0, count), model);
}

function write(model, source, at) {
  const end = Math.max(model.length, at + source.length);
  const next = new Uint8Array(end);
  next.set(model);
  next.set(source, at);
  return next;
}

for (const path of ['wallet.db', 'wallet.db-journal']) {
  test(`${path}: random writes, truncation and reopen match a plaintext model`, () => {
    const master = key(), host = memoryHost();
    let wrapped = encryptStorage(host, crypto, master);
    let handle = wrapped.open(path, true, false);
    let model = new Uint8Array(0);
    const rng = (n) => crypto.randomInt(n);
    for (let step = 0; step < 300; step++) {
      const choice = rng(10);
      if (choice < 7) {
        const at = rng(Math.max(1, model.length + 9000));
        const data = random(1 + rng(9000));
        wrapped.write(handle, data, at);
        model = write(model, data, at);
      } else if (choice < 9) {
        const size = rng(model.length + 1);
        wrapped.truncate(handle, size);
        model = model.slice(0, size);
      } else {
        wrapped.close(handle);
        wrapped.release();
        host.owned = true;
        wrapped = encryptStorage(host, crypto, master);
        handle = wrapped.open(path, false, false);
      }
      check(wrapped, handle, model);
    }
    wrapped.close(handle);
  });
}

test('ciphertext never contains written plaintext and the SQLite header is hidden', () => {
  const host = memoryHost(), wrapped = encryptStorage(host, crypto, key());
  const marker = new TextEncoder().encode('SQLite format 3\0-marker-0123456789');
  const page = new Uint8Array(4096);
  page.set(marker, 0);
  for (const path of ['wallet.db', 'wallet.db-journal']) {
    const handle = wrapped.open(path, true, false);
    wrapped.write(handle, page, 0);
    wrapped.write(handle, page, 4096);
    wrapped.close(handle);
    assert.equal(Buffer.from(host.files.get(path)).indexOf(Buffer.from(marker.subarray(0, 16))), -1);
  }
});

test('admission rejects a wrong key, a plaintext database and encrypted files without a key', () => {
  const host = memoryHost(), master = key();
  const wrapped = encryptStorage(host, crypto, master);
  const handle = wrapped.open('wallet.db', true, false);
  wrapped.write(handle, random(4096), 0);
  wrapped.close(handle);
  assert.throws(() => encryptStorage(host, crypto, key()), { message: 'STORAGE_KEY_MISMATCH' });
  assert.throws(() => checkUnencryptedStorage(host), { message: 'STORAGE_KEY_MISMATCH' });
  assert.equal(encryptStorage(host, crypto, master).owned, true);

  const plain = memoryHost(new Map([['wallet.db', new TextEncoder().encode('SQLite format 3\0' + 'x'.repeat(100))]]));
  assert.throws(() => encryptStorage(plain, crypto, master), { message: 'STORAGE_KEY_MISMATCH' });
  assert.equal(checkUnencryptedStorage(plain), plain);
  assert.throws(() => encryptStorage(memoryHost(), crypto, new Uint8Array(31)), { message: 'INVALID_ARGUMENT' });
});

test('a torn journal append keeps every earlier frame and later appends follow the valid tail', () => {
  const host = memoryHost(), master = key();
  let wrapped = encryptStorage(host, crypto, master);
  let handle = wrapped.open('wallet.db-journal', true, false);
  const first = random(5000), second = random(3000);
  wrapped.write(handle, first, 0);
  const durable = host.files.get('wallet.db-journal').length;
  wrapped.write(handle, second, first.length);
  wrapped.close(handle);
  // Simulate a crash during the second append.
  host.files.set('wallet.db-journal', host.files.get('wallet.db-journal').slice(0, durable + 1000));
  wrapped = encryptStorage(host, crypto, master);
  handle = wrapped.open('wallet.db-journal', false, false);
  check(wrapped, handle, first);
  assert.equal(host.files.get('wallet.db-journal').length, durable, 'unauthenticated tail removed');
  const third = random(10);
  wrapped.write(handle, third, first.length);
  check(wrapped, handle, write(first, third, first.length));
  wrapped.close(handle);
});

test('database blocks are authenticated; a torn tail without ciphertext is ignored', () => {
  const host = memoryHost(), master = key();
  let wrapped = encryptStorage(host, crypto, master);
  let handle = wrapped.open('wallet.db', true, false);
  const data = random(8192);
  wrapped.write(handle, data, 0);
  wrapped.close(handle);
  const stored = host.files.get('wallet.db');
  host.files.set('wallet.db', Uint8Array.from([...stored, ...random(20)]));
  wrapped = encryptStorage(host, crypto, master);
  handle = wrapped.open('wallet.db', false, false);
  check(wrapped, handle, data);
  wrapped.close(handle);

  const tampered = Uint8Array.from(stored);
  tampered[64 + 4124 + 100] ^= 1;
  host.files.set('wallet.db', tampered);
  wrapped = encryptStorage(host, crypto, master);
  handle = wrapped.open('wallet.db', false, false);
  const out = new Uint8Array(4096);
  assert.equal(wrapped.read(handle, out, 0), 4096);
  assert.throws(() => wrapped.read(handle, out, 4096), error => error.code === 'EIO');
  wrapped.close(handle);
});

test('encrypted Linux wallet reopens with its key and rejects missing or wrong keys', async t => {
  if (process.platform !== 'linux') return t.skip('persistent wallet storage requires Linux');
  const root = await mkdtemp(join(tmpdir(), 'zcash-encrypted-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'wallet');
  const fixture = JSON.parse(await readFile(new URL('../fixtures/wallet/bundle/tests/views-fixture.json', import.meta.url)));
  const network = await defineNetwork({ identity: 'encrypted-test', genesisHash: '03'.repeat(32),
    parametersFormat: 'zcash-js-network/1', parameters: new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}') });
  const master = key();
  const open = encryptionKey => createWalletClient('https://offline.invalid', { network,
    storage: { kind: 'node-filesystem', path, ...(encryptionKey ? { encryptionKey } : {}) } });
  const callerKey = Uint8Array.from(master);
  const wallet = await open(callerKey);
  callerKey.fill(0); // the SDK keeps its own copy
  let account;
  try {
    account = await wallet.accounts.import({ ...fixture.import, birthday: 'fullScan' });
  } finally { await wallet.close(); }

  for (const name of await readdir(path)) {
    const bytes = await readFile(join(path, name));
    assert.equal(bytes.indexOf(Buffer.from('SQLite format 3')), -1, `${name} is encrypted`);
  }
  const reopened = await open(Uint8Array.from(master));
  try {
    assert.deepEqual(await reopened.accounts.get({ accountId: account.id }), account);
  } finally { await reopened.close(); }
  await assert.rejects(open(key()), { code: 'STORAGE_KEY_MISMATCH' });
  await assert.rejects(open(undefined), { code: 'STORAGE_KEY_MISMATCH' });
  await assert.rejects(createWalletClient('https://offline.invalid', { network,
    storage: { kind: 'node-filesystem', path, encryptionKey: new Uint8Array(16) } }), { code: 'INVALID_ARGUMENT' });
});
