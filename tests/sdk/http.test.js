import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import * as sdk from '@zcashlabs/zcash.js';

const internal = await import('../../dist/src/http.js');
const options = (extra = {}) => ({ sourceId: 'synthetic', timeoutMs: 1000,
  readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 4096, ...extra });
const call = (transport, signal) => internal.readRpc(transport, 'getblockchaininfo', [], signal);
const response = (request, result = 'ok') => new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));

function mockFetch(t, callback) { t.mock.method(globalThis, 'fetch', callback); }

test('httpTransport is lazy, opaque, validates every option and snapshots policy', async (t) => {
  let calls = 0;
  mockFetch(t, async (_url, init) => { calls++; return response(JSON.parse(init.body)); });
  const policy = options();
  const transport = sdk.httpTransport('https://synthetic.invalid/token?secret=hidden', policy);
  assert.deepEqual(Object.keys(transport), []);
  assert.equal(calls, 0);
  policy.readRetry.attempts = 0;
  assert.equal(await call(transport), 'ok');
  assert.equal(calls, 1);
  for (const url of ['', '/relative', 'ftp://synthetic.invalid', 'https://user:pass@synthetic.invalid',
    'https://synthetic.invalid/#fragment']) assert.throws(() => sdk.httpTransport(url, options()), { code: 'INVALID_ARGUMENT' });
  for (const extra of [{ sourceId: '' }, { timeoutMs: 0 }, { timeoutMs: NaN }, { timeoutMs: 1.2 },
    { timeoutMs: Number.MAX_SAFE_INTEGER + 1 }, { maxResponseBytes: 0 }, { headers: {} },
    { readRetry: { attempts: 0, delayMs: 0 } }, { readRetry: { attempts: 1, delayMs: -1 } },
    { readRetry: { attempts: 1, delayMs: 0, unknown: true } }, { unknown: true }, { [Symbol()]: true }]) {
    assert.throws(() => sdk.httpTransport('https://synthetic.invalid', options(extra)), { code: 'INVALID_ARGUMENT' });
  }
  await assert.rejects(call({}), { code: 'INVALID_ARGUMENT' });
});

test('non-enumerable supported options retain byte limits, deadlines and retry policy', async (t) => {
  let mode = 'large';
  let calls = 0;
  mockFetch(t, async (_url, init) => {
    calls++;
    if (mode === 'stall') return new Promise(() => {});
    if (mode === 'retry' && calls === 1) return new Response('', { status: 503 });
    return response(JSON.parse(init.body), mode === 'large' ? 'x'.repeat(8192) : 'ok');
  });
  const policy = {};
  const retry = {};
  for (const [key, value] of Object.entries({ attempts: 2, delayMs: 0 })) {
    Object.defineProperty(retry, key, { value });
  }
  for (const [key, value] of Object.entries(options({ timeoutMs: 20, maxResponseBytes: 64, readRetry: retry }))) {
    Object.defineProperty(policy, key, { value });
  }
  const transport = sdk.httpTransport('https://synthetic.invalid', policy);
  await assert.rejects(call(transport), { code: 'RESOURCE_LIMIT' });
  mode = 'stall';
  const controller = new AbortController();
  const fallback = setTimeout(() => controller.abort(), 500);
  try { await assert.rejects(call(transport, controller.signal), { code: 'TIMEOUT' }); }
  finally { clearTimeout(fallback); }
  mode = 'retry';
  calls = 0;
  assert.equal(await call(transport), 'ok');
  assert.equal(calls, 2);
});

test('supported option getters are read once and their first values are validated and stored', async (t) => {
  const reads = {};
  const changing = (values, prefix = '') => Object.fromEntries(Object.entries(values).map(([key, value]) => {
    return [key, { enumerable: true, get() {
      const name = prefix + key;
      reads[name] = (reads[name] ?? 0) + 1;
      return reads[name] === 1 ? value : undefined;
    } }];
  }));
  const retry = Object.defineProperties({}, changing({ attempts: 1, delayMs: 0 }, 'retry.'));
  const policy = Object.defineProperties({}, changing(options({ readRetry: retry,
    headers: async () => ({ Authorization: 'first' }) })));
  mockFetch(t, async (_url, init) => {
    assert.equal(init.headers.get('authorization'), 'first');
    return response(JSON.parse(init.body));
  });
  const transport = sdk.httpTransport('https://synthetic.invalid', policy);
  assert.equal(await call(transport), 'ok');
  assert.deepEqual(reads, { sourceId: 1, timeoutMs: 1, readRetry: 1, maxResponseBytes: 1,
    headers: 1, 'retry.attempts': 1, 'retry.delayMs': 1 });
  let invalidReads = 0;
  const invalid = options();
  Object.defineProperty(invalid, 'timeoutMs', { get() { return ++invalidReads === 1 ? 0 : 1000; } });
  assert.throws(() => sdk.httpTransport('https://synthetic.invalid', invalid), { code: 'INVALID_ARGUMENT' });
  assert.equal(invalidReads, 1);
});

