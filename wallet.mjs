// Private worker-local primitive. The future H1 owner supplies verified bytes and
// a validated genesis/parameter registration. This is not a public WalletClient.
import { initSync } from './bindings.js';
import * as binding from './bindings.js';
import { copyBytes } from './bytes.mjs';
import * as host from './wallet-host/storage-host.mjs';
let attempted = false, prepared;
function threaded(exports, name, ...args) {
  const fn = Reflect.get(exports, name);
  if (typeof fn !== 'function') throw Error('RUNTIME_UNAVAILABLE');
  return fn(...args);
}
function uint(value) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) throw TypeError('INVALID_ARGUMENT');
  return value;
}
export async function initializeStorage(wasm, backend, format, parameters, genesis) {
  // Preserve pre-initialization admission for existing worker-local consumers.
  const { params, identity } = network(format, parameters, genesis);
  return initializeWalletRuntime(wasm).open(backend, format, params, identity);
}
function network(format, parameters, genesis) {
  const params = copyBytes(parameters, 256, 'invalid parameters');
  const identity = copyBytes(genesis, 32, 'invalid genesis');
  if (identity.length !== 32 || !['zcash-js-network/1', 'zcash-js-network/2'].includes(format)) throw TypeError('INVALID_ARGUMENT');
  return { params, identity };
}

/** Initialize only verified code and worker-local SQLite, without a storage lease.
 * The host can finish compatibility negotiation before acquiring/opening a DB.
 */
