import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWalletClient, defineNetwork, encodeNetworkParameters } from '@zcashlabs/zcash.js';

const schedule = { encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1, Heartwood: 1,
  Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1 };

test('NU7 wallet reopens with its exact network identity and rejects a legacy schedule', async t => {
  if (process.platform !== 'linux') return t.skip('persistent wallet storage requires Linux');
  const path = await mkdtemp(join(tmpdir(), 'nu7-wallet-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const definition = { identity: 'nu7-wallet', genesisHash: '03'.repeat(32) };
  const network = await defineNetwork({ ...definition, ...encodeNetworkParameters({ ...schedule, Nu7: 1 }) });
  const options = { network, storage: { kind: 'node-filesystem', path }, recovery: { mode: 'offline' } };
  let wallet = await createWalletClient('http://127.0.0.1:1', options), signer;
  let account, address;
  try {
    const created = await wallet.accounts.import({ accountIndex: 0, birthday: 'fullScan',
      mnemonic: new TextEncoder().encode('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about') });
    account = created.account;
    signer = created.signer;
    address = await wallet.addresses.next({ accountId: account.id, request: { format: 'transparent' } });
  } finally { try { await wallet.close(); } finally { await signer?.dispose(); } }
  const legacy = await defineNetwork({ ...definition, ...encodeNetworkParameters(schedule) });
  await assert.rejects(createWalletClient('http://127.0.0.1:1', { ...options, network: legacy }), { code: 'NETWORK_MISMATCH' });
  wallet = await createWalletClient('http://127.0.0.1:1', options);
  try {
    assert.equal((await wallet.accounts.get({ accountId: account.id })).id, account.id);
    assert.ok((await wallet.addresses.list({ accountId: account.id })).some(item => item.address === address.address));
  } finally { await wallet.close(); }
});
