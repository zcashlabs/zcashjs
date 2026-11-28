// Native binding shim: the generated wasm-bindgen `bindings.js` interface over the
// zakura-bindings-native C ABI. Values and errors follow wasm-bindgen exactly:
// Err(String) is thrown as a JS string, JsError as an Error, a trap/panic as a
// non-string Error (which the glue treats as an invalid runtime).
//
// transport = {
//   call(runtime, name, args: Uint8Array): Uint8Array            // synchronous
//   start?(runtime, name, args): Promise<Uint8Array>             // owner-thread async
//   createRuntime(): number, destroyRuntime(id): void
// }
const encoder = new TextEncoder();
// Created on first use: React Native installs a TextDecoder fallback after module load.
let decoder;
const OK = 0, ERROR = 1, FATAL = 2, ERROR_OBJECT = 4;

class Writer {
  constructor() { this.chunks = []; this.length = 0; }
  push(bytes) { this.chunks.push(bytes); this.length += bytes.length; }
  u32(tag, n) { const b = new Uint8Array(5); b[0] = tag; new DataView(b.buffer).setUint32(1, n, true); this.push(b); }
  value(v) {
    if (v === undefined || v === null) this.push(Uint8Array.of(0));
    else if (typeof v === 'number') {
      if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new TypeError('INVALID_ARGUMENT');
      this.u32(1, v);
    } else if (typeof v === 'string') { const s = encoder.encode(v); this.u32(2, s.length); this.push(s); }
    else if (v instanceof Uint8Array) { this.u32(3, v.length); this.push(v.slice()); }
    else if (typeof v === 'boolean') this.push(Uint8Array.of(4, v ? 1 : 0));
    else if (v && typeof v === 'object' && handles.has(v)) {
      const id = handles.get(v);
      // Same error wasm-bindgen raises for a freed object.
      if (id === 0n) throw new Error('null pointer passed to rust');
      const b = new Uint8Array(9); b[0] = 5; new DataView(b.buffer).setBigUint64(1, id, true); this.push(b);
    } else throw new TypeError('INVALID_ARGUMENT');
  }
  bytes() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
export function encodeArgs(args) {
  const w = new Writer();
  for (const a of args) w.value(a);
  return w.bytes();
}

function readValue(bytes, at) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = bytes[at];
  switch (tag) {
    case 0: return undefined;
    case 1: return view.getUint32(at + 1, true);
    case 2: { const n = view.getUint32(at + 1, true); return (decoder ??= new TextDecoder('utf-8', { fatal: true })).decode(bytes.subarray(at + 5, at + 5 + n)); }
    case 3: { const n = view.getUint32(at + 1, true); return bytes.slice(at + 5, at + 5 + n); }
    case 4: return bytes[at + 1] === 1;
    case 5: return { handle: view.getBigUint64(at + 1, true) };
    default: throw new Error('PROTOCOL_MISMATCH');
  }
}
/** Decode a result buffer: return the value or throw like wasm-bindgen. */
export function decodeResult(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2) throw new Error('PROTOCOL_MISMATCH');
  const value = readValue(bytes, 1);
  switch (bytes[0]) {
    case OK: return value;
    case ERROR: throw value; // string code, exactly as wasm-bindgen throws Err(String)
    case ERROR_OBJECT: throw new Error(value);
    case FATAL: throw new Error(typeof value === 'string' ? value : 'RUNTIME_PANIC');
    default: throw new Error('PROTOCOL_MISMATCH');
  }
}

// Native objects (wasm-bindgen classes) carry a native handle; free() releases it.
// A detached token object stands for the handle when finalizing (the instance is gone).
const handles = new WeakMap();

