// Opt-in live regression: THS_BINARY=/absolute/path/to/ths node tests/integration/ths-nu7.mjs
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createLightClient, createWalletClient, defineNetwork, encodeNetworkParameters,
  getConsensusContext, resolveBirthday } from '@zcashlabs/zcash.js';

assert.ok(process.env.THS_BINARY, 'Set THS_BINARY to the local THS launcher');
const binary = resolve(process.env.THS_BINARY), exec = promisify(execFile);
const name = `nu7-sdk-${randomUUID().slice(0, 12)}`;
const output = resolve('.cache/ths-nu7', name);
await mkdir(output, { recursive: true });
const pool = process.argv.includes('--sapling') ? 'sapling' : 'ironwood';
const checks = [], evidence = { instance: name, node: process.version, pool, checks };
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const command = args => exec(binary, ['--name', name, ...args], { timeout: 180_000, maxBuffer: 2 * 1024 ** 2 });
let endpoints, launcher, exited, wallet, signer, binding, log, light, birthday;
async function check(label, run) {
  try {
    const result = await run();
    checks.push({ label, outcome: 'PASS', result });
    console.log(`PASS ${label}`);
    return result;
  } catch (error) {
    checks.push({ label, outcome: 'FAIL', code: error.code, message: error.message });
    throw error;
  }
}
async function rpc(method, params = []) {
  const response = await fetch(endpoints.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: name, method, params }), signal: AbortSignal.timeout(15_000) });
  assert.ok(response.ok);
  const data = await response.json();
  assert.ok(data.error == null, json(data.error));
  assert.ok(Object.hasOwn(data, 'result'), 'RPC response has no result');
  return data.result;
}
async function sync() {
  await command(['wait', '--timeout', '120']);
  const result = await wallet.sync({ signal: AbortSignal.timeout(60_000) });
  assert.equal(result.targetReached, true);
  return result;
}
async function mine(count) { await command(['mine', String(count), '--json']); }
async function fund(address, amount) {
  const key = randomUUID();
  const response = await fetch(`${endpoints.dashboard}/api/v1/faucet/address`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, amount_zatoshi: amount, idempotency_key: key }),
    signal: AbortSignal.timeout(60_000),
  });
  let data = await response.json();
  assert.ok(response.ok, json(data));
  const deadline = Date.now() + 60_000;
  while (!['broadcast', 'confirmed'].includes(data.status)) {
    assert.notEqual(data.status, 'failed', json(data));
    assert.ok(Date.now() < deadline, `faucet did not broadcast: ${json(data)}`);
    await delay(250);
    const status = await fetch(`${endpoints.dashboard}/api/v1/faucet/address?idempotency_key=${key}`,
      { signal: AbortSignal.timeout(15_000) });
    assert.ok(status.ok);
    data = await status.json();
  }
  assert.match(data.txid, /^[0-9a-f]{64}$/);
  await mine(1);
  await sync();
  return data.txid;
}
const mnemonic = () => new TextEncoder().encode('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const confirmations = { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false };
try {
  await check('isolated manual Regtest startup', async () => {
    log = openSync(`${output}/ths.log`, 'w');
    launcher = spawn(binary, ['--name', name, 'start', '--no-open', '--no-auto-mine',
      '--port-offset', process.env.THS_PORT_OFFSET ?? '870'], { stdio: ['ignore', log, log] });
    exited = new Promise(resolve => {
      launcher.once('error', error => resolve({ error: error.message }));
      launcher.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await command(['wait', '--timeout', '180']);
    endpoints = JSON.parse((await command(['endpoints', '--json'])).stdout);
    assert.equal(endpoints.network, 'regtest');
    for (const key of ['rpc', 'lightwalletd', 'dashboard']) {
      assert.equal(new URL(endpoints[key]).hostname, '127.0.0.1');
      assert.equal(new URL(endpoints[key]).protocol, 'http:');
    }
    evidence.endpoints = endpoints;
    return endpoints;
  });
  if (process.argv.includes('--fail-after-start')) throw Error('Intentional failure after startup');
  const network = await defineNetwork({ identity: name, genesisHash: await rpc('getblockhash', [0]),
    ...encodeNetworkParameters({ encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1, Heartwood: 1,
      Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1, Nu7: 1 }) });
  await check('native NU7 consensus and lightwalletd handshake', async () => {
    const chain = await rpc('getblockchaininfo');
    assert.equal(getConsensusContext({ network, targetHeight: chain.blocks }).branchId, 0x77190ad9);
    assert.equal(chain.consensus.chaintip, '77190ad9');
    light = await createLightClient(endpoints.lightwalletd, { network, transportOptions: { timeoutMs: 15_000 } });
    const tip = await light.getTip();
    assert.equal(tip.height, chain.blocks);
    assert.equal(tip.hash, chain.bestblockhash);
    return tip;
  });
  const options = { network, storage: { kind: 'memory' }, confirmations, transportOptions: { timeoutMs: 15_000 },
    ...(pool === 'sapling' ? { transactionPolicy: { spendPools: ['sapling'], transparent: 'disallow', changePool: 'sapling', feeRule: 'zip317-standard',
      confirmations, expiry: { kind: 'offset', blocks: 40 }, lockExpiryBlocks: 20, shieldingThreshold: 10000n,
      freshness: { mode: 'require-synced', maxLagBlocks: 0 } } } : {}) };
  let accountId, receive, deposit;
  await check('wallet sync and account creation', async () => {
    wallet = await createWalletClient(endpoints.lightwalletd, options);
    await sync();
    const created = await wallet.accounts.create({ mnemonic: mnemonic() });
    accountId = created.account.id;
    signer = created.signer;
    birthday = await resolveBirthday({ light, firstScanHeight: created.account.birthdayHeight });
    binding = await wallet.accounts.attachSigner({ accountId, signer });
    assert.equal(binding.state, 'ready');
    await sync();
    receive = await wallet.addresses.next({ accountId,
      request: { format: 'unified', transparent: 'omit', sapling: pool === 'sapling' ? 'require' : 'omit',
        ironwood: pool === 'ironwood' ? 'require' : 'omit' } });
    return { accountId, address: receive.address };
  });
  await check('incoming payment is exact and not spendable before confirmations', async () => {
    deposit = await fund(receive.address, 1_000_000);
    const balance = await wallet.getBalance({ accountId });
    assert.equal(balance.amounts.total, 1_000_000n);
    assert.equal(balance.amounts[pool].spendable, 0n);
    return { deposit, balance };
  });
  await check('repeat sync records the deposit once', async () => {
    await sync();
    await sync();
    const history = await wallet.getHistory({ accountId });
    assert.equal(history.items.filter(item => item.txid === deposit).length, 1);
    assert.equal((await wallet.getBalance({ accountId })).amounts.total, 1_000_000n);
    return { records: history.items.length };
  });
  await check('confirmed deposit becomes spendable with a valid anchor', async () => {
    await mine(3);
    await sync();
    const balance = await wallet.getBalance({ accountId });
    assert.equal(balance.amounts[pool].spendable, 1_000_000n);
    return balance;
  });
  await check('same-height reorg removes an incoming payment from confirmed history', async () => {
    const txid = await fund(receive.address, 500_000);
    assert.equal((await wallet.getBalance({ accountId })).amounts.total, 1_500_000n);
    const before = await rpc('getblockchaininfo');
    await command(['reorg', '--depth', '1', '--json']);
    const after = await rpc('getblockchaininfo');
    assert.equal(after.blocks, before.blocks);
    assert.notEqual(after.bestblockhash, before.bestblockhash);
    await sync();
    const history = await wallet.getHistory({ accountId });
    assert.ok(history.items.every(item => item.txid !== txid || item.minedHeight === null));
    const balance = await wallet.getBalance({ accountId });
    assert.equal(balance.amounts[pool].spendable, 1_000_000n);
    return { txid, balance, history };
  });
  await check('NU7 payment builds, proves, signs, broadcasts and confirms', async () => {
    const recipient = await wallet.addresses.next({ accountId, request: { format: 'transparent' } });
    await sync();
    const pending = await wallet.send({ accountId, to: recipient.address, amount: 100_000n,
      idempotencyKey: 'nu7-roundtrip', signal: AbortSignal.timeout(180_000) });
    const sent = await pending.snapshot();
    assert.equal(sent.steps.length, 1);
    const txid = sent.steps[0].txid;
    assert.match(txid, /^[0-9a-f]{64}$/);
    await mine(3);
    await sync();
    const confirmed = await pending.wait({ confirmations: 3, timeoutMs: 30_000 });
    const tx = await rpc('getrawtransaction', [txid, 1]);
    assert.ok(tx.confirmations >= 3);
    assert.equal((await wallet.getBalance({ accountId })).amounts.transparent.regular.total, 100_000n);
    return { txid, confirmed };
  });
  await check('mnemonic and saved birthday recover the same confirmed payments after wallet close', async () => {
    const prior = await wallet.getHistory({ accountId });
    await binding.dispose(); binding = undefined;
    await wallet.close(); wallet = undefined;
    await signer.dispose(); signer = undefined;
    wallet = await createWalletClient(endpoints.lightwalletd, options);
    const recovered = await wallet.accounts.import({ mnemonic: mnemonic(), accountIndex: 0, birthday });
    signer = recovered.signer;
    await sync();
    const after = await wallet.getHistory({ accountId: recovered.account.id });
    assert.deepEqual(after.items.filter(x => x.minedHeight !== null).map(x => x.txid).sort(),
      prior.items.filter(x => x.minedHeight !== null).map(x => x.txid).sort());
    return { confirmedTransactions: after.items.filter(x => x.minedHeight !== null).length,
      storage: 'memory; seed recovery, not persistent database reopen' };
  });
} catch (error) {
  evidence.error = { code: error.code, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(error);
} finally {
  try {
    try { await binding?.dispose(); }
    finally {
      try { await wallet?.close(); }
      finally { await signer?.dispose(); }
    }
  } catch (error) { evidence.walletCleanupError = error.message; process.exitCode = 1; }
  try {
    await check('owned THS resources are removed', async () => {
      await command(['stop']);
      if (exited) assert.equal((await Promise.race([
        exited, delay(20_000, undefined, { ref: false }).then(() => ({ timeout: true })),
      ])).code, 0);
      for (const kind of ['container', 'network', 'volume']) {
        const args = [kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '--format', kind === 'container' ? '{{.Names}}' : '{{.Name}}'];
        const { stdout } = await exec('docker', args, { timeout: 15_000 });
        assert.ok(!stdout.split('\n').some(line => line.includes(name)), `leaked ${kind}`);
      }
      return { resourcesRemaining: 0 };
    });
  } catch (error) { evidence.cleanupError = error.message; process.exitCode = 1; }
  finally {
    if (launcher && launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGINT');
    if (log !== undefined) closeSync(log);
  }
  await writeFile(`${output}/results.json`, json(evidence) + '\n');
  console.log(`Evidence: ${output}/results.json`);
}