test('wire requests use POST, distinct string IDs, explicit credentials, no redirect/cache and exact params', async (t) => {
  const requests = [];
  mockFetch(t, async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(url, 'https://synthetic.invalid/');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.get('content-type'), 'application/json');
    assert.equal(init.headers.get('authorization'), 'synthetic-token');
    await new Promise(resolve => setTimeout(resolve, requests.length === 1 ? 15 : 0));
    return response(body, body.params);
  });
  const transport = sdk.httpTransport('https://synthetic.invalid', options({ headers: async () => ({ Authorization: 'synthetic-token' }) }));
  const results = await Promise.all([internal.readRpc(transport, 'getblockhash', [0]), internal.readRpc(transport, 'getblockhash', [123])]);
  assert.equal(results[0][0].text, '0');
  assert.equal(results[1][0].text, '123');
  assert.equal(requests[0].jsonrpc, '2.0');
  assert.equal(requests[0].method, 'getblockhash');
  assert.equal(typeof requests[0].id, 'string');
  assert.notEqual(requests[0].id, requests[1].id);
  await assert.rejects(internal.readRpc(transport, 'sendrawtransaction', ['00']), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(internal.readRpc(transport, 'getblockhash', [1n]), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(internal.readRpc(transport, 'getblockhash', [Number.MAX_SAFE_INTEGER + 1]), { code: 'INVALID_ARGUMENT' });
});

for (const enumerable of [true, false]) {
  test(`header getters are captured once (enumerable=${enumerable})`, async (t) => {
    let reads = 0;
    const received = [];
    const headers = Object.defineProperty({}, 'Authorization', { enumerable,
      get() { return ++reads === 1 ? 'expected-token' : undefined; } });
    mockFetch(t, async (_url, init) => {
      received.push(init.headers.get('authorization'));
      return response(JSON.parse(init.body));
    });
    await call(sdk.httpTransport('https://synthetic.invalid', options({ headers: async () => headers })));
    assert.deepEqual(received, ['expected-token']);
    assert.equal(reads, 1);
  });

  test(`parameter getters retain validated primitives across retries (enumerable=${enumerable})`, async (t) => {
    let reads = 0;
    let serializations = 0;
    const params = Object.defineProperty([], '0', { enumerable,
      get() { return ++reads === 1 ? 7 : { toJSON() { return ++serializations; } }; } });
    const received = [];
    mockFetch(t, async (_url, init) => {
      const request = JSON.parse(init.body);
      received.push(request);
      return received.length === 1 ? new Response('', { status: 503 }) : response(request);
    });
    const transport = sdk.httpTransport('https://synthetic.invalid', options({ readRetry: { attempts: 2, delayMs: 0 } }));
    await internal.readRpc(transport, 'getblockhash', params);
    assert.deepEqual(received.map(request => request.params), [[7], [7]]);
    assert.notEqual(received[0].id, received[1].id);
    assert.equal(reads, 1);
    assert.equal(serializations, 0);
  });
}

for (const variant of ['custom iterator', 'overridden some', 'hole', 'object', 'undefined', 'null']) {
  test(`parameter snapshot rejects ${variant} before serialization`, async (t) => {
    let dispatches = 0;
    let serializations = 0;
    const unsupported = { toJSON() { serializations++; return 7; } };
    mockFetch(t, async (_url, init) => { dispatches++; return response(JSON.parse(init.body)); });
    const transport = sdk.httpTransport('https://synthetic.invalid', options());
    const overriddenSome = [unsupported];
    overriddenSome.some = () => false;
    const customIterator = [7];
    customIterator[Symbol.iterator] = function* () { yield unsupported; };
    const params = { 'custom iterator': customIterator, 'overridden some': overriddenSome,
      hole: Array(1), object: [unsupported], undefined: [undefined], null: [null] }[variant];
    await assert.rejects(internal.readRpc(transport, 'getblockhash', params), { code: 'INVALID_ARGUMENT' });
    assert.equal(serializations, 0);
    assert.equal(dispatches, 0);
  });
}