/** Stateless exports with the generated bindings.js names. */
export function createStatelessBindings(transport) {
  const call = (name, ...args) => decodeResult(transport.call(0, name, encodeArgs(args)));
  const release = token => { try { transport.call(0, 'free', encodeArgs([token])); } catch { /* best effort */ } };
  const registry = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry(release) : undefined;
  const object = (prototype, result) => {
    const instance = Object.create(prototype);
    handles.set(instance, result.handle);
    if (registry) {
      const token = {};
      handles.set(token, result.handle);
      registry.register(instance, token, instance);
    }
    return instance;
  };
  const free = instance => {
    const id = handles.get(instance);
    if (id === undefined || id === 0n) return;
    handles.set(instance, 0n);
    registry?.unregister(instance);
    const token = {};
    handles.set(token, id);
    decodeResult(transport.call(0, 'free', encodeArgs([token])));
  };
  const ViewingHandle = {
    describe() { return call('ViewingHandle.describe', this); },
    export(format, acknowledge) { return call('ViewingHandle.export', this, format, acknowledge); },
    to_incoming() { return object(ViewingHandle, call('ViewingHandle.to_incoming', this)); },
    derive(index, request) { return call('ViewingHandle.derive', this, index, request); },
    find(start, request, maxAttempts) { return call('ViewingHandle.find', this, start, request, maxAttempts); },
    free() { free(this); },
  };
  const StandalonePczt = {
    serialize() { return call('StandalonePczt.serialize', this); },
    inspect() { return call('StandalonePczt.inspect', this); },
    combine(other) { return object(StandalonePczt, call('StandalonePczt.combine', this, other)); },
    redact(profile) { return object(StandalonePczt, call('StandalonePczt.redact', this, profile)); },
    free() { free(this); },
  };
  return Object.freeze({
    // Native code is linked into the app; there is no module to instantiate.
    initSync() { return undefined; },
    transaction_id: (raw, branch) => call('transaction_id', raw, branch),
    consensus_branch: (format, bytes, height) => call('consensus_branch', format, bytes, height),
    viewing_open: (parameters, format, encoded, pools) => object(ViewingHandle, call('viewing_open', parameters, format, encoded, pools)),
    viewing_decode_address: (parameters, encoded) => call('viewing_decode_address', parameters, encoded),
    viewing_select_receiver: (parameters, encoded, pool, height, branch) => call('viewing_select_receiver', parameters, encoded, pool, height, branch),
    validate_birthday: (parameters, genesis, first, tree, recover) => call('validate_birthday', parameters, genesis, first, tree, recover),
    parse_standalone_pczt: (parameters, genesis, height, branch, bytes, maximum) => object(StandalonePczt, call('parse_standalone_pczt', parameters, genesis, height, branch, bytes, maximum)),
    lightwire_encode: (method, json) => call('lightwire_encode', method, json),
    lightwire_decode: (method, bytes, item) => call('lightwire_decode', method, bytes, item),
    lightwire_encode_tree_state: json => call('lightwire_encode_tree_state', json),
    transparent_address_decode: (token, family) => call('transparent_address_decode', token, family),
    // Platform services for the SDK on engines without WebCrypto.
    sha256: bytes => call('sha256', bytes),
    random_bytes: n => call('random_bytes', n),
    identity: () => JSON.parse(call('identity')),
    proving_load: (path, sha256, length) => call('proving_load', path, sha256, length),
    file_sha256: path => call('file_sha256', path),
    file_append: (path, bytes) => call('file_append', path, bytes),
    file_size: path => call('file_size', path),
    file_remove: path => call('file_remove', path),
    file_commit: (from, to) => call('file_commit', from, to),
  });
}

// Owner-thread calls the glue awaits: scanning, proving and every JSON wallet entry.
const asynchronous = new Set(['views_call', 'payment_call', 'scan_call', 'sync_call', 'query_call', 'enhancement_call',
  'proposal_call', 'pczt_build_call', 'account_lifecycle_call', 'views_seed_call', 'views_mnemonic_call',
  'pczt_import_call', 'pczt_prove_call', 'pczt_finalize_call', 'finalized_get', 'fused_send_call', 'signer_create_account']);
const synchronous = ['storage_initialize_native', 'storage_initialize_memory', 'storage_binding', 'storage_close',
  'signer_describe', 'signer_capabilities', 'signer_release', 'signer_bind', 'signer_unbind', 'signer_authorize'];

/** Wallet exports bound to one runtime (owner thread, own wallet domain). */
export function createRuntimeBindings(transport, runtime) {
  const exports = {};
  for (const name of synchronous) exports[name] = (...args) => decodeResult(transport.call(runtime, name, encodeArgs(args)));
  for (const name of asynchronous) {
    exports[name] = (...args) => {
      // Encode synchronously: the caller may zero secret buffers right after the call.
      const encoded = encodeArgs(args);
      if (!transport.start) return decodeResult(transport.call(runtime, name, encoded));
      return transport.start(runtime, name, encoded).then(decodeResult);
    };
  }
  return Object.freeze(exports);
}
