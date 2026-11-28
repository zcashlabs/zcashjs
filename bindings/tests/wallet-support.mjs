import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
export function start(bundle, root, create = false, extra = {}) {
  const worker = new Worker(extra.testWorker ? new URL('./wallet-fault-worker.mjs', import.meta.url) : pathToFileURL(`${bundle}/wallet-host/node-worker.mjs`), {
    workerData: { root, create, bundle, ...extra }, trackUnmanagedFds: true,
  });
  let instance;
  let failure, stopped = false, busy = false;
  worker.on('error', e => { failure = e; });
  worker.on('exit', code => { stopped = true; failure ??= Error(`unexpected worker exit ${code}`); });
  return {
    worker,
    call(request) {
      if (failure || stopped) return Promise.reject(failure);
      if (busy) return Promise.reject(Error('one test request at a time'));
      busy = true;
      return new Promise((resolve, reject) => {
        const done = (error, value) => {
          clearTimeout(timer); busy = false;
          worker.off('message', message); worker.off('error', failed); worker.off('exit', exited);
          error ? reject(error) : resolve(value);
        };
        const timer = setTimeout(() => { void worker.terminate(); done(Error('worker deadline')); }, 30000);
        const message = value => { if (value.ok && value.instance) instance = value.instance; done(null, value); };
        const failed = error => done(error);
        const exited = code => done(Error(`unexpected worker exit ${code}`));
        worker.once('message', message); worker.once('error', failed); worker.once('exit', exited);
        worker.postMessage('instance' in request ? request : { ...request, instance });
      });
    },
    async destroy() {
      let timer;
      try { await Promise.race([worker.terminate(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('worker destruction deadline')), 5000); })]); }
      finally { clearTimeout(timer); }
      if (!stopped) throw Error('destruction not observed');
    },
  };
}
export const parameters = new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}');
export function initialize() { return { op: 'initialize', format: 'zcash-js-network/1', parameters: parameters.slice(), genesis: new Uint8Array(32).fill(3) }; }