test('malformed replies and mismatched IDs never become successful/absent results', async (t) => {
  const malformed = [
    id => ({ jsonrpc: '1.0', id, result: null }), id => ({ jsonrpc: '2.0', id: `${id}x`, result: null }),
    id => ({ jsonrpc: '2.0', id: Number(id), result: null }), id => ({ jsonrpc: '2.0', id }),
    id => ({ jsonrpc: '2.0', id, result: null, error: null }), id => ({ jsonrpc: '2.0', id, result: 1, extra: true }),
    id => ({ jsonrpc: '2.0', id, error: { code: '-32601', message: 'foreign' } }),
    id => ({ jsonrpc: '2.0', id, error: { code: -32601 } }), () => [], () => null,
  ];
  let current;
  mockFetch(t, async (_url, init) => new Response(JSON.stringify(current(JSON.parse(init.body).id))));
  const transport = sdk.httpTransport('https://synthetic.invalid', options());
  for (current of malformed) await assert.rejects(call(transport), { code: 'PROTOCOL_MISMATCH' });
});

test('RPC errors are distinct from absence, sanitized, and not retried', async (t) => {
  let calls = 0;
  let code = -32601;
  mockFetch(t, async (_url, init) => {
    calls++;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id,
      error: { code, message: 'private-server-text', data: 'private-server-data' } }));
  });
  const transport = sdk.httpTransport('https://synthetic.invalid/private-path', options({ readRetry: { attempts: 3, delayMs: 0 } }));
  await assert.rejects(call(transport), { code: 'METHOD_NOT_SUPPORTED', retryable: false });
  code = -5;
  await assert.rejects(call(transport), error => {
    assert.equal(error.code, 'TRANSPORT_ERROR');
    assert.equal(error.retryable, false);
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /private-/);
    return true;
  });
  assert.equal(calls, 2);
});

test('structured RPC errors survive HTTP error statuses without read replay', async (t) => {
  let calls = 0;
  mockFetch(t, async (_url, init) => {
    calls++;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id,
      error: { code: -32601, message: 'private-server-text' } }), { status: 500 });
  });
  await assert.rejects(call(sdk.httpTransport('https://synthetic.invalid', options({ readRetry: { attempts: 3, delayMs: 0 } }))),
    { code: 'METHOD_NOT_SUPPORTED', retryable: false });
  assert.equal(calls, 1);
});

test('a retry uses the original parameter snapshot', async (t) => {
  const params = [0];
  const received = [];
  mockFetch(t, async (_url, init) => {
    const request = JSON.parse(init.body);
    received.push(request.params[0]);
    params[0] = 99;
    return received.length === 1 ? new Response('', { status: 503 }) : response(request);
  });
  const transport = sdk.httpTransport('https://synthetic.invalid', options({ readRetry: { attempts: 2, delayMs: 0 } }));
  await internal.readRpc(transport, 'getblockhash', params);
  assert.deepEqual(received, [0, 0]);
});

test('retry backoff is abortable and credentials failures never dispatch or disclose', async (t) => {
  let calls = 0;
  const controller = new AbortController();
  mockFetch(t, async () => { calls++; setTimeout(() => controller.abort('private'), 5); return new Response('', { status: 503 }); });
  const transport = sdk.httpTransport('https://synthetic.invalid', options({ readRetry: { attempts: 5, delayMs: 1000 } }));
  await assert.rejects(call(transport, controller.signal), { code: 'ABORTED' });
  assert.equal(calls, 1);
  for (const headers of [async () => { throw Error('private-header'); }, async () => ({ X: 'bad\nheader' }), async () => null]) {
    await assert.rejects(call(sdk.httpTransport('https://synthetic.invalid/private', options({ headers }))), error => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /private-header|bad\nheader|invalid\/private/);
      return true;
    });
  }
  assert.equal(calls, 1);
});

