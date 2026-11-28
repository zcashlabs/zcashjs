import { parentPort, workerData, isMainThread } from 'node:worker_threads';
import fs from 'node:fs';
import { acquire } from './node-fs.mjs';
import { initializeStorage } from '../wallet.mjs';
if (isMainThread) throw Error('dedicated worker required');
let storage, attempted = false;
parentPort.on('message', async request => {
  try {
    if (request?.op === 'initialize') {
      if (attempted) throw Error('DOMAIN_USED');
      attempted = true;
      const backend = acquire(workerData.root, { create: workerData.create });
      // Failure keeps ownership until this worker is destroyed. Never reuse a
      // potentially trapped module or report an unobserved close as successful.
      storage = await initializeStorage(new Uint8Array(fs.readFileSync(new URL('../bindings_bg.wasm', import.meta.url))),
        backend, request.format, request.parameters, request.genesis);
      parentPort.postMessage({ ok: true, generation: storage.generation, instance: storage.instance });
    } else if (request?.op === 'binding' && storage) {
      parentPort.postMessage({ ok: true, bytes: storage.binding(request.generation, request.instance) });
    } else if (request?.op === 'close' && storage) {
      storage.close(request.generation, request.instance); parentPort.postMessage({ ok: true });
    } else throw Error('INVALID_ARGUMENT');
  } catch (error) {
    parentPort.postMessage({ ok: false, error: typeof error === 'string' ? error : error.code === 'EBUSY' ? 'STORAGE_BUSY' : error.message });
  }
});
