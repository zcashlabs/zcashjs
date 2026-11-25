import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Client } from '@grpc/grpc-js';
import { createGrpcNodeTransport } from '../../dist/src/clients/grpc-node.js';

const require = createRequire(import.meta.url);
const { createResolver, mapUriDefaultScheme } = require('@grpc/grpc-js/build/src/resolver.js');
const { parseUri } = require('@grpc/grpc-js/build/src/uri-parser.js');
const options = { sourceId: 'fixture', timeoutMs: 1000 };
const args = { method: 'GetLatestBlock', request: new Uint8Array() };
const invalid = { code: 'INVALID_ARGUMENT' };
const property = (key, value, enumerable) => Object.defineProperty({}, key, { value, enumerable, writable: true });

// Socket-free adapter diagnostics: real channel/Metadata/resolver, intercepted dispatch.
function intercept(t, inspect = () => {}) {
  let calls = 0, cancels = 0, closes = 0;
  const close = Client.prototype.close;
  t.mock.method(Client.prototype, 'close', function () { closes++; return close.call(this); });
  t.mock.method(Client.prototype, 'makeUnaryRequest', function (_method, _serialize, _deserialize, _request, metadata, _options, callback) {
    calls++;
    inspect(this.getChannel(), metadata);
    queueMicrotask(() => callback(null, new Uint8Array(6)));
    return { cancel() { cancels++; } };
  });
  t.after(() => { assert.equal(cancels, calls); assert.equal(closes, calls); });
}

test('F1 socket-free actual target and installed resolver preserve effective ports', async t => {
  let selected;
  intercept(t, channel => { selected = channel.getTarget(); });
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const [scheme, port, effective] of [['http', '', 80], ['http', ':80', 80], ['http', ':8080', 8080],
      ['https', '', 443], ['https', ':443', 443], ['https', ':8443', 8443]]) {
      const url = `${scheme}://${host}${port}`;
      await createGrpcNodeTransport(url, options).unary(args);
      assert.equal(selected, `dns:${host}:${effective}`, url);
      const resolver = createResolver(mapUriDefaultScheme(parseUri(selected)), {}, {});
      try {
        if (host === 'localhost') assert.equal(resolver.port, effective, url);
        else assert.deepEqual(resolver.ipResult[0].addresses[0], { host: host.replace(/^\[|\]$/g, ''), port: effective }, url);
      } finally { resolver.destroy(); }
    }
  }
});

for (const enumerable of [true, false]) {
  for (const [key, value, max] of [['messageBytes', 5, 4194304], ['totalBytes', 5, 67108864], ['messages', 1, 65536]]) {
    test(`F2 ${key} enumerable=${enumerable}: invalid values`, () => {
      for (const bad of [undefined, null, 0, -1, 1.5, NaN, Infinity, '1', max + 1])
        assert.throws(() => createGrpcNodeTransport('http://localhost', { ...options, limits: property(key, bad, enumerable) }), invalid);
    });
    test(`F2 ${key} enumerable=${enumerable}: validation and snapshot`, async t => {
      const limits = property(key, value, enumerable);
      const transport = createGrpcNodeTransport('http://localhost', { ...options, limits });
      limits[key] = max;
      if (key === 'messageBytes') {
        intercept(t);
        await assert.rejects(transport.unary({ ...args, request: new Uint8Array(6) }), { code: 'RESOURCE_LIMIT' });
      } else if (key === 'totalBytes') {
        intercept(t);
        await assert.rejects(transport.unary(args), { code: 'RESOURCE_LIMIT' });
      } else {
        const { Readable } = await import('node:stream');
        let cancels = 0, closes = 0;
        const close = Client.prototype.close;
        t.mock.method(Client.prototype, 'close', function () { closes++; return close.call(this); });
        t.mock.method(Client.prototype, 'makeServerStreamRequest', () => {
          const call = Readable.from([new Uint8Array(1), new Uint8Array(1)]);
          call.cancel = () => { cancels++; call.destroy(); };
          return call;
        });
        const stream = transport.stream({ ...args, method: 'GetBlockRange' });
        assert.equal((await stream.next()).value.length, 1);
        await assert.rejects(stream.next(), { code: 'RESOURCE_LIMIT' });
        assert.equal((await stream.next()).done, true);
        // Cleanup may cancel more than once; the leased channel closes exactly once.
        assert.ok(cancels >= 1); assert.equal(closes, 1);
      }
    });
  }
  test(`F2 metadata enumerable=${enumerable}: validation and snapshot`, async t => {
    let seen, callbacks = 0;
    const supplied = property('authorization', 'Bearer original', enumerable);
    intercept(t, (_channel, metadata) => {
      supplied.authorization = 'Bearer mutated';
      seen = metadata.get('authorization');
    });
    const configured = { ...options, headers: async () => { callbacks++; return supplied; } };
    const transport = createGrpcNodeTransport('http://localhost', configured);
    configured.headers = () => { throw Error('replacement must not run'); };
    await transport.unary(args);
    assert.deepEqual(seen, ['Bearer original']); assert.equal(callbacks, 1);
  });
  test(`F2 metadata enumerable=${enumerable}: rejected values`, async t => {
    intercept(t);
    for (const [key, value] of [['grpc-timeout', '1'], ['content-type', 'x'], ['host', 'x'], ['connection', 'x'],
      ['te', 'x'], ['user-agent', 'x'], ['x-bin', 'x'], ['Bad', 'x'], ['bad key', 'x'], ['ok', '\n'], ['ok', 1], ['ok', 'x'.repeat(8192)]]) {
      await assert.rejects(createGrpcNodeTransport('http://localhost', { ...options,
        headers: async () => property(key, value, enumerable) }).unary(args), invalid);
    }
    const aggregate = property('a', 'x'.repeat(4096), enumerable);
    Object.defineProperty(aggregate, 'b', { value: 'x'.repeat(4096), enumerable });
    await assert.rejects(createGrpcNodeTransport('http://localhost', { ...options, headers: async () => aggregate }).unary(args), invalid);
  });
}