test('transport rejects invalid UTF-8, empty/truncated bodies and wrong lengths', async (t) => {
  let content;
  let headers;
  mockFetch(t, async () => new Response(content, { headers }));
  const transport = sdk.httpTransport('https://synthetic.invalid', options({ maxResponseBytes: 64 }));
  for (content of ['', '{', '\ufeff{}', new Uint8Array([0xe2, 0x82])]) {
    await assert.rejects(call(transport), { code: 'PROTOCOL_MISMATCH' });
  }
  content = '{}';
  headers = { 'content-length': '65' };
  await assert.rejects(call(transport), { code: 'RESOURCE_LIMIT' });
  headers = { 'content-length': '-1' };
  await assert.rejects(call(transport), { code: 'PROTOCOL_MISMATCH' });
});

test('native response wrapper preserves numeric tokens and checks container depth', async (t) => {
  let result = '{"n":9007199254740993,"amount":0.123456789012345678,"exp":1e400,"__proto__":{"safe":true}}';
  mockFetch(t, async (_url, init) => new Response(
    `{"jsonrpc":"2.0","id":${JSON.stringify(JSON.parse(init.body).id)},"result":${result}}`,
  ));
  const transport = sdk.httpTransport('https://synthetic.invalid', options());
  const value = await call(transport);
  assert.equal(value.n.text, '9007199254740993');
  assert.equal(value.amount.text, '0.123456789012345678');
  assert.equal(value.exp.text, '1e400');
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(value.__proto__.safe, true);
  // The RPC envelope counts as one container.
  result = '['.repeat(63) + '0' + ']'.repeat(63);
  await call(transport);
  result = '['.repeat(64) + '0' + ']'.repeat(64);
  await assert.rejects(call(transport), { code: 'PROTOCOL_MISMATCH' });
});

test('numeric responses reject when native parsing lacks reviver source support', async (t) => {
  const nativeParse = JSON.parse;
  t.mock.method(JSON, 'parse', (text, reviver) => nativeParse(text, reviver && function (key, value) {
    return reviver.call(this, key, value);
  }));
  mockFetch(t, async (_url, init) => response(JSON.parse(init.body), 42));
  const transport = sdk.httpTransport('https://synthetic.invalid', options());
  await assert.rejects(call(transport), { code: 'PROTOCOL_MISMATCH' });
});

test('byte accounting spans chunks and cancellation settles even when stream cancel hangs', async (t) => {
  let cancelled = 0;
  mockFetch(t, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(40)); controller.enqueue(new Uint8Array(40)); },
    cancel() { cancelled++; return new Promise(() => {}); },
  })));
  const transport = sdk.httpTransport('https://synthetic.invalid', options({ maxResponseBytes: 64, timeoutMs: 30 }));
  await assert.rejects(call(transport), { code: 'RESOURCE_LIMIT' });
  assert.equal(cancelled, 1);
});

test('an abort only cancels its own concurrent request and releases a stalled body', async (t) => {
  let cancelled = 0;
  let entered;
  const bodyStarted = new Promise(resolve => { entered = resolve; });
  mockFetch(t, async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.params[0] !== 'stall') return response(request, null);
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')); entered(); },
      cancel() { cancelled++; },
    }));
  });
  const transport = sdk.httpTransport('https://synthetic.invalid', options());
  const controller = new AbortController();
  const stalled = internal.readRpc(transport, 'getblockchaininfo', ['stall'], controller.signal);
  const good = call(transport);
  await bodyStarted;
  controller.abort();
  await assert.rejects(stalled, { code: 'ABORTED' });
  assert.equal(await good, null);
  assert.equal(cancelled, 1);
});

test('read retry attempts include first dispatch, keep one endpoint, and use fresh IDs', async (t) => {
  const ids = [];
  const urls = [];
  mockFetch(t, async (url, init) => {
    urls.push(url);
    const request = JSON.parse(init.body);
    ids.push(request.id);
    return ids.length < 3 ? new Response('private-server-error', { status: 503 }) : response(request);
  });
  assert.equal(await call(sdk.httpTransport('https://synthetic.invalid', options({ readRetry: { attempts: 3, delayMs: 1 } }))), 'ok');
  assert.equal(new Set(ids).size, 3);
  assert.equal(new Set(urls).size, 1);
});

