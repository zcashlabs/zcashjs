import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { parameters } from './wallet-support.mjs';
if (isMainThread) {
  const root = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/admission-`);
  const worker = new Worker(new URL(import.meta.url), { workerData: { bundle: process.argv[2], root }, trackUnmanagedFds: true });
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void worker.terminate(); reject(Error('admission deadline')); }, 30000);
      worker.once('message', value => { clearTimeout(timer); resolve(value); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
      worker.once('exit', code => { clearTimeout(timer); reject(Error(`unexpected exit ${code}`)); });
    });
    assert.equal(result.pass, true); console.log(JSON.stringify(result));
  } finally { await worker.terminate(); }
} else {
  const { initializeStorage } = await import(pathToFileURL(`${workerData.bundle}/wallet.mjs`));
  const { acquire } = await import(pathToFileURL(`${workerData.bundle}/wallet-host/node-fs.mjs`));
  const backend = acquire(workerData.root, { create: true });
  const wasm = new Uint8Array(fs.readFileSync(`${workerData.bundle}/bindings_bg.wasm`));
  const genesis = new Uint8Array(32).fill(3), params = parameters.slice();
  const shared = new Uint8Array(new SharedArrayBuffer(params.length)); shared.set(params);
  Object.setPrototypeOf(shared.buffer, ArrayBuffer.prototype);
  const detached = params.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const invalid of [undefined, [], new Uint16Array(4), new Uint8Array(257), shared, detached]) {
    await assert.rejects(initializeStorage(wasm, backend, 'zcash-js-network/1', invalid, genesis), /invalid parameters/);
  }
  await assert.rejects(initializeStorage(wasm, backend, 'zcash-js-network/1', params, new Uint8Array(33)), /invalid genesis/);
  await assert.rejects(initializeStorage(wasm, backend, 'zcash-js-network/1', params, new Uint8Array(31)), /INVALID_ARGUMENT/);
  const pending = initializeStorage(wasm, backend, 'zcash-js-network/1', params, genesis);
  params.fill(0); genesis.fill(0); wasm.fill(0);
  const storage = await pending;
  const result = storage.binding(storage.generation, storage.instance);
  assert.deepEqual(result, parameters); result.fill(0);
  assert.deepEqual(storage.binding(storage.generation, storage.instance), parameters);
  storage.close(storage.generation, storage.instance);
  parentPort.postMessage({ pass: true, case: 'pre-glue byte admission, snapshots before await, independent outputs' });
}
