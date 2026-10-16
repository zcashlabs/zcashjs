import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightClient, createWalletClient, defineNetwork, encodeNetworkParameters } from '@zcashlabs/zcash.js';
import { blockBytes, tipBytes, bytesField, scalar, concat, revision } from '../clients/light-chain-reads-fixtures.js';
import { networkBinding } from '../../dist/src/network.js';
import { initializeAccount } from '../../examples/testnet/initialize.js';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const network = await defineNetwork({ identity: 'init-regression', genesisHash: '03'.repeat(32),
  ...encodeNetworkParameters({ encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1,
    Heartwood: 1, Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1 }) });
const hash = new Uint8Array(32).fill(17);
const text = (field, value) => bytesField(field, new TextEncoder().encode(value));
const { definition, codec } = networkBinding(network);
// One empty synthetic block exercises real native sync/address issuance offline.
const light = createLightClient({ network, transport: {
  kind: 'custom-lightwallet', sourceId: 'init-fixture', protocolRevision: revision,
  async unary({ method, request }) {
    if (method === 'GetLightdInfo') return concat(text(1, 'fixture'), text(2, 'synthetic'),
      text(4, 'regtest'), scalar(5, 1),
      text(6, codec.consensusContext(definition.parametersFormat, definition.parameters.bytes, 1).branchId.toString(16).padStart(8, '0')),
      scalar(7, 1), text(18, 'v0.5.0'));
    if (method === 'GetLatestBlock') return tipBytes(1, hash);
    if (method === 'GetTreeState') {
      const height = request[0] === 8 ? request[1] : 0;
      return concat(text(1, 'regtest'), ...(height ? [scalar(2, height)] : []), text(3, height ? '11'.repeat(32) : network.genesisHash), scalar(4, height + 1),
        text(5, '000000'), text(6, '000000'), text(7, '000000'));
    }
    if (method === 'GetAddressUtxos') return new Uint8Array();
    throw Error(`Unexpected fixture method: ${method}`);
  },
  async *stream({ method }) {
    if (method === 'GetBlockRange') yield blockBytes(1, hash, new Uint8Array(32).fill(3), concat(scalar(5, 2), bytesField(8, new Uint8Array())));
    else assert.ok(['GetTaddressTransactions', 'GetSubtreeRoots'].includes(method), method);
  },
} });
const options = { network, light, recovery: { mode: 'offline' },
  confirmations: { trusted: 1, untrusted: 1, allowZeroConfirmationShielding: true },
  observation: { pollIntervalMs: 1000, maxBufferedUpdates: 16 } };

for (const interruption of ['before import', 'after import', 'after address', 'before state save']) {
  test(`testnet init resumes ${interruption} without replacing account or address`, async t => {
    const path = await mkdtemp(join(tmpdir(), 'zcash-init-'));
    t.after(() => rm(path, { recursive: true, force: true }));
    const open = () => createWalletClient({ ...options, storage: { kind: 'node-filesystem', path } });
    const saved = { mnemonic: phrase };
    const stopped = Error('interrupted');
    let wallet = await open();
    try {
      const interrupted = { ...wallet,
        accounts: { ...wallet.accounts, async import(args) {
          const value = await wallet.accounts.import(args);
          if (interruption === 'after import') { await value.signer.dispose(); throw stopped; }
          return value;
        } },
        addresses: { ...wallet.addresses, async next(args) {
          const value = await wallet.addresses.next(args);
          if (interruption === 'after address') throw stopped;
          return value;
        } },
      };
      const first = initializeAccount(interrupted, saved, async () => {
        if (interruption === 'before import') throw stopped;
        return 'fullScan';
      });
      if (interruption === 'before state save') await first; // Database committed; accounts.json stayed unchanged.
      else await assert.rejects(first, error => error === stopped);
    } finally { await wallet.close(); }
    assert.deepEqual(saved, { mnemonic: phrase });
    wallet = await open();
    try {
      const before = await wallet.accounts.list();
      const priorAddresses = before.length ? await wallet.addresses.list({ accountId: before[0].id }) : [];
      const resumed = await initializeAccount(wallet, saved, async () => 'fullScan');
      assert.equal(resumed.mnemonic, phrase);
      assert.equal((await wallet.accounts.list()).length, 1);
      if (before.length) assert.equal(resumed.accountId, before[0].id);
      if (interruption === 'after address' || interruption === 'before state save') {
        assert.deepEqual(await wallet.addresses.list({ accountId: resumed.accountId }), priorAddresses);
      }
      const issued = await wallet.addresses.list({ accountId: resumed.accountId });
      assert.deepEqual(await initializeAccount(wallet, resumed, () => { throw Error('must not resolve birthday'); }), resumed);
      assert.deepEqual(await wallet.addresses.list({ accountId: resumed.accountId }), issued);
      await assert.rejects(initializeAccount(wallet, { mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow' }, () => 'fullScan'), { code: 'ACCOUNT_KEY_MISMATCH' });
      await assert.rejects(initializeAccount(wallet, { ...resumed, accountId: 'wrong' }, () => 'fullScan'), /saved account/);
      assert.deepEqual(await wallet.addresses.list({ accountId: resumed.accountId }), issued);
    } finally { await wallet.close(); }
  });
}