test('caller abort and timeout bound both headers and fetch, ignoring private abort reasons', async (t) => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return new Promise(() => {}); });
  const aborted = new AbortController();
  aborted.abort('private-abort-reason');
  await assert.rejects(call(sdk.httpTransport('https://synthetic.invalid', options()), aborted.signal), { code: 'ABORTED' });
  assert.equal(calls, 0);
  const timeoutTransport = sdk.httpTransport('https://synthetic.invalid', options({ timeoutMs: 20 }));
  await assert.rejects(call(timeoutTransport), { code: 'TIMEOUT' });
  const hangingHeaders = sdk.httpTransport('https://synthetic.invalid', options({ timeoutMs: 20, headers: async () => new Promise(() => {}) }));
  await assert.rejects(call(hangingHeaders), { code: 'TIMEOUT' });
  assert.equal(calls, 1);
  const controller = new AbortController();
  const pending = call(timeoutTransport, controller.signal);
  controller.abort(new Error('private-abort-reason'));
  await assert.rejects(pending, error => error.code === 'ABORTED' && !error.message.includes('private'));
});

test('expired synchronous header acquisition or processing never dispatches HTTP', async (t) => {
  let calls = 0;
  mockFetch(t, async (_url, init) => { calls++; return response(JSON.parse(init.body)); });
  const exceedDeadline = () => {
    const started = performance.now();
    while (performance.now() - started < 60) { /* Keep the timeout timer from running. */ }
  };
  for (const headers of [
    async () => { exceedDeadline(); return {}; },
    async () => ({ get Authorization() { exceedDeadline(); return 'synthetic-token'; } }),
  ]) {
    const transport = sdk.httpTransport('https://synthetic.invalid', options({ timeoutMs: 10, headers }));
    await assert.rejects(call(transport), { code: 'TIMEOUT' });
    assert.equal(calls, 0);
  }
});

test('body byte limits and UTF-8 validation apply to actual stream bytes and release the reader', async (t) => {
  let cancelled = 0;
  let mode = 'large';
  mockFetch(t, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(mode === 'large' ? new Uint8Array(65) : new Uint8Array([0xff])); },
    cancel() { cancelled++; },
  })));
  const transport = sdk.httpTransport('https://synthetic.invalid', options({ maxResponseBytes: 64, timeoutMs: 30 }));
  await assert.rejects(call(transport), { code: 'RESOURCE_LIMIT' });
  mode = 'invalid';
  await assert.rejects(call(transport), { code: 'PROTOCOL_MISMATCH' });
  assert.equal(cancelled, 2);
});

test('isolated HTTP server exercises real serialization, streaming, precision and abort', async (t) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    requests.push(body);
    if (body.params[0] === 'stall') { res.writeHead(200); res.write('{'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(`{"jsonrpc":"2.0","id":${JSON.stringify(body.id)},"result":{"value":`);
    res.end('9007199254740993}}');
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`Loopback denied (${error.code}); coordinator: node --test --test-name-pattern="isolated HTTP" tests/sdk/http.test.js`);
      return;
    }
    throw error;
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const transport = sdk.httpTransport(`http://127.0.0.1:${server.address().port}`, options({ timeoutMs: 200 }));
  assert.equal((await call(transport)).value.text, '9007199254740993');
  await assert.rejects(internal.readRpc(transport, 'getblockchaininfo', ['stall']), { code: 'TIMEOUT' });
  assert.equal(requests.length, 2);
});

