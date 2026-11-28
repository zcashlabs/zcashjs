import { acquire } from './opfs.mjs';
import { initializeStorage } from '../wallet.mjs';
if (typeof DedicatedWorkerGlobalScope === 'undefined' || !(globalThis instanceof DedicatedWorkerGlobalScope)) throw Error('dedicated worker required');
let storage, attempted = false;
self.onmessage = async ({ data: request }) => {
  try {
    if (request?.op === 'initialize') {
      if (attempted) throw Error('DOMAIN_USED');
      attempted = true;
      // Artifact acquisition belongs to the enclosing verified loader. This
      // private entry is for a trusted, immutable packaged executable closure.
      const response = await fetch(new URL('../bindings_bg.wasm', import.meta.url));
      if (!response.ok) throw Error('RUNTIME_UNAVAILABLE');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const backend = await acquire(request.root, { create: request.create });
      storage = await initializeStorage(bytes, backend, request.format, request.parameters, request.genesis);
      self.postMessage({ ok: true, generation: storage.generation, instance: storage.instance, secure: isSecureContext, isolated: crossOriginIsolated, sab: typeof SharedArrayBuffer });
    } else if (request?.op === 'binding' && storage) {
      self.postMessage({ ok: true, bytes: storage.binding(request.generation, request.instance) });
    } else if (request?.op === 'close' && storage) {
      storage.close(request.generation, request.instance); self.postMessage({ ok: true });
    } else throw Error('INVALID_ARGUMENT');
  } catch (error) {
    self.postMessage({ ok: false, error: typeof error === 'string' ? error : error.name === 'NoModificationAllowedError' ? 'STORAGE_BUSY' : error.message });
  }
};
