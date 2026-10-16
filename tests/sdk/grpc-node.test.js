import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'vite';
import { readFileSync } from 'node:fs';
import { Server, ServerCredentials, Metadata, status } from '@grpc/grpc-js';
import { createGrpcNodeTransport } from '../../dist/src/clients/grpc-node.js';
import { isGrpcNotFound } from '../../dist/src/clients/grpc-status.js';

const unary = ['GetLatestBlock', 'GetLightdInfo', 'GetTransaction', 'GetAddressUtxos', 'GetTaddressBalance', 'GetTreeState', 'SendTransaction'];
const streams = ['GetSubtreeRoots', 'GetBlockRange', 'GetTaddressTransactions', 'GetMempoolStream'];
const options = { sourceId: 'synthetic', timeoutMs: 1000 };
const args = (method, request = new Uint8Array([8, 1, 18, 2, 0, 255])) => ({ method, request });
const code = expected => error => error.code === expected && !error.message.includes('SECRET');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('only actual native NOT_FOUND retains private absence identity', async t => {
  const create = await fixture(t, (method, call, callback) => callback({ code: status.NOT_FOUND, details: 'SECRET' }));
  await assert.rejects(create().unary(args('GetTransaction')), error => error.code === 'TRANSPORT_ERROR' && isGrpcNotFound(error));
  assert.equal(isGrpcNotFound({ code: 5 }), false);
  await assert.rejects(create({ headers: async () => { throw { code: 5 }; } }).unary(args('GetTransaction')),
    error => error.code === 'INVALID_ARGUMENT' && !isGrpcNotFound(error));
});

test('native transient status marks read-retry eligibility without replaying the adapter call', async t => {
  let calls = 0;
  const create = await fixture(t, (method, call, callback) => { calls++; callback({ code: status.UNAVAILABLE, details: 'SECRET' }); });
  await assert.rejects(create().unary(args('GetTransaction')), error => error.code === 'TRANSPORT_ERROR' && error.retryable);
  assert.equal(calls, 1);
});

test('native terminal stream UNAVAILABLE retains transient status without replay', async t => {
  let calls = 0;
  const create = await fixture(t, (method, call) => { calls++; call.emit('error', { code: status.UNAVAILABLE, details: 'SECRET' }); });
  const iterator = create().stream(args('GetMempoolStream'));
  await assert.rejects(iterator.next(), error => error.code === 'TRANSPORT_ERROR' && error.retryable);
  await iterator.return(); assert.equal(calls, 1);
});

async function fixture(t, handler) {
  const server = new Server();
  const service = {}, implementation = {};
  for (const method of [...unary, ...streams]) {
    service[method] = { path: '/cash.z.wallet.sdk.rpc.CompactTxStreamer/' + method,
      requestStream: false, responseStream: streams.includes(method),
      requestSerialize: Buffer.from, requestDeserialize: Buffer.from,
      responseSerialize: Buffer.from, responseDeserialize: Buffer.from };
    implementation[method] = (call, callback) => handler(method, call, callback);
  }
  server.addService(service, implementation);
  t.after(() => server.forceShutdown());
  const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(),
    (error, port) => error ? reject(error) : resolve(port)));
  return (overrides = {}) => createGrpcNodeTransport(`http://127.0.0.1:${port}`, { ...options, ...overrides });
}

test('native byte methods, metadata, owned request, terminal success', async t => {
  const seen = [];
  const create = await fixture(t, (method, call, callback) => {
    seen.push(method);
    assert.deepEqual(call.metadata.get('authorization'), ['Bearer SECRET']);
    const metadata = new Metadata(); metadata.set('fixture-bin', Buffer.from([0, 255]));
    call.sendMetadata(metadata);
    if (callback) callback(null, call.request, metadata);
    else { call.write(call.request); call.write(Buffer.from([0, 255])); call.end(metadata); }
  });
  const transport = create({ headers: async () => ({ authorization: 'Bearer SECRET' }) });
  assert.equal(transport.kind, 'custom-lightwallet');
  assert.match(transport.protocolRevision, /^lightwire:80575/);
  for (const method of unary) assert.deepEqual(await transport.unary(args(method)), args(method).request);
  for (const method of streams) {
    const request = new Uint8Array([8, 1]);
    const iterator = transport.stream(args(method, request)); request.fill(99);
    const values = [];
    for await (const value of iterator) values.push([...value]);
    assert.deepEqual(values, [[8, 1], [0, 255]]);
  }
  assert.deepEqual(seen, [...unary, ...streams]);
  assert.deepEqual(await transport.unary(args('GetLatestBlock', new Uint8Array())), new Uint8Array());
});