test('public RPC foundation owns structured reads and never replays dispatched writes', async (t) => {
  const requests = [];
  let mode = 'success', notify;
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const request = JSON.parse(text); requests.push(request); notify?.();
    if (mode === 'stall') return;
    if (mode === 'drop') { req.socket.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(mode === 'error'
      ? { error: { code: -5, message: 'SECRET provider message' } } : { result: request.params }) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  let release;
  const transport = sdk.httpTransport(url, options({ readRetry: { attempts: 3, delayMs: 0 },
    headers: () => new Promise(resolve => { release = () => resolve({}); }) }));
  assert.equal(internal.httpSourceId(transport), 'synthetic');
  const addresses = ['original'];
  const input = { addresses, chainInfo: true };
  const reading = internal.readRpc(transport, 'getaddressutxos', [input]);
  addresses[0] = 'mutated'; input.chainInfo = false;
  await new Promise(resolve => setImmediate(resolve)); release();
  assert.equal(JSON.stringify(await reading), JSON.stringify([{ addresses: ['original'], chainInfo: true }]));
  for (const invalid of [{ addresses: [], chainInfo: true }, { addresses: ['a'], chainInfo: false },
    { addresses: ['a'], chainInfo: true, extra: 1 }, { addresses: new Array(1025).fill('a'), chainInfo: true }]) {
    await assert.rejects(internal.readRpc(transport, 'getaddressutxos', [invalid]), { code: 'INVALID_ARGUMENT' });
  }
  const direct = sdk.httpTransport(url, options({ readRetry: { attempts: 3, delayMs: 0 } }));
  mode = 'error';
  await assert.rejects(call(direct), error => internal.rpcErrorCode(error) === -5 && !error.message.includes('SECRET'));
  assert.equal(internal.rpcErrorCode({ code: -5 }), undefined);
  let before = requests.length;
  const rejected = await internal.sendRawTransaction(direct, '00');
  assert.equal(internal.rpcErrorCode(rejected.error), -5); assert.equal(requests.length, before + 1);
  mode = 'drop'; before = requests.length;
  assert.equal((await internal.sendRawTransaction(direct, '00')).error.code, 'TRANSPORT_ERROR');
  assert.equal(requests.length, before + 1);
  mode = 'stall'; before = requests.length;
  const controller = new AbortController();
  const received = new Promise(resolve => { notify = resolve; });
  const sending = internal.sendRawTransaction(direct, '00', controller.signal);
  await received; controller.abort();
  assert.equal((await sending).error.code, 'ABORTED'); assert.equal(requests.length, before + 1);
  await assert.rejects(internal.sendRawTransaction(direct, '00', controller.signal), { code: 'ABORTED' });
  assert.equal(requests.length, before + 1);
  const beforeHeaders = new AbortController();
  const pending = internal.sendRawTransaction(transport, '00', beforeHeaders.signal);
  await new Promise(resolve => setImmediate(resolve)); beforeHeaders.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal(requests.length, before + 1); release();
});

test('fragmented UTF-8 decoding keeps exact numbers and counts bytes rather than characters', async t => {
  const text = '{"jsonrpc":"2.0","id":"1","result":{"text":"雪🙂","amount":9007199254740993}}';
  const bytes = new TextEncoder().encode(text);
  let body;
  mockFetch(t, async () => {
    let offset = 0;
    body = new ReadableStream({ pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.slice(offset, ++offset));
    } });
    return new Response(body);
  });
  const result = await call(sdk.httpTransport('https://synthetic.invalid', options({ maxResponseBytes: bytes.length })));
  assert.equal(result.text, '雪🙂');
  assert.equal(result.amount.text, '9007199254740993');
  assert.equal(body.locked, false);
  await assert.rejects(call(sdk.httpTransport('https://synthetic.invalid', options({ maxResponseBytes: bytes.length - 1 }))),
    { code: 'RESOURCE_LIMIT' });
  assert.equal(body.locked, false);
});

test('HTTP status translation preserves the distinction between RPC, JSON and UTF-8 failures', async t => {
  let content;
  mockFetch(t, async () => new Response(content, { status: 503 }));
  const transport = sdk.httpTransport('https://synthetic.invalid', options());
  content = '{"jsonrpc":"2.0","id":"1","error":{"code":-5,"message":"private-server-text"}}';
  await assert.rejects(call(transport), error => internal.rpcErrorCode(error) === -5 && !error.retryable);
  content = 'not a JSON response';
  await assert.rejects(call(transport), { code: 'TRANSPORT_ERROR', retryable: true });
  content = new Uint8Array([0xe2, 0x82]);
  await assert.rejects(call(transport), { code: 'PROTOCOL_MISMATCH' });
});

test('cancellation at body-decoder completion cannot publish a successful RPC result', async t => {
  const controller = new AbortController();
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, 'decode', function (bytes, options) {
    const result = decode.call(this, bytes, options);
    if (bytes === undefined) queueMicrotask(() => controller.abort());
    return result;
  });
  let body;
  mockFetch(t, async (_url, init) => {
    const current = response(JSON.parse(init.body));
    body = current.body;
    return current;
  });
  await assert.rejects(call(sdk.httpTransport('https://synthetic.invalid', options()), controller.signal), { code: 'ABORTED' });
  assert.equal(body.locked, false);
});