export function initializeWalletRuntime(wasm) {
  const code = copyBytes(wasm, 32 * 1024 * 1024, 'invalid wasm bytes');
  if (attempted) throw Error('DOMAIN_USED');
  attempted = true;
  const exports = initSync({ module: code });
  return runtime(exports, false);
}
export function prepareThreaded(wasm, count) {
  const code = copyBytes(wasm, 32 * 1024 * 1024, 'invalid wasm bytes');
  if (!Number.isInteger(count) || count < 1 || count > 8) throw TypeError('INVALID_ARGUMENT');
  if (attempted) throw Error('DOMAIN_USED');
  attempted = true;
  const module = new WebAssembly.Module(code);
  const exports = initSync({ module });
  if (!(exports.memory.buffer instanceof SharedArrayBuffer)) throw Error('RUNTIME_UNAVAILABLE');
  threaded(exports, 'wallet_threaded_prepare', count); prepared = exports;
  return Object.freeze({ module, memory: exports.memory });
}
export function enterThreaded(module, memory, index, onLoaded) {
  if (!(module instanceof WebAssembly.Module) || !(memory instanceof WebAssembly.Memory)
    || !(memory.buffer instanceof SharedArrayBuffer) || !Number.isInteger(index) || index < 0 || index > 7 || typeof onLoaded !== 'function') throw TypeError('INVALID_ARGUMENT');
  if (attempted) throw Error('DOMAIN_USED');
  attempted = true;
  const exports = initSync({ module, memory });
  if (exports.memory.buffer !== memory.buffer) throw Error('RUNTIME_UNAVAILABLE');
  host.attachMemory(exports.memory, true, false);
  onLoaded(); threaded(exports, 'wallet_threaded_enter', index);
  throw Error('RUNTIME_UNAVAILABLE');
}
export function finishThreaded() {
  if (!prepared) throw Error('DOMAIN_NOT_READY');
  const exports = prepared; prepared = undefined;
  threaded(exports, 'wallet_threaded_build');
  return runtime(exports, true);
}
function runtime(exports, shared) {
  const instance = crypto.randomUUID();
  host.attachMemory(exports.memory, shared);
  if (exports.wallet_pool_start() + exports.wallet_pool_size() > exports.__heap_base.value) throw Error('allocator overlap');
  if (exports.wallet_runtime_init() !== 0) throw Error('RUNTIME_UNAVAILABLE');
  let invalid = false;
  const run = (backend, fn) => {
    if (invalid) throw Error('DOMAIN_INVALID');
    try { if (shared) threaded(exports, 'wallet_threaded_check'); return host.withBackend(backend, fn); }
    catch (error) { if (typeof error !== 'string' || error === 'STORAGE_CLOSE_FAILED') invalid = true; throw error; }
  };
  return Object.freeze({
    get invalid() { return invalid; },
    signers: Object.freeze({
      capabilities(token) { uint(token); return JSON.parse(run(undefined, () => binding.signer_capabilities(token))); },
      authorize(token, format, parameters, genesis, height, branch, bytes, maximum) {
        uint(token); const { params, identity } = network(format, parameters, genesis);
        if (!Number.isInteger(height) || height < 0 || height > 0xffffffff || !Number.isInteger(branch) || branch < 0 || branch > 0xffffffff) throw TypeError("INVALID_ARGUMENT");
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 4 * 1024 * 1024) throw TypeError("RESOURCE_LIMIT");
        let length;
        try { length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength").get.call(bytes); }
        catch { throw TypeError("INVALID_PCZT"); }
        if (length > maximum) throw TypeError("RESOURCE_LIMIT");
        const input = copyBytes(bytes, maximum, "INVALID_PCZT");
        return run(undefined, () => binding.signer_authorize(token, params, identity, height, branch, input, maximum));
      },
      describe(token) { uint(token); return JSON.parse(run(undefined, () => binding.signer_describe(token))); },
      release(token) { uint(token); return run(undefined, () => binding.signer_release(token)); },
    }),
    openMemory(format, parameters, genesis) {
      const { params, identity } = network(format, parameters, genesis);
      return openStorage(undefined, instance, format, params, identity, run);
    },
    open(backend, format, parameters, genesis) {
      const { params, identity } = network(format, parameters, genesis);
      host.attachBackend(backend);
      return openStorage(backend, instance, format, params, identity, run);
    },
  });
}
function openStorage(backend, instance, format, params, identity, execute) {
  const run = fn => execute(backend, fn);
  const generation = run(() => backend === undefined
    ? binding.storage_initialize_memory(format, params, identity)
    : binding.storage_initialize(format, params, identity));
  let closed = false, closeError;
  return {
    generation, instance, run,
    bindSigner(token, accountId) { uint(token); if (typeof accountId !== 'string' || accountId.length !== 36) throw TypeError('INVALID_ARGUMENT'); if (closed) throw Error('STALE_HANDLE'); return run(() => binding.signer_bind(token, generation, accountId)); },
    unbindSigner(token, accountId) { uint(token); if (typeof accountId !== 'string' || accountId.length !== 36) throw TypeError('INVALID_ARGUMENT'); if (closed) throw Error('STALE_HANDLE'); return run(() => binding.signer_unbind(token, generation, accountId)); },
    binding(token, owner) {
      uint(token);
      if (owner !== instance) throw Error('WRONG_INSTANCE');
      if (token !== generation) throw Error('STALE_HANDLE');
      if (closed) throw Error('STALE_HANDLE');
      try { return run(() => new Uint8Array(binding.storage_binding(token))); }
      catch (error) { if (typeof error !== 'string') { closed = true; closeError = Error('DOMAIN_INVALID'); } throw error; }
    },
    close(token, owner) {
      uint(token);
      if (owner !== instance) throw Error('WRONG_INSTANCE');
      if (token !== generation) throw Error('STALE_HANDLE');
      if (closed) { if (closeError) throw closeError; return; }
      closed = true;
      try {
        run(() => {
          binding.storage_close(token);
          // SQLite may ignore an xClose error. The owner-local host latch is authoritative too.
          if (host.state.closeError) throw Error('STORAGE_CLOSE_FAILED');
          if (backend) backend.release();
        });
      } catch { closeError = Error('STORAGE_CLOSE_FAILED'); throw closeError; }
    },
  };
}

/** Native (iOS/Android) runtime over owner-bound bindings from createRuntimeBindings.
 * Same shape as the WASM runtime; storage is a directory path handled natively
 * (owner lock, optional at-rest encryption), so there is no JS storage backend.
 */
