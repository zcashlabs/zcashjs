import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient, defineNetwork, httpTransport, readGenesisHash } from '@zcashlabs/zcash.js';
import { genesis, blockOne, transportOptions } from '../clients/public-chain-reads-fixtures.js';
import { publicNetworkDefinition, publicResponse } from './public-client-fixture.js';

const reply = (request, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
const transport = extra => httpTransport('https://synthetic.invalid', { ...transportOptions, ...extra });

test('bootstrap a custom network, then independently verify genesis before reading the tip', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    calls.push([request.method, request.params]);
    return reply(request, request.method === 'getblockhash'
      ? genesis.verbose.hash : publicResponse(request).result);
  });
  const rpc = transport();
  const genesisHash = await readGenesisHash(rpc);
  const network = await defineNetwork({ ...publicNetworkDefinition(), genesisHash });
  const client = createPublicClient({ network, transport: rpc,
    observation: { pollIntervalMs: 1000, maxBufferedUpdates: 4 } });
  assert.equal((await client.getTip()).hash, blockOne.verbose.hash);
  assert.deepEqual(calls, [
    ['getblockhash', [0]], ['getblockheader', ['0', true]],
    ['getblockheader', [genesis.verbose.hash, false]], ['getblockchaininfo', []],
  ]);
});

test('genesis discovery rejects malformed hashes and preserves RPC errors', async t => {
  let result;
  t.mock.method(globalThis, 'fetch', async (_url, init) => reply(JSON.parse(init.body), result));
  for (result of [null, 0, {}, 'abc', 'AB'.repeat(32)]) {
    await assert.rejects(readGenesisHash(transport()), { code: 'PROTOCOL_MISMATCH' });
  }
  t.mock.method(globalThis, 'fetch', async (_url, init) => new Response(JSON.stringify({
    jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -32601, message: 'unsupported' },
  })));
  await assert.rejects(readGenesisHash(transport()), { code: 'METHOD_NOT_SUPPORTED' });
});

test('public handshake identifies genesis disagreement without exposing endpoint credentials', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.method, 'getblockheader', 'mismatch must block the tip query');
    return reply(request, publicResponse(request).result);
  });
  const network = await defineNetwork({ ...publicNetworkDefinition(), genesisHash: '00'.repeat(32) });
  const client = createPublicClient({ network,
    transport: httpTransport('https://synthetic.invalid/SECRET-endpoint', {
      ...transportOptions, headers: () => ({ authorization: 'SECRET-token' }),
    }), observation: { pollIntervalMs: 1000, maxBufferedUpdates: 4 } });
  await assert.rejects(client.getTip(), error => {
    assert.equal(error.code, 'NETWORK_MISMATCH');
    assert.equal(error.recovery, 'configure');
    assert.match(error.message, /genesis hash/);
    assert.doesNotMatch(error.message + JSON.stringify(error), /SECRET/);
    return true;
  });
});

test('genesis discovery uses transport retries, headers, bounds, timeout and cancellation', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    assert.equal(init.headers.get('authorization'), 'fixture');
    return calls === 1 ? new Response('', { status: 503 }) : reply(JSON.parse(init.body), genesis.verbose.hash);
  });
  assert.equal(await readGenesisHash(transport({ readRetry: { attempts: 2, delayMs: 0 },
    headers: async () => ({ authorization: 'fixture' }) })), genesis.verbose.hash);
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readGenesisHash(transport(), { signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(calls, 2);
  await assert.rejects(readGenesisHash({}), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(readGenesisHash(transport(), { signal: {} }), { code: 'INVALID_ARGUMENT' });
  t.mock.method(globalThis, 'fetch', async (_url, init) => reply(JSON.parse(init.body), genesis.verbose.hash));
  await assert.rejects(readGenesisHash(transport({ maxResponseBytes: 16 })), { code: 'RESOURCE_LIMIT' });
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  await assert.rejects(readGenesisHash(transport({ timeoutMs: 20 })), { code: 'TIMEOUT' });
  const late = new AbortController();
  const pending = readGenesisHash(transport(), { signal: late.signal });
  setTimeout(() => late.abort(), 10);
  await assert.rejects(pending, { code: 'ABORTED' });
});
