import { Worker } from 'node:worker_threads';
const worker = new Worker(new URL('./wallet-fault-worker.mjs', import.meta.url), {
  workerData: { bundle: process.argv[2], root: process.argv[3], create: true, fault: 'crash' }, trackUnmanagedFds: true,
});
worker.on('message', message => process.send(message));
worker.on('error', error => { process.send({ error: error.message }); process.exitCode = 1; });
worker.on('exit', () => process.disconnect());
worker.postMessage({ op: 'initialize' });
