import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createWalletClient, defineNetwork } from '@zcashlabs/zcash.js';
import { openWalletRuntime, runtimeOptions } from '../../dist/src/runtime/wallet.js';
import { readFixture } from '../support/fixtures.js';

test('RC4 prepared and finalized payments retain exact bytes, identity and retry limits after migration', async t => {
  if (process.platform !== 'linux') return t.skip('persistent wallet storage requires Linux');
  const { DatabaseSync } = await import('node:sqlite');
  for (const kind of ['proposed', 'payment']) {
    const fixture = JSON.parse(readFixture(`nu7/legacy-${kind}.json`));
    const path = await mkdtemp(join(tmpdir(), 'legacy-payments-'));
    t.after(() => rm(path, { recursive: true, force: true }));
    const file = join(path, 'wallet.db');
    await writeFile(file, gunzipSync(readFixture(`nu7/legacy-${kind}.db.gz`)), { mode: 0o600 });
    const inspect = () => {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const tables = ['ext_wallet_proposals', 'ext_wallet_proposal_intents', 'ext_wallet_pczt',
          'ext_wallet_pczt_artifacts', 'ext_wallet_finalized', 'ext_wallet_submission_meta',
          'ext_wallet_submission', 'ext_wallet_attempts', 'ext_wallet_abandoned', 'addresses'];
        return { migrations: db.prepare('SELECT count(*) AS n FROM schemer_migrations').get().n,
          rows: Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])) };
      } finally { db.close(); }
    };
    const before = inspect();
    assert.equal(before.migrations, 66, 'fixture was produced by the unmodified RC4 storage engine');
    assert.equal(before.rows.ext_wallet_proposals.length, 1);
    assert.equal(before.rows.ext_wallet_proposal_intents.length, 1);
    assert.equal(before.rows.ext_wallet_finalized.length, kind === 'payment' ? 1 : 0);
    assert.equal(before.rows.ext_wallet_attempts.length, kind === 'payment' ? 2 : 0);
    const definition = { identity: 'legacy-payment-upgrade', genesisHash: fixture.genesis,
      parametersFormat: 'zcash-js-network/1', parameters: Buffer.from(fixture.parameters, 'hex') };
    const network = await defineNetwork(definition), { operationId, accountId } = fixture.plan;
    const storage = { kind: 'node-filesystem', path };
    for (const reopened of [false, true]) {
      const wallet = await createWalletClient('http://127.0.0.1:1', { network, storage, recovery: { mode: 'offline' } });
      try {
        const state = await wallet.operations.get({ operationId });
        assert.equal(state.operationId, operationId);
        assert.deepEqual(state.accountIds, [accountId]);
        assert.equal(state.phase, kind === 'payment' ? 'observing' : 'proposed');
        assert.deepEqual(state.steps[0].attempts.map(x => x.outcome), kind === 'payment' ? ['unknown', 'acknowledged'] : []);
        const inventory = await wallet.operations.list({ limit: 10 });
        assert.equal(inventory.items.length, 1);
        assert.equal(inventory.items[0].operationId, operationId);
      } finally { await wallet.close(); }
      assert.deepEqual(inspect(), { ...before, migrations: 87 }, `retained rows after reopen=${reopened}`);
    }
    // Exercise the real bundled worker's idempotency and exact-byte recovery APIs.
    const runtime = await openWalletRuntime({ network: definition, storage, runtime: runtimeOptions() });
    try {
      const session = runtime.session;
      t.diagnostic(`restoring ${kind} intent`);
      const policy = JSON.parse(before.rows.ext_wallet_proposals[0].policy);
      const intent = { accountId, idempotencyKey: 'legacy-retained-payment', policy,
        payments: fixture.plan.steps[0].outputs.filter(x => x.kind === 'payment').map(x => ({
          to: x.address, amount: BigInt(x.amount), ...(x.memo === null ? {} : { memo: Buffer.from(x.memo, 'hex') }),
        })) };
      const plan = await session.proposals.lookup(intent);
      assert.equal(plan.proposalId, fixture.plan.proposalId);
      assert.equal(plan.reviewCommitment, fixture.plan.reviewCommitment);
      if (kind === 'proposed') assert.deepEqual(await session.proposals.get({ operationId }), plan);
      assert.deepEqual(await session.proposals.create({ ...intent, revision: 'stale-before-upgrade' }), plan);
      const conflict = { ...intent, payments: intent.payments.map((x, i) => i ? x : { ...x, amount: x.amount + 1n }) };
      await assert.rejects(session.proposals.lookup(conflict), { code: 'IDEMPOTENCY_CONFLICT' });
      if (kind === 'payment') {
        const finalized = await session.pczt.finalized({ operationId });
        assert.equal(finalized.transactions.length, 1);
        assert.deepEqual(Buffer.from(finalized.transactions[0].bytes), Buffer.from(before.rows.ext_wallet_finalized[0].bytes));
        const artifact = await session.pczt.get({ operationId });
        assert.equal(artifact.artifactId, fixture.artifact.artifactId);
        assert.deepEqual(Buffer.from(artifact.bytes), Buffer.from(fixture.artifact.bytes, 'hex'));
        const state = await session.payments.get({ operationId });
        assert.equal(await session.payments.begin({ operationId, stepIndex: 0, sourceId: 'fixture',
          routeBinding: '01'.repeat(32), mode: 'automatic', wallTimeMs: 4_000_000,
          monotonicElapsedMs: 4_000_000, observationSequence: state.observationSequence,
          policy: { maxAttempts: 100, minIntervalMs: 100 } }), null, 'upgrade cannot replenish the exhausted retry budget');
      }
    } finally { await runtime.close(); }
    assert.deepEqual(inspect(), { ...before, migrations: 87 });
  }
});
