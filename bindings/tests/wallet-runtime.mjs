import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { parameters } from './wallet-support.mjs';

if (isMainThread) {
  const root = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/runtime-open-`);
  let expected;
  for (const create of [true, false]) {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { bundle: process.argv[2], root, create, expected }, trackUnmanagedFds: true,
    });
    try {
      const [result] = await once(worker, 'message', { signal: AbortSignal.timeout(30000) });
      assert.equal(result.pass, true);
      if (create) expected = result.account;
      else assert.deepEqual(result.account, expected);
    } finally { await worker.terminate(); }
  }
  console.log(JSON.stringify({ pass: true, case: 'verified-byte startup before storage, native account reopen', root }));
} else {
  const bundle = pathToFileURL(`${workerData.bundle}/`);
  const { initializeWalletRuntime } = await import(new URL('wallet.mjs', bundle));
  const { viewsForStorage } = await import(new URL('views.mjs', bundle));
  const { consensusContext } = await import(new URL('network.mjs', bundle));
  const { acquire } = await import(new URL('wallet-host/node-fs.mjs', bundle));
  const fixture = JSON.parse(fs.readFileSync(new URL('tests/views-fixture.json', bundle)));
  const filesBefore = fs.readdirSync(workerData.root);
  const wasm = new Uint8Array(fs.readFileSync(new URL('bindings_bg.wasm', bundle)));
  globalThis.fetch = () => { assert.fail('runtime must not fetch executable bytes'); };
  const runtime = initializeWalletRuntime(wasm);
  assert.deepEqual(fs.readdirSync(workerData.root), filesBefore, 'startup does not acquire/open storage');
  assert.equal(consensusContext('zcash-js-network/1', parameters, 20).height, 20);
  assert.throws(() => consensusContext('zcash-js-network/1', new Uint8Array([0]), 20));
  assert.throws(() => initializeWalletRuntime(wasm), /DOMAIN_USED/);
  wasm.fill(0);
  const backend = acquire(workerData.root, { create: workerData.create });
  try {
    const storage = runtime.open(backend, 'zcash-js-network/1', parameters, new Uint8Array(32).fill(3));
    assert.throws(() => runtime.open(backend, 'zcash-js-network/1', parameters, new Uint8Array(32).fill(3)), /DOMAIN_USED/);
    const views = viewsForStorage(storage);
    const args = workerData.create ? { ...fixture.import, birthday: 'fullScan' } : { accountId: workerData.expected.id };
    const account = views.call(views.generation, views.instance, workerData.create ? 'account_import' : 'account_get', args);
    assert.ok(account.id);
    views.close(views.generation, views.instance);
    views.close(views.generation, views.instance);
    assert.equal(backend.owned, false);
    parentPort.postMessage({ pass: true, account });
  } finally { if (backend.owned) backend.release(); }
}
