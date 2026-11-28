import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) {
  const bundle = process.argv[2];
  for (const populate of [true, false]) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { bundle, populate } });
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('memory worker deadline')), 30000);
        worker.once('message', value => { try { assert.equal(value.pass, true); resolve(); } catch (e) { reject(e); } });
        worker.once('error', reject);
        worker.once('exit', code => { reject(Error(`worker exited before result: ${code}`)); });
      });
    } finally { clearTimeout(timer); await worker.terminate(); }
  }
  console.log(JSON.stringify({ pass:true, memory:true, backendAttached:false, importQuery:true, freshEmpty:true, workersDestroyed:2 }));
} else {
  const { bundle, populate } = workerData;
  const { initializeWalletRuntime } = await import(pathToFileURL(`${bundle}/wallet.mjs`));
  const { viewsForStorage } = await import(pathToFileURL(`${bundle}/views.mjs`));
  const fixture = JSON.parse(readFileSync(`${bundle}/tests/views-fixture.json`));
  const bytes = hex => Uint8Array.from(Buffer.from(hex, 'hex'));
  for (const key of ['parameters','genesis','priorTreeState']) fixture.import.birthday[key] = bytes(fixture.import.birthday[key]);
  // No filesystem/OPFS backend is constructed or attached. VFS I/O would fail its lease check.
  const runtime = initializeWalletRuntime(readFileSync(`${bundle}/bindings_bg.wasm`));
  const storage = runtime.openMemory('zcash-js-network/1', fixture.import.birthday.parameters, fixture.import.birthday.genesis);
  const owner = viewsForStorage(storage);
  const call = (op,args={}) => owner.call(owner.generation,owner.instance,op,args);
  try {
    assert.deepEqual(call('account_list'), []);
    if (populate) {
      const account = call('account_import',fixture.import);
      assert.equal(call('account_get',{accountId:account.id}).id,account.id);
      assert.equal(call('account_list').length,1);
    }
  } finally { owner.close(owner.generation,owner.instance); }
  parentPort.postMessage({pass:true});
}