test('status errors are sanitized, NOT_FOUND stays failure, no broadcast replay', async t => {
  let calls = 0;
  const create = await fixture(t, (method, call, callback) => {
    calls++;
    const error = { code: method === 'GetLightdInfo' ? status.UNIMPLEMENTED : status.NOT_FOUND, details: 'SECRET' };
    // grpc-js finalizes status on error + end; destroy prevents writable finalization.
    if (callback) callback(error); else { call.write(Buffer.from([1])); setTimeout(() => call.emit('error', error), 20); }
  });
  const transport = create();
  await assert.rejects(transport.unary(args('GetLightdInfo')), code('METHOD_NOT_SUPPORTED'));
  await assert.rejects(transport.unary(args('SendTransaction')), code('TRANSPORT_ERROR'));
  const iterator = transport.stream(args('GetBlockRange'));
  assert.deepEqual([...(await iterator.next()).value], [1]);
  await assert.rejects(iterator.next(), code('TRANSPORT_ERROR'));
  assert.equal((await iterator.next()).done, true);
  assert.equal(calls, 3);
});

test('deadline, abort, iterator return release actual calls including pending next', async t => {
  let cancelled = 0;
  const create = await fixture(t, (method, call) => {
    call.on('cancelled', () => cancelled++);
    if (method === 'GetBlockRange') call.write(Buffer.from([1]));
  });
  await assert.rejects(create({ timeoutMs: 50 }).unary(args('GetLatestBlock')), code('TIMEOUT'));
  const controller = new AbortController();
  const pending = create().unary({ ...args('GetLatestBlock'), signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, code('ABORTED'));
  const stream = create().stream(args('GetBlockRange'));
  await stream.next();
  const next = stream.next();
  const rejected = assert.rejects(next, code('ABORTED'));
  await stream.return(); await rejected;
  const idle = create({ timeoutMs: 50 }).stream(args('GetBlockRange'));
  await idle.next(); await delay(80);
  await assert.rejects(idle.next(), code('TIMEOUT'));
  await delay(50);
  assert.equal(cancelled, 4);
});

test('message, aggregate and count limits', async t => {
  const create = await fixture(t, (method, call, callback) => {
    if (callback) callback(null, Buffer.alloc(9));
    else { call.write(Buffer.alloc(3)); call.write(Buffer.alloc(3)); call.end(); }
  });
  await assert.rejects(create({ limits: { messageBytes: 8 } }).unary(args('GetLatestBlock', new Uint8Array())), code('RESOURCE_LIMIT'));
  for (const limits of [{ totalBytes: 5 }, { messages: 1 }]) {
    const stream = create({ limits }).stream(args('GetBlockRange'));
    await stream.next(); await assert.rejects(stream.next(), code('RESOURCE_LIMIT'));
  }
});

test('native cancellation survives caller event interference and releases streams', async t => {
  let cancelled = 0;
  const create = await fixture(t, (_method, call) => {
    call.on('cancelled', () => cancelled++);
    call.write(Buffer.from([1]));
  });
  for (const pendingRead of [false, true]) {
    const controller = new AbortController();
    controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
    const stream = create().stream({ ...args('GetBlockRange'), signal: controller.signal });
    await stream.next();
    const pending = pendingRead ? stream.next() : undefined;
    const rejected = pending && assert.rejects(pending, code('ABORTED'));
    controller.abort();
    if (rejected) await rejected;
    else await assert.rejects(stream.next(), code('ABORTED'));
  }
  await delay(50);
  assert.equal(cancelled, 2);
});

test('synthetic abort events do not cancel metadata waits or hide later native abort', async t => {
  const create = await fixture(t, (_method, call, callback) => callback(null, call.request));
  for (const abort of [false, true]) {
    const controller = new AbortController();
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const headers = new Promise(resolve => { release = resolve; });
    const pending = create({ headers: () => { entered(); return headers; } })
      .unary({ ...args('GetLatestBlock'), signal: controller.signal });
    const result = abort ? assert.rejects(pending, code('ABORTED')) : pending;
    await started;
    controller.signal.dispatchEvent(new Event('abort'));
    assert.equal(controller.signal.aborted, false);
    if (abort) controller.abort();
    else release({});
    const value = await result;
    if (!abort) assert.deepEqual(value, args('GetLatestBlock').request);
  }
});

test('local validation, pre-abort and stalled metadata never dispatch', async () => {
  for (const url of ['http://user:SECRET@localhost', 'http://localhost/path', 'http://localhost?secret', 'ftp://localhost'])
    assert.throws(() => createGrpcNodeTransport(url, options), code('INVALID_ARGUMENT'));
  const transport = createGrpcNodeTransport('http://127.0.0.1:1', options);
  await assert.rejects(transport.unary(args('Ping')), code('INVALID_ARGUMENT'));
  assert.throws(() => transport.stream(args('GetLatestBlock')), code('INVALID_ARGUMENT'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transport.unary({ ...args('GetLatestBlock'), signal: controller.signal }), code('ABORTED'));
  const stalled = createGrpcNodeTransport('http://127.0.0.1:1', { ...options, timeoutMs: 20, headers: () => new Promise(() => {}) });
  await assert.rejects(stalled.unary(args('GetLatestBlock')), code('TIMEOUT'));
  const stalledStream = stalled.stream(args('GetBlockRange'));
  const pending = stalledStream.next();
  const rejected = assert.rejects(pending, code('ABORTED'));
  await stalledStream.return(); await rejected;
  const unused = transport.stream(args('GetBlockRange'));
  await unused.return(); assert.equal((await unused.next()).done, true);
  const bad = createGrpcNodeTransport('http://127.0.0.1:1', { ...options, headers: async () => ({ 'grpc-timeout': 'SECRET' }) });
  await assert.rejects(bad.unary(args('GetLatestBlock')), code('INVALID_ARGUMENT'));
});

test('browser condition excludes native entry and root dependency graph stays browser safe', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
  assert.equal(pkg.dependencies['@grpc/grpc-js'], '1.14.4');
  assert.equal(pkg.exports['./grpc-node'].default, undefined);
  assert.equal(pkg.exports['./grpc-node'].import, undefined);
  // Resolve with browser conditions and without Node conditions using installed Vite.
  const output = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, lib: { entry: 'dist/src/index.js', formats: ['es'] }, minify: false } });
  const code = [output].flat().flatMap(result => result.output).map(item => item.code ?? '').join('');
  assert.doesNotMatch(code, /grpc-js|node:http2|node:net/);
  await assert.rejects(build({ configFile: false, logLevel: 'silent', resolve: { conditions: ['browser'] },
    plugins: [{ name: 'native-entry-probe', resolveId(id) { if (id === 'probe') return '\0probe'; },
      load(id) { if (id === '\0probe') return "import { createGrpcNodeTransport } from '@zcashlabs/zcash.js/grpc-node'; export { createGrpcNodeTransport };"; } }],
    build: { write: false, lib: { entry: 'probe', formats: ['es'] } } }),
    /No known conditions|Missing|Failed to resolve|Could not resolve|Cannot resolve/);
});

for (const [status, code, recovery, retryable] of [
  [1, 'ABORTED', 'none', false],
  [4, 'TIMEOUT', 'none', true],
  [8, 'RESOURCE_LIMIT', 'configure', false],
  [12, 'METHOD_NOT_SUPPORTED', 'configure', false],
]) test(`server status ${status} uses the shared transport error policy`, async t => {
  const create = await fixture(t, (_method, _call, callback) => callback({ code: status, details: 'PRIVATE_SENTINEL' }));
  await assert.rejects(create().unary(args('GetLatestBlock')), error => {
    assert.equal(error.code, code); assert.equal(error.recovery, recovery); assert.equal(error.retryable, retryable);
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /PRIVATE_SENTINEL/);
    return true;
  });
});
