import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
import { readFile } from 'node:fs/promises';
import { createTestTHSClient } from '@zcashlabs/zcash.js/testing';
const executable = new URL('./ths-fixture.mjs', import.meta.url).pathname;
const client = runtimeDir => createTestTHSClient({ executable, runtimeDir, timeoutMs: 2000 });

test('coalesces start, parses split JSON, exposes frozen config, stops repeatedly and restarts fresh', async t => {
  const ths = client('split'); t.after(() => ths.stop());
  assert.throws(() => ths.config(), /ready/i);
  const [a, b] = await Promise.all([ths.start(), ths.start()]);
  assert.match(a.instance, /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/);
  assert.equal(a, b); assert.equal(a, ths.config()); assert.ok(Object.isFrozen(a));
  const details = await (await fetch(`${a.dashboard}/fixture`)).json();
  assert.deepEqual(details.args, ['--name', a.instance, '--json', 'start', '--native', '--runtime-dir', 'split',
    '--timeout', '2', '--no-open', '--no-auto-mine']);
  await ths.stop(); await ths.stop(); assert.throws(() => ths.config(), /ready/i);
  assert.notEqual((await ths.start()).instance, a.instance);
});

for (const mode of ['public', 'credentials', 'bad-p2p', 'identity', 'network', 'rpc-network', 'genesis', 'redirect', 'tls', 'url-path', 'zero-port', 'wallet-error', 'invalid-json', 'oversized']) {
  test(`rejects unsafe startup: ${mode}`, async t => {
    const ths = client(mode); t.after(() => ths.stop());
    await assert.rejects(ths.start());
    assert.throws(() => ths.config()); await ths.stop();
  });
}
test('validates parameters before mutation, sends exact payloads and waits for settlement', async t => {
  const ths = client('normal'); t.after(() => ths.stop());
  await ths.start();
  for (const n of [0, -1, 1.5, NaN, Infinity, '1', 10001]) await assert.rejects(ths.produceBlock(n));
  for (const method of ['reorg', 'rollback']) {
    for (const n of [0, -1, 1.5, 1001]) await assert.rejects(ths[method](n));
  }
  await assert.rejects(ths.reorg(1, { keepTransactions: 'yes' }));
  await ths.produceBlock(10); await ths.reorg(2, { keepTransactions: true }); await ths.reorg(1); await ths.rollback(3);
  const details = await (await fetch(`${ths.config().dashboard}/fixture`)).json();
  assert.deepEqual(details.calls, [['/api/v1/mine', { blocks: 10 }], ['/api/v1/reorg', { depth: 2, keep_txs: true }],
    ['/api/v1/reorg', { depth: 1, keep_txs: false }], ['/api/v1/rollback', { depth: 3 }]]);
  assert.ok(details.pending < 0);
  await fetch(`${ths.config().dashboard}/fixture`, { method: 'POST' });
  await assert.rejects(ths.produceBlock(1), /identity/i);
  assert.equal((await (await fetch(`${ths.config().dashboard}/fixture`)).json()).calls.length, 4);
});
test('stop cancels startup and awaits process cleanup', async () => {
  const ths = client('slow');
  const starting = ths.start();
  const rejected = assert.rejects(starting);
  await delay(200); await Promise.all([ths.stop(), ths.stop()]); await rejected; await ths.stop();
});
for (const runtimeDir of ['no-output', 'hang-http', 'unsettled']) {
  test(`bounds startup timeout: ${runtimeDir}`, async () => {
    const ths = createTestTHSClient({ executable, runtimeDir, timeoutMs: 150 });
    await assert.rejects(ths.start()); await ths.stop();
  });
}
test('spawn errors and process errors are observable', async () => {
  await assert.rejects(createTestTHSClient({ executable: '/nonexistent/ths', timeoutMs: 150 }).start(), /ENOENT/);
  await assert.rejects(client('exit').start(), /7|fixture service failed/);
  const ths = client('late-exit'); await ths.start(); await delay(400);
  assert.throws(() => ths.config(), /exit|failure/i);
  await assert.rejects(ths.produceBlock(1), /exit|failure/i);
  await assert.rejects(ths.start(), /exit|failure/i);
  await assert.rejects(ths.stop(), /9|late service failure/); await ths.stop();
});
test('mutation API errors are observable', async t => {
  const ths = client('api-error'); t.after(() => ths.stop()); await ths.start();
  await assert.rejects(ths.produceBlock(1), /500/);
});
test('testing is a Node-only conditional export without a browser-root import', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  assert.deepEqual(Object.keys(manifest.exports['./testing']), ['node']);
  const result = spawnSync(process.execPath, ['--conditions=browser', '--no-addons', '--input-type=module', '-e',
    "import('@zcashlabs/zcash.js').then(s => { if ('createTestTHSClient' in s) process.exit(1); })"], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(build({ configFile: false, logLevel: 'silent',
    plugins: [{ name: 'testing-browser-probe', resolveId(id) { if (id === 'probe') return '\0probe'; },
      load(id) { if (id === '\0probe') return "export { createTestTHSClient } from '@zcashlabs/zcash.js/testing';"; } }],
    build: { write: false, lib: { entry: 'probe', formats: ['es'] } } }),
    /No known conditions|Missing|Failed to resolve|Could not resolve|Cannot resolve/);
});

test('shutdown timeout stays observable and blocks restart until cleanup is retried', async () => {
  const ths = createTestTHSClient({ executable, runtimeDir: 'ignore-stop', timeoutMs: 1000 });
  await ths.start();
  await assert.rejects(ths.stop(), /cleanup is unconfirmed/);
  assert.throws(() => ths.config(), /cancelled/);
  await assert.rejects(ths.start(), /stopping/);
  await ths.stop(); await ths.stop();
});
test('stop waits for slow owned cleanup', async () => {
  const ths = client('slow-stop'); await ths.start();
  const began = Date.now(); await ths.stop(); assert.ok(Date.now() - began >= 140);
});
test('a response arriving around process exit never yields a usable client', async () => {
  const ths = client('output-exit');
  await assert.rejects(ths.start()); await ths.stop();
});
test('mutation requests have a total bounded timeout', async t => {
  const ths = createTestTHSClient({ executable, runtimeDir: 'hang-mutation', timeoutMs: 1000 });
  t.after(() => ths.stop()); await ths.start();
  await assert.rejects(ths.produceBlock(1), /timeout|aborted/i);
});

test('rejects invalid configuration before launching', () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 2147483648, '100']) {
    assert.throws(() => createTestTHSClient({ timeoutMs }));
  }
  assert.throws(() => createTestTHSClient({ executable: '' }));
  assert.throws(() => createTestTHSClient({ runtimeDir: '' }));
});

test('accepts native graceful SIGTERM exit status only for its requested shutdown', async () => {
  const ths = client('term-code'); await ths.start(); await ths.stop(); await ths.stop();
});

test('unrequested exit 143 remains a service failure', async () => {
  const ths = client('late-term-exit'); await ths.start(); await delay(400);
  assert.throws(() => ths.config(), /143/);
  await assert.rejects(ths.stop(), /143/); await ths.stop();
});

test('startup cancellation with native code 1 waits for cleanup and preserves the failure diagnostic', async () => {
  const ths = client('cancel-error'); const starting = ths.start();
  const rejected = assert.rejects(starting, /failure logs retained.*|interrupted/);
  await delay(200); const began = Date.now();
  await assert.rejects(ths.stop(), /failure logs retained.*|interrupted/);
  assert.ok(Date.now() - began >= 140); await rejected; await ths.stop();
});
