// Test-only faults wrap real host primitives. No fault controls ship in the VFS.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { acquire } = await import(pathToFileURL(`${workerData.bundle}/wallet-host/node-fs.mjs`));
const { initializeStorage } = await import(pathToFileURL(`${workerData.bundle}/wallet.mjs`));
const { initialize } = await import('./wallet-support.mjs');
let storage, backend;
parentPort.on('message', async request => {
  try {
    if (request.op === 'initialize') {
      backend = acquire(workerData.root, { create: workerData.create });
      if (workerData.fault === 'entropy') {
        Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues() { throw Error('test entropy unavailable'); } } });
      }
      if (workerData.fault === 'quota') {
        const sync = backend.sync; let count = 0;
        backend.sync = fd => { sync(fd); if (++count === 12) throw Object.assign(Error('injected quota'), { code: 'ENOSPC' }); };
      }
      if (workerData.fault === 'crash') {
        const write = backend.write, open = backend.open, paths = new Map(); let count = 0;
        backend.open = (...args) => { const fd = open(...args); paths.set(fd, args[0]); return fd; };
        backend.write = (fd, bytes, at) => {
          const written = write(fd, bytes, at);
          if (paths.get(fd) === 'wallet.db' && ++count >= 10) {
            const journal = Buffer.alloc(8), journalFd = fs.openSync(`${workerData.root}/wallet.db-journal`, 'r');
            try { fs.readSync(journalFd, journal, 0, 8, 0); } finally { fs.closeSync(journalFd); }
            if (journal.equals(Buffer.from([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]))) {
              parentPort.postMessage({ checkpoint: 'migration-real-write', count });
              for (;;) { /* killed by the external process/worker deadline */ }
            }
          }
          return written;
        };
      }
      const input = initialize();
      storage = await initializeStorage(new Uint8Array(fs.readFileSync(`${workerData.bundle}/bindings_bg.wasm`)), backend, input.format, input.parameters, input.genesis);
      parentPort.postMessage({ ok: true, generation: storage.generation, instance: storage.instance });
    } else if (request.op === 'close') {
      if (workerData.fault === 'close') backend.close = () => { throw Object.assign(Error('injected close'), { code: 'EIO' }); };
      if (workerData.fault === 'release') backend.release = () => { throw Object.assign(Error('injected release'), { code: 'EIO' }); };
      storage.close(request.generation, request.instance); parentPort.postMessage({ ok: true });
    } else if (request.op === 'binding') {
      parentPort.postMessage({ ok: true, bytes: storage.binding(request.generation, request.instance) });
    } else throw Error('invalid test operation');
  } catch (e) { parentPort.postMessage({ ok: false, error: typeof e === 'string' ? e : e.message }); }
});
