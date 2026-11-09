// Opt-in native integration: THS_BINARY=... THS_RUNTIME_DIR=... node tests/integration/ths-testing.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createWalletClient, defineNetwork, encodeNetworkParameters, createLightClient } from '@zcashlabs/zcash.js';
import { createTestTHSClient } from '@zcashlabs/zcash.js/testing';

assert.ok(process.env.THS_BINARY, 'Set THS_BINARY to an installed native THS launcher.');
const ths = createTestTHSClient({ executable: process.env.THS_BINARY,
  ...(process.env.THS_RUNTIME_DIR ? { runtimeDir: process.env.THS_RUNTIME_DIR } : {}), timeoutMs: 180_000 });
const evidence = { node: process.version, checks: [] };
let wallet, signer, binding, light, config;
const json = data => JSON.stringify(data, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2);
async function check(label, fn) {
  const result = await fn(); evidence.checks.push({ label, result }); console.log(`PASS ${label}`); return result;
}
async function rpc(method, params = []) {
  const response = await fetch(config.rpc, { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: config.instance, method, params }) });
  assert.ok(response.ok); const data = await response.json(); assert.ok(!data.error, json(data)); return data.result;
}
async function sync() {
  const receipt = await wallet.sync({ signal: AbortSignal.timeout(60_000) });
  assert.equal(receipt.targetReached, true); return receipt;
}
try {
  config = await check('native isolated startup through the library', () => ths.start());
  evidence.config = config;
  const network = await defineNetwork({ identity: config.instance, genesisHash: config.genesisHash,
    ...encodeNetworkParameters({ encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1, Heartwood: 1,
      Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1, Nu7: 1 }) });
  light = await createLightClient(config.lightwalletd, { network, transportOptions: { timeoutMs: 15_000 } });
  const confirmations = { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false };
  wallet = await createWalletClient(config.lightwalletd, { network, storage: { kind: 'memory' }, confirmations,
    transportOptions: { timeoutMs: 15_000 } });
  await sync();
  const created = await wallet.accounts.create({ mnemonic: new TextEncoder().encode(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about') });
  signer = created.signer; const accountId = created.account.id;
  binding = await wallet.accounts.attachSigner({ accountId, signer }); assert.equal(binding.state, 'ready');
  await sync();
  const receive = await wallet.addresses.next({ accountId, request: { format: 'unified', transparent: 'omit',
    sapling: 'omit', ironwood: 'require' } });
  await check('external SDK wallet receives and scans native treasury funding', async () => {
    const key = crypto.randomUUID();
    const response = await fetch(`${config.dashboard}/api/v1/faucet/address`, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: receive.address, amount_zatoshi: 1_000_000, idempotency_key: key }),
      signal: AbortSignal.timeout(60_000) });
    let job = await response.json(); assert.ok(response.ok, json(job));
    const deadline = Date.now() + 60_000;
    while (!['broadcast', 'confirmed'].includes(job.status)) {
      assert.notEqual(job.status, 'failed', json(job)); assert.ok(Date.now() < deadline, 'faucet timed out');
      await delay(250);
      const update = await fetch(`${config.dashboard}/api/v1/faucet/address?idempotency_key=${key}`,
        { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      assert.ok(update.ok); job = await update.json();
    }
    await ths.produceBlock(4); await sync();
    const balance = await wallet.getBalance({ accountId });
    assert.equal(balance.amounts.total, 1_000_000n); assert.equal(balance.amounts.ironwood.spendable, 1_000_000n);
    return { txid: job.txid, balance };
  });
  await check('SDK wallet builds, proves, signs and confirms a payment', async () => {
    const recipient = await wallet.addresses.next({ accountId, request: { format: 'transparent' } });
    const pending = await wallet.send({ accountId, to: recipient.address, amount: 100_000n,
      idempotencyKey: 'ths-testing-roundtrip', signal: AbortSignal.timeout(180_000) });
    const sent = await pending.snapshot(); const txid = sent.steps[0].txid;
    assert.match(txid, /^[0-9a-f]{64}$/);
    await ths.produceBlock(3); await sync();
    await pending.wait({ confirmations: 3, timeoutMs: 30_000 });
    assert.equal((await wallet.getBalance({ accountId })).amounts.transparent.regular.total, 100_000n);
    return { txid, chain: await rpc('getblockchaininfo') };
  });
  await check('reorg and rollback settle before external wallet sync', async () => {
    const before = await light.getTip();
    await ths.reorg(1, { keepTransactions: true }); const replaced = await light.getTip();
    assert.equal(replaced.height, before.height); assert.notEqual(replaced.hash, before.hash); await sync();
    await ths.rollback(1); const rolled = await light.getTip();
    assert.equal(rolled.height, before.height - 1); await sync();
    return { before, replaced, rolled };
  });
} catch (error) {
  evidence.error = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error);
} finally {
  try {
    try { await binding?.dispose(); }
    finally { try { await wallet?.close(); } finally { await signer?.dispose(); } }
  } catch (error) { evidence.walletCleanupError = error.message; process.exitCode = 1; }
  try {
    await check('library shutdown waits for owned listeners to close', async () => {
      await ths.stop(); await ths.stop();
      if (config) for (const endpoint of [config.dashboard, config.rpc, config.lightwalletd]) {
        await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(1000) }));
      }
      return { closed: true };
    });
  } catch (error) { evidence.cleanupError = error.message; process.exitCode = 1; console.error(error); }
  await mkdir('.cache/ths-testing', { recursive: true });
  await writeFile('.cache/ths-testing/results.json', json(evidence) + '\n');
  console.log('Evidence: .cache/ths-testing/results.json');
}