let nativeInstances = 0;
export function initializeNativeWalletRuntime(api) {
  // Compared for identity only; React Native has no crypto.randomUUID by default.
  const instance = `native-${++nativeInstances}`;
  let invalid = false;
  const latch = error => { if (typeof error !== 'string' || error === 'STORAGE_CLOSE_FAILED') invalid = true; };
  const run = (_backend, fn) => {
    if (invalid) throw Error('DOMAIN_INVALID');
    let result;
    try { result = fn(); } catch (error) { latch(error); throw error; }
    if (result && typeof result.then === 'function') return result.then(undefined, error => { latch(error); throw error; });
    return result;
  };
  const signers = Object.freeze({
    capabilities(token) { uint(token); return JSON.parse(run(undefined, () => api.signer_capabilities(token))); },
    authorize(token, format, parameters, genesis, height, branch, bytes, maximum) {
      uint(token); const { params, identity } = network(format, parameters, genesis);
      if (!Number.isInteger(height) || height < 0 || height > 0xffffffff || !Number.isInteger(branch) || branch < 0 || branch > 0xffffffff) throw TypeError('INVALID_ARGUMENT');
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 4 * 1024 * 1024) throw TypeError('RESOURCE_LIMIT');
      let length;
      try { length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get.call(bytes); }
      catch { throw TypeError('INVALID_PCZT'); }
      if (length > maximum) throw TypeError('RESOURCE_LIMIT');
      const input = copyBytes(bytes, maximum, 'INVALID_PCZT');
      return run(undefined, () => api.signer_authorize(token, params, identity, height, branch, input, maximum));
    },
    describe(token) { uint(token); return JSON.parse(run(undefined, () => api.signer_describe(token))); },
    release(token) { uint(token); return run(undefined, () => api.signer_release(token)); },
  });
  const opened = (generation) => {
    let closed = false, closeError;
    const check = (token, owner) => {
      uint(token);
      if (owner !== instance) throw Error('WRONG_INSTANCE');
      if (token !== generation) throw Error('STALE_HANDLE');
    };
    return {
      generation, instance, api,
      run: fn => run(undefined, fn),
      bindSigner(token, accountId) { uint(token); if (typeof accountId !== 'string' || accountId.length !== 36) throw TypeError('INVALID_ARGUMENT'); if (closed) throw Error('STALE_HANDLE'); return run(undefined, () => api.signer_bind(token, generation, accountId)); },
      unbindSigner(token, accountId) { uint(token); if (typeof accountId !== 'string' || accountId.length !== 36) throw TypeError('INVALID_ARGUMENT'); if (closed) throw Error('STALE_HANDLE'); return run(undefined, () => api.signer_unbind(token, generation, accountId)); },
      binding(token, owner) {
        check(token, owner);
        if (closed) throw Error('STALE_HANDLE');
        try { return run(undefined, () => api.storage_binding(token)); }
        catch (error) { if (typeof error !== 'string') { closed = true; closeError = Error('DOMAIN_INVALID'); } throw error; }
      },
      close(token, owner) {
        check(token, owner);
        if (closed) { if (closeError) throw closeError; return; }
        closed = true;
        try { run(undefined, () => api.storage_close(token)); }
        catch { closeError = Error('STORAGE_CLOSE_FAILED'); throw closeError; }
      },
    };
  };
  return Object.freeze({
    get invalid() { return invalid; },
    signers,
    openMemory(format, parameters, genesis) {
      const { params, identity } = network(format, parameters, genesis);
      return opened(run(undefined, () => api.storage_initialize_memory(format, params, identity)));
    },
    /** `directory` is an absolute path; `key` an optional 32-byte at-rest encryption key. */
    openPath(directory, format, parameters, genesis, key) {
      if (typeof directory !== 'string' || !directory.startsWith('/') || directory.length > 4096) throw TypeError('INVALID_ARGUMENT');
      const { params, identity } = network(format, parameters, genesis);
      const owned = key === undefined ? undefined : copyBytes(key, 32, 'INVALID_ARGUMENT');
      if (owned !== undefined && owned.length !== 32) throw TypeError('INVALID_ARGUMENT');
      try { return opened(run(undefined, () => api.storage_initialize_native(directory, format, params, identity, owned))); }
      finally { owned?.fill(0); }
    },
  });
}
