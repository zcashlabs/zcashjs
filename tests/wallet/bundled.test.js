import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createWalletClient, defineNetwork } from '@zcashlabs/zcash.js';
import { packageProving } from '../../dist/src/runtime/package-proving.js';
import { ProvingAssets, saplingAssets } from '../../dist/src/wallet/proving-assets.js';

test('endpoint wallet defaults open the bundled engine without contacting the endpoint', async () => {
  for (const network of [undefined, 'testnet']) {
    const wallet = await createWalletClient('http://127.0.0.1:1', {
      storage: { kind: 'memory' }, ...(network === undefined ? {} : { network }),
    });
    try {
      assert.equal(wallet.network.identity, network === 'testnet' ? 'zcash-testnet' : 'zcash-mainnet');
      assert.deepEqual(await wallet.accounts.list(), []);
      assert.equal(wallet.recovery.local, 'complete');
      await assert.rejects(wallet.propose({ accountId: 'test', to: 'test', amount: 1n }), { code: 'SYNC_REQUIRED' });
    } finally { await wallet.close(); }
  }
});

test('bundled proving files load offline through the canonical integrity checks', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('bundled proving must not fetch external assets'); });
  const options = packageProving();
  const assets = new ProvingAssets(options);
  try {
    const result = await assets.sapling();
    assert.equal(result.spend.length, saplingAssets[0].byteLength);
    assert.equal(result.output.length, saplingAssets[1].byteLength);
  } finally { await assets.close(); }
  const corrupt = new ProvingAssets({ ...options, async loadAsset(args) {
    const bytes = await options.loadAsset(args);
    bytes[0] ^= 1;
    return bytes;
  } });
  try { await assert.rejects(corrupt.sapling(), { code: 'ASSET_INTEGRITY' }); }
  finally { await corrupt.close(); }
});

test('root import opens the shipped engine offline and persists an account without runtime configuration', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('bundled Node wallet must not fetch executable assets'); });
  const parent = new URL('../../.local/tests/', import.meta.url);
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(new URL('bundled-', parent).pathname);
  t.after(() => rm(path, { recursive: true, force: true }));
  const fixture = JSON.parse(await readFile(new URL('../fixtures/wallet/bundle/tests/views-fixture.json', import.meta.url)));
  const network = await defineNetwork({ identity: 'bundled-test', genesisHash: '03'.repeat(32),
    parametersFormat: 'zcash-js-network/1', parameters: new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}') });
  const options = { network, storage: { kind: 'node-filesystem', path },
    confirmations: { trusted: 1, untrusted: 1, allowZeroConfirmationShielding: true },
    observation: { pollIntervalMs: 1000, maxBufferedUpdates: 16 }, recovery: { mode: 'offline' } };
  let account, address;
  for (const reopen of [false, true]) {
    const wallet = await createWalletClient(options);
    try {
      if (!reopen) {
        account = await wallet.accounts.import({ ...fixture.import, birthday: 'fullScan' });
        await assert.rejects(wallet.accounts.restoreSigner({ accountId: account.id,
          mnemonic: new TextEncoder().encode('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about') }),
        { code: 'SIGNER_CAPABILITY_MISMATCH' });
        address = await wallet.addresses.next({ accountId: account.id, request: { format: 'transparent' } });
      } else {
        assert.deepEqual(await wallet.accounts.get({ accountId: account.id }), account);
        assert.ok((await wallet.addresses.list({ accountId: account.id })).some(item => item.address === address.address));
      }
      assert.equal((await wallet.getBalance({ accountId: account.id })).amounts, null);
    } finally { await wallet.close(); }
  }
});

test('reopened account restores mnemonic authority offline without changing wallet history', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('restoration must not fetch'); });
  const path = await mkdtemp(join(tmpdir(), 'zcash-restore-signer-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const network = await defineNetwork({ identity: 'restore-test', genesisHash: '03'.repeat(32),
    parametersFormat: 'zcash-js-network/1', parameters: new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}') });
  const options = { network, storage: { kind: 'node-filesystem', path },
    confirmations: { trusted: 1, untrusted: 1, allowZeroConfirmationShielding: true },
    observation: { pollIntervalMs: 1000, maxBufferedUpdates: 16 }, recovery: { mode: 'offline' } };
  // Public BIP39 test vector, never funded.
  const mnemonic = new TextEncoder().encode('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const passphrase = new TextEncoder().encode('test passphrase');
  let wallet = await createWalletClient(options), restored, binding;
  try {
    const created = await wallet.accounts.import({ mnemonic, passphrase, accountIndex: 7, birthday: 'fullScan' });
    const accountId = created.account.id;
    await created.signer.dispose();
    await wallet.close();
    wallet = await createWalletClient(options);
    const before = await wallet.accounts.list();
    const addresses = await wallet.addresses.list({ accountId });
    const scan = await wallet.getSyncStatus();
    await assert.rejects(wallet.accounts.restoreSigner({ accountId, mnemonic }), { code: 'ACCOUNT_KEY_MISMATCH' });
    restored = await wallet.accounts.restoreSigner({ accountId, mnemonic, passphrase });
    assert.deepEqual(await wallet.accounts.list(), before);
    assert.deepEqual(await wallet.addresses.list({ accountId }), addresses);
    assert.deepEqual(await wallet.getSyncStatus(), scan);
    binding = await wallet.accounts.attachSigner({ accountId, signer: restored });
    assert.equal(binding.state, 'ready');
    assert.equal((await wallet.accounts.get({ accountId })).signerAttached, true);
    assert.equal(mnemonic[0], 97);
  } finally {
    await binding?.dispose();
    await restored?.dispose();
    await wallet.close();
    mnemonic.fill(0); passphrase.fill(0);
  }
});

test('bundled native mnemonic and duplicate-account failures preserve useful diagnostics', async () => {
  const wallet = await createWalletClient('http://127.0.0.1:1', {storage:{kind:'memory'}});
  let signer;
  try {
    await assert.rejects(wallet.accounts.import({mnemonic:new TextEncoder().encode('invalid synthetic mnemonic'),accountIndex:0,birthday:'fullScan'}), error => {
      assert.equal(error.code,'INVALID_MNEMONIC'); assert.match(error.message,/mnemonic/);
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /invalid synthetic mnemonic/); return true;
    });
    const mnemonic = new TextEncoder().encode('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const input = {mnemonic,accountIndex:0,birthday:'fullScan'};
    const created = await wallet.accounts.import(input); signer = created.signer;
    await assert.rejects(wallet.accounts.import(input), error => {
      assert.equal(error.code,'ACCOUNT_COLLISION'); assert.match(error.message,/already exists/);
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /abandon/); return true;
    });
    assert.equal((await wallet.accounts.list()).length,1);
  } finally {await signer?.dispose(); await wallet.close();}
});
