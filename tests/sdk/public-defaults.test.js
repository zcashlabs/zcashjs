import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient, defineNetwork, httpTransport, readGenesisHash } from '@zcashlabs/zcash.js';
import { publicClientBinding } from '../../dist/src/public.js';
import { httpSourceId, readRpc } from '../../dist/src/http.js';

test('public endpoint construction defaults to mainnet, accepts networks, and stays lazy', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected request'); });
  const mainnet = await defineNetwork();
  const client = await createPublicClient('https://rpc.invalid');
  assert.equal(publicClientBinding(client).network.genesisHash, mainnet.genesisHash);
  for (const network of ['testnet', await defineNetwork('testnet')]) {
    const selected = await createPublicClient('https://rpc.invalid', { network,
      transportOptions: { timeoutMs: 50 }, observation: { pollIntervalMs: 50 } });
    assert.equal(publicClientBinding(selected).network.genesisHash, (await defineNetwork('testnet')).genesisHash);
  }
  for (const options of [{ observation: { pollIntervalMs: 0 } }, { observation: { extra: 1 } },
    { transportOptions: { maxResponseBytes: 0 } }, { network: 'regtest' }, { extra: 1 }]) {
    await assert.rejects(createPublicClient('https://rpc.invalid', options), { code: 'INVALID_ARGUMENT' });
  }
});

test('HTTP bootstrap defaults work and selected overrides retain validation and bounds', async t => {
  const hash = 'ab'.repeat(32);
  t.mock.method(globalThis, 'fetch', async (_url, init) => new Response(JSON.stringify({
    jsonrpc: '2.0', id: JSON.parse(init.body).id, result: hash,
  })));
  const transport = httpTransport('https://rpc.invalid');
  assert.equal(httpSourceId(transport), 'public-rpc');
  assert.equal(await readGenesisHash(transport), hash);
  await assert.rejects(readRpc(httpTransport('https://rpc.invalid', { maxResponseBytes: 8 }),
    'getblockhash', [0]), { code: 'RESOURCE_LIMIT' });
  assert.throws(() => httpTransport('https://rpc.invalid', { readRetry: { attempts: 1 } }),
    { code: 'INVALID_ARGUMENT' });
});