test('F2 record exclusions do not invoke accessors or proxy traps', async () => {
  let effects = 0;
  const accessor = Object.defineProperty({}, 'totalBytes', { get() { effects++; return 1; } });
  const proxy = new Proxy({}, { ownKeys() { effects++; return []; }, getPrototypeOf() { effects++; return Object.prototype; } });
  for (const limits of [accessor, proxy, { [Symbol('limit')]: 1 }, property('unknown', 1, false)])
    assert.throws(() => createGrpcNodeTransport('http://localhost', { ...options, limits }), invalid);
  const headerAccessor = Object.defineProperty({}, 'authorization', { get() { effects++; return 'secret'; } });
  for (const headers of [headerAccessor, proxy, { [Symbol('header')]: 'x' }])
    await assert.rejects(createGrpcNodeTransport('http://localhost', { ...options, headers: async () => headers }).unary(args), invalid);
  assert.throws(() => createGrpcNodeTransport('http://localhost', { ...options, headers: {} }), invalid);
  assert.equal(effects, 0);
});

test('F3 channelIdleMs reuses one channel across operations and closes it once idle', async t => {
  let channels = 0, closes = 0, fail = null;
  const seen = new Set();
  const close = Client.prototype.close;
  t.mock.method(Client.prototype, 'close', function () { closes++; return close.call(this); });
  t.mock.method(Client.prototype, 'makeUnaryRequest', function (_m, _s, _d, _r, _md, _o, callback) {
    if (!seen.has(this)) { seen.add(this); channels++; }
    queueMicrotask(() => fail ? callback(fail) : callback(null, new Uint8Array(6)));
    return { cancel() {} };
  });
  for (const bad of [-1, 1.5, '1', 600_001]) {
    assert.throws(() => createGrpcNodeTransport('http://localhost', { ...options, channelIdleMs: bad }), invalid);
  }
  const transport = createGrpcNodeTransport('http://localhost', { ...options, channelIdleMs: 40 });
  await transport.unary(args);
  await Promise.all([transport.unary(args), transport.unary(args)]);
  await transport.unary(args);
  assert.equal(channels, 1, 'successive and concurrent operations share a channel');
  assert.equal(closes, 0, 'still open within the idle window');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(closes, 1, 'closed after the idle window');
  await transport.unary(args);
  assert.equal(channels, 2, 'a closed channel is replaced on demand');
  // A transport failure retires the channel immediately; the next operation opens a new one.
  fail = { code: 14, details: 'unavailable' };
  await assert.rejects(transport.unary(args), { code: 'TRANSPORT_ERROR' });
  assert.equal(closes, 2);
  fail = null;
  await transport.unary(args);
  assert.equal(channels, 3);
  // A missing record says nothing about the connection.
  fail = { code: 5, details: 'not found' };
  await assert.rejects(transport.unary(args));
  fail = null;
  await transport.unary(args);
  assert.equal(channels, 3);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(closes, 3);
});

test('F3 default channelIdleMs closes the channel when its last operation ends', async t => {
  let closes = 0;
  const close = Client.prototype.close;
  t.mock.method(Client.prototype, 'close', function () { closes++; return close.call(this); });
  t.mock.method(Client.prototype, 'makeUnaryRequest', (_m, _s, _d, _r, _md, _o, callback) => {
    queueMicrotask(() => callback(null, new Uint8Array(6)));
    return { cancel() {} };
  });
  const transport = createGrpcNodeTransport('http://localhost', options);
  await transport.unary(args);
  assert.equal(closes, 1);
});
