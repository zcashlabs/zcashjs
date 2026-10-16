import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createWalletClient, defineNetwork } from '@zcashlabs/zcash.js';

// Same-candidate cold backup qualification; not an online backup or schema migration test.
test('closed Linux wallet snapshot preserves accounts and address exposure in a fresh restored directory', async t => {
  if (process.platform !== 'linux') return t.skip('persistent wallet storage requires Linux');
  const root = await mkdtemp(join(tmpdir(), 'zcash-cold-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const backup = await mkdtemp(join(root, 'backup-'));
  const restored = await mkdtemp(join(root, 'restored-'));
  const fixture = JSON.parse(await readFile(new URL('../fixtures/wallet/bundle/tests/views-fixture.json', import.meta.url)));
  const network = await defineNetwork({ identity: 'cold-backup-test', genesisHash: '03'.repeat(32),
    parametersFormat: 'zcash-js-network/1', parameters: new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}') });
  const open = path => createWalletClient('https://offline.invalid', { network,
    storage: { kind: 'node-filesystem', path } });
  const snapshot = () => execFileSync('/usr/bin/flock', ['-n', join(source, 'owner.lock'),
    'cp', '-a', source + '/.', backup]);
  let account, address, addresses;
  const wallet = await open(source);
  try {
    account = await wallet.accounts.import({ ...fixture.import, birthday: 'fullScan' });
    address = await wallet.addresses.next({ accountId: account.id, request: { format: 'transparent' } });
    addresses = await wallet.addresses.list({ accountId: account.id });
    assert.throws(snapshot, error => error.status === 1, 'source lease prevents copying an open wallet');
  } finally { await wallet.close(); }
  snapshot();
  // Retire the original: never use two copies as independent active wallets.
  await rename(source, join(root, 'retired-source'));
  execFileSync('cp', ['-a', backup + '/.', restored]);
  const reopened = await open(restored);
  try {
    assert.deepEqual(await reopened.accounts.get({ accountId: account.id }), account);
    assert.deepEqual(await reopened.addresses.list({ accountId: account.id }), addresses);
    const next = await reopened.addresses.next({ accountId: account.id, request: { format: 'transparent' } });
    assert.notEqual(next.address, address.address, 'restoration retains address exposure position');
    assert.equal(reopened.recovery.local, 'complete');
  } finally { await reopened.close(); }
});
