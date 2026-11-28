import assert from 'node:assert/strict';
import test from 'node:test';
import { media, good } from './grpc-web-fixtures.js';

const http = await import('../../dist/src/http.js');
const grpcWeb = await import('../../dist/src/clients/grpc-web.js');
const grpc = await import('../../dist/src/grpc.js');

// A fetch whose responses expose only arrayBuffer(), like React Native's default fetch.
function bufferedFetch(text, headers = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    const id = typeof text === 'function' ? JSON.parse(init.body).id : undefined;
    const bytes = new TextEncoder().encode(typeof text === 'function' ? text(id) : text);
    return {
      ok: true, status: 200, body: undefined,
      headers: new Headers({ 'content-length': String(bytes.length), ...headers }),
      arrayBuffer: async () => bytes.buffer,
    };
  };
  return { fetcher, calls };
}
const rpcOptions = extra => ({ sourceId: 'synthetic', timeoutMs: 1000, readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 4096, ...extra });

test('HTTP JSON-RPC uses an injected fetch and reads non-streaming bodies', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('global fetch must not be used'); });
  const { fetcher, calls } = bufferedFetch(id => JSON.stringify({ jsonrpc: '2.0', id, result: 'X' }).replace('"X"', '{"blocks":12}'));
  const transport = http.httpTransport('https://rpc.invalid/', rpcOptions({ fetch: fetcher }));
  const result = await http.readRpc(transport, 'getblockchaininfo', []);
  assert.equal(result.blocks.text, '12');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal);
});

test('HTTP JSON-RPC enforces maxResponseBytes on buffered bodies', async () => {
  const big = JSON.stringify({ jsonrpc: '2.0', id: '0', result: 'x'.repeat(5000) });
  const fetcher = async () => ({ ok: true, status: 200, body: undefined, headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(big).buffer });
  const transport = http.httpTransport('https://rpc.invalid/', rpcOptions({ fetch: fetcher }));
  await assert.rejects(http.readRpc(transport, 'getblockchaininfo', []), { code: 'RESOURCE_LIMIT' });
});

test('HTTP transport rejects a non-function fetch option', () => {
  assert.throws(() => http.httpTransport('https://rpc.invalid/', rpcOptions({ fetch: 'nope' })), { code: 'INVALID_ARGUMENT' });
});

test('gRPC-Web unary works over a non-streaming injected fetch', async () => {
  const { fetcher, calls } = bufferedFetch(good(), { 'content-type': media });
  const transport = grpcWeb.createGrpcWebByteTransport('https://light.invalid', { timeoutMs: 1000, fetch: fetcher });
  assert.deepEqual([...await transport.unary({ method: 'GetLatestBlock', request: new Uint8Array([8, 1]) })], [8, 1]);
  assert.equal(calls[0].init.credentials, 'omit');
});

test('gRPC-Web streams fail early without a streaming body', async () => {
  const { fetcher } = bufferedFetch(good(), { 'content-type': media });
  const transport = grpcWeb.createGrpcWebByteTransport('https://light.invalid', { timeoutMs: 1000, fetch: fetcher });
  const iterator = transport.stream({ method: 'GetBlockRange', request: new Uint8Array() });
  await assert.rejects(iterator.next(), { code: 'RUNTIME_UNAVAILABLE' });
});

test('public gRPC options accept fetch and select gRPC-Web even on Node', async () => {
  const { fetcher, calls } = bufferedFetch(good(), { 'content-type': media });
  const transport = grpc.grpc('https://light.invalid', rpcOptions({ fetch: fetcher }));
  const adapter = grpc.grpcAdapter(transport);
  assert.deepEqual([...await adapter.unary({ method: 'GetLatestBlock', request: new Uint8Array([8, 1]) })], [8, 1]);
  assert.match(calls[0].url, /GetLatestBlock$/);
  assert.throws(() => grpc.grpc('https://light.invalid', rpcOptions({ fetch: 1 })), { code: 'INVALID_ARGUMENT' });
});
