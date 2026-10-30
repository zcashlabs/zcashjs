import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWalletClient, defineNetwork } from '@zcashlabs/zcash.js';
import { readFixture } from '../support/fixtures.js';

test('NU7 runtime migrates populated RC4 wallets without losing balances or history', async t => {
  if (process.platform !== 'linux') return t.skip('persistent wallet storage requires Linux');
  const { DatabaseSync } = await import('node:sqlite');
  const fixture = JSON.parse(readFixture('wallet/bundle/tests/views-fixture.json'));
  const network = await defineNetwork({ identity: 'legacy-migration', genesisHash: fixture.import.birthday.genesis,
    parametersFormat: 'zcash-js-network/1', parameters: Buffer.from(fixture.import.birthday.parameters, 'hex') });
  for (const index of [0, 2, 3]) {
    const original = fixture.balanceCases[index], query = original.queries[0];
    const path = await mkdtemp(join(tmpdir(), 'legacy-wallet-'));
    t.after(() => rm(path, { recursive: true, force: true }));
    const file = join(path, 'wallet.db');
    await writeFile(file, Buffer.from(original.database, 'hex'), { mode: 0o600 });
    const inspect = () => {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        return {
          migrations: db.prepare('SELECT count(*) AS count FROM schemer_migrations').get().count,
          accounts: db.prepare('SELECT uuid, ufvk, uivk, birthday_height FROM accounts ORDER BY uuid').all(),
          transactions: db.prepare('SELECT txid, mined_height, tx_index FROM transactions ORDER BY txid').all(),
          notes: ['sapling', 'orchard', 'ironwood'].map(pool => db.prepare(
            `SELECT transaction_id, account_id, value, nf, lock_expiry_height, lock_owner FROM ${pool}_received_notes ORDER BY id`).all()),
          utxos: db.prepare('SELECT transaction_id, output_index, account_id, value_zat, lock_expiry_height, lock_owner FROM transparent_received_outputs ORDER BY id').all(),
        };
      } finally { db.close(); }
    };
    const before = inspect();
    assert.equal(before.migrations, 66, 'the hash-bound fixture predates the NU7 migrations');
    assert.equal(before.accounts.length, 2);
    assert.equal(before.transactions.length, 3);
    let snapshot;
    for (const reopened of [false, true]) {
      const wallet = await createWalletClient('http://127.0.0.1:1', { network,
        storage: { kind: 'node-filesystem', path }, recovery: { mode: 'offline' },
        confirmations: query.args.confirmations });
      try {
        const args = { accountId: query.args.accountId };
        const balance = await wallet.getBalance(args);
        assert.equal(balance.amounts.total, BigInt(query.expected.amounts.total));
        assert.equal(balance.amounts.observedTotal, BigInt(query.expected.amounts.observedTotal));
        for (const pool of ['sapling', 'ironwood']) {
          assert.equal(balance.amounts[pool].total, BigInt(query.expected.amounts[pool].total));
          if (original.viewOnly) assert.equal(balance.amounts[pool].spendable, 0n);
        }
        assert.equal(balance.amounts.transparent.regular.total, BigInt(query.expected.amounts.transparent.regular.total));
        assert.equal(balance.amounts.unsupportedLegacy.balance.total, BigInt(query.expected.amounts.unsupportedLegacy.balance.total));
        const current = { accounts: await wallet.accounts.list(), addresses: await wallet.addresses.list(args),
          history: (await wallet.getHistory(args)).items, notes: (await wallet.listNotes(args)).items,
          utxos: (await wallet.listUtxos(args)).items, amounts: balance.amounts };
        assert.equal(current.accounts.length, 2);
        assert.ok(current.history.length > 0);
        assert.ok(current.notes.length > 0);
        assert.ok(current.utxos.length > 0);
        if (reopened) assert.deepEqual(current, snapshot);
        else snapshot = current;
      } finally { await wallet.close(); }
      assert.deepEqual(inspect(), { ...before, migrations: 87 });
    }
  }
});
