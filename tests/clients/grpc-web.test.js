import assert from 'node:assert/strict';
import test from 'node:test';
import { media, service, base64, frame, concat, trailer, good, serveFixtures, unaryMethods, streamMethods } from './grpc-web-fixtures.js';
const internal = await import('../../dist/src/clients/grpc-web.js');
const { isGrpcNotFound } = await import('../../dist/src/clients/grpc-status.js');
const options = (extra = {}) => ({ timeoutMs: 1000, ...extra });
const create = (url = 'https://synthetic.invalid', extra = {}) => internal.createGrpcWebByteTransport(url, options(extra));
const unary = (transport, request = new Uint8Array([8, 1]), signal) => transport.unary({ method: 'GetLatestBlock', request, ...(signal ? { signal } : {}) });
const stream = (transport, signal) => transport.stream({ method: 'GetBlockRange', request: new Uint8Array(), ...(signal ? { signal } : {}) });
const collect = async iterable => { const values = []; for await (const value of iterable) values.push([...value]); return values; };
const reply = (text = good(), headers = {}) => new Response(text, { headers: { 'content-type': media, ...headers } });

test('real localhost unary sends exact method/frame and requires terminal success', async t => {
  assert.equal(typeof internal.createGrpcWebByteTransport, 'function');
  const fixture = await serveFixtures();
  t.after(() => fixture.close());
  assert.deepEqual([...await unary(create(fixture.origin))], [8, 1]);
  assert.equal(fixture.requests.length, 1);
  const [request] = fixture.requests;
  assert.equal(request.path, service + 'GetLatestBlock');
  assert.equal(request.body, base64(frame(new Uint8Array([8, 1]))));
  assert.equal(request.headers['content-type'], media);
  assert.equal(request.headers.accept, media);
});

test('real localhost stream decodes single-character fragments with padded flushes inside frames', async t => {
  const fixture = await serveFixtures();
  t.after(() => fixture.close());
  assert.deepEqual(await collect(stream(create(fixture.origin + '?case=fragmented'))), [[1, 2, 3], [4]]);
});

test('terminal statuses support body/headers-only and never turn failed lookup into absence', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const terminal of [() => reply(base64(trailer('grpc-status: 0'))), () => reply('', { 'grpc-status': '0' })]) {
    response = terminal();
    assert.deepEqual(await collect(stream(create())), []);
    response = terminal();
    await assert.rejects(unary(create()), { code: 'PROTOCOL_MISMATCH' });
  }
  for (let status = 1; status <= 16; status++) {
    for (const headersOnly of [false, true]) {
      response = headersOnly ? reply('', { 'grpc-status': String(status), 'grpc-message': 'private-secret' })
        : reply(base64(trailer(`grpc-status: ${status}\r\ngrpc-message: private-secret\r\n`)));
      await assert.rejects(unary(create()), error => {
        assert.equal(error.code, ({1: 'ABORTED', 4: 'TIMEOUT', 8: 'RESOURCE_LIMIT', 12: 'METHOD_NOT_SUPPORTED'})[status] ?? 'TRANSPORT_ERROR');
        assert.equal(error.retryable, status === 4 || status === 14);
        assert.equal(error.recovery, status === 1 || status === 4 ? 'none' : 'configure');
        assert.equal(isGrpcNotFound(error), status === 5);
        assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /private-secret/);
        return true;
      });
    }
  }
});

test('malformed framing, status, compression, media and cardinality fail safely', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  const malformed = [
    '', good().slice(0, -1), '!!!!', 'AB==', 'AAB=', 'AA=A', '====', 'AA==\n',
    base64(frame(new Uint8Array([1]))), base64(new Uint8Array([0, 0, 0])),
    base64(new Uint8Array([0, 0, 0, 0, 2, 1])),
    ...[1, 2, 127, 129, 255].map(flag => base64(concat(frame(new Uint8Array([1]), flag), trailer()))),
    ...['', 'grpc-message: private-secret', 'grpc-status: ', 'grpc-status: 00', 'grpc-status: -1',
      'grpc-status: 17', 'grpc-status: 0, 0', 'grpc-status: 1x', 'grpc-status: 0\ngrpc-message: x',
      'grpc-status: 0\r\ngrpc-status: 0', 'Grpc-status: 0', 'grpc-status: 0\r\n\r\n',
      'grpc-status: 0\r\nbad', 'grpc-status: 0\r\ngrpc-status-details-bin: AAAA',
    ].map(text => base64(trailer(text))),
    base64(concat(trailer(), trailer())), base64(concat(trailer(), frame(new Uint8Array()))),
    base64(concat(trailer(), new Uint8Array([0]))),
  ];
  for (const text of malformed) {
    response = reply(text);
    await assert.rejects(collect(stream(create())), { code: 'PROTOCOL_MISMATCH' }, text);
  }
  for (const headers of [{ 'grpc-status': '0' }, { 'grpc-status': '0, 0' },
    { 'grpc-encoding': 'gzip' }, { 'content-type': 'application/grpc+proto' },
    { 'content-type': media + ', text/html' }, { 'content-type': 'text/plain' }]) {
    response = reply(good(), headers);
    await assert.rejects(unary(create()), { code: 'PROTOCOL_MISMATCH' });
  }
  response = reply(base64(concat(frame(new Uint8Array()), frame(new Uint8Array()), trailer())));
  await assert.rejects(unary(create()), { code: 'PROTOCOL_MISMATCH' });
  response = reply(base64(concat(frame(new Uint8Array()), trailer())), { 'content-type': 'application/grpc-web-text' });
  assert.equal((await unary(create())).length, 0);
});

test('internal limits reject declared lengths before allocation and bound chunks, wire, decoded totals and count', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  const cases = [
    [{ messageBytes: 2 }, base64(new Uint8Array([0, 0, 0, 0, 3]))],
    [{}, base64(new Uint8Array([0, 255, 255, 255, 255]))],
    [{}, base64(new Uint8Array([128, 0, 0, 32, 1]))],
    [{ chunkBytes: 8 }, good()], [{ wireBytes: 8 }, good()],
    [{ decodedBytes: 8 }, good()],
    [{ messages: 1 }, base64(concat(frame(new Uint8Array()), frame(new Uint8Array()), trailer()))],
  ];
  for (const [limits, body] of cases) {
    response = reply(body);
    await assert.rejects(collect(stream(create(undefined, { limits }))), { code: 'RESOURCE_LIMIT' });
  }
  for (const limits of [{ wireBytes: 30 }, { decodedBytes: 20 }]) {
    const bytes = new TextEncoder().encode(good());
    let offset = 0;
    response = new Response(new ReadableStream({ pull(controller) {
      if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.slice(offset, ++offset));
    } }), { headers: { 'content-type': media } });
    await assert.rejects(collect(stream(create(undefined, { limits }))), { code: 'RESOURCE_LIMIT' });
  }
  response = reply(good(), { 'content-length': '9999999999999999999999999' });
  await assert.rejects(unary(create()), { code: 'RESOURCE_LIMIT' });
  response = reply(good(), { 'content-length': '-1' });
  await assert.rejects(unary(create()), { code: 'PROTOCOL_MISMATCH' });
  response = reply(good(), { 'x-large': 'x'.repeat(8193) });
  await assert.rejects(unary(create()), { code: 'RESOURCE_LIMIT' });
});

test('admission snapshots owned request bytes and headers with fixed secure Fetch policy and exact allowlist', async t => {
  const received = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let headerReads = 0;
  const supplied = Object.defineProperty({}, 'Authorization', { get() { headerReads++; return 'private-auth'; } });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    received.push({ url: String(url), init });
    return reply(streamMethods.some(method => String(url).includes(method)) ? base64(trailer()) : good());
  });
  const policy = options({ headers: async () => { await gate; return supplied; } });
  const transport = internal.createGrpcWebByteTransport('https://synthetic.invalid/?private-query', policy);
  policy.headers = async () => { throw Error('wrong callback'); };
  const request = new Uint8Array([0, 8, 1, 0]);
  const pending = unary(transport, request.subarray(1, 3));
  request.fill(99);
  release();
  assert.deepEqual([...await pending], [8, 1]);
  assert.equal(received[0].init.body, base64(frame(new Uint8Array([8, 1]))));
  assert.equal(headerReads, 1);
  const init = received[0].init;
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
  assert.equal(init.referrer, ''); assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.headers.get('grpc-accept-encoding'), 'identity');
  assert.equal(init.headers.get('grpc-encoding'), 'identity');
  assert.equal(init.headers.get('authorization'), 'private-auth');
  const streamRequest = new Uint8Array([7]);
  const iterator = transport.stream({ method: 'GetBlockRange', request: streamRequest });
  streamRequest[0] = 9;
  await collect(iterator);
  assert.equal(received[1].init.body, base64(frame(new Uint8Array([7]))));
  for (const method of unaryMethods) await transport.unary({ method, request: new Uint8Array() });
  for (const method of streamMethods) await collect(transport.stream({ method, request: new Uint8Array() }));
  for (const method of ['Ping', '/evil', 'GetBlockRange', 'toString']) {
    await assert.rejects(transport.unary({ method, request: new Uint8Array() }), { code: 'INVALID_ARGUMENT' });
  }
  for (const method of ['GetLatestBlock', 'GetBlock', 'GetMempoolTx']) {
    assert.throws(() => transport.stream({ method, request: new Uint8Array() }), { code: 'INVALID_ARGUMENT' });
  }
});

test('unsuitable bytes/options/endpoints fail consistently before dispatch without secrets', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return reply(); });
  for (const url of ['', '/relative', 'ftp://synthetic.invalid', 'https://user:private-secret@synthetic.invalid',
    'https://synthetic.invalid/#', 'https://synthetic.invalid/base', ' https://synthetic.invalid',
    'https://synthetic.invalid/\n', 'https://synthetic.invalid/\\evil']) {
    assert.throws(() => create(url), { code: 'INVALID_ARGUMENT' });
  }
  for (const extra of [{ timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: Infinity }, { timeoutMs: 2147483648 },
    { unknown: 1 }, { headers: {} }, { limits: { messageBytes: 0 } }, { limits: { chunkBytes: NaN } },
    { limits: { messages: 65537 } }, { limits: { unknown: 1 } }, { limits: null }]) {
    assert.throws(() => create(undefined, extra), { code: 'INVALID_ARGUMENT' });
  }
  const detached = new Uint8Array([1]); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const shared = new Uint8Array(new SharedArrayBuffer(1));
  Object.setPrototypeOf(shared.buffer, ArrayBuffer.prototype);
  const spoof = new Uint16Array([1]); Object.setPrototypeOf(spoof, Uint8Array.prototype);
  for (const bytes of [null, [], new ArrayBuffer(1), new DataView(new ArrayBuffer(1)), new Int8Array(1),
    detached, shared, spoof, new Proxy(new Uint8Array([1]), {}), new Uint8Array(new ArrayBuffer(1, { maxByteLength: 4 }))]) {
    await assert.rejects(unary(create(), bytes), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => create().stream({ method: 'GetBlockRange', request: bytes }), { code: 'INVALID_ARGUMENT' });
  }
  await assert.rejects(unary(create(undefined, { limits: { messageBytes: 1 } })), { code: 'RESOURCE_LIMIT' });
  assert.equal(calls, 0);
  const buffer = Buffer.from([8, 1]);
  await unary(create(), buffer);
  const shadowed = new Uint8Array([8, 1]);
  Object.defineProperty(shadowed, 'buffer', { get() { throw Error('private-secret'); } });
  Object.defineProperty(shadowed, Symbol.iterator, { value() { throw Error('private-secret'); } });
  await unary(create(), shadowed);
  for (const headers of [async () => { throw Error('private-secret'); }, async () => ({ x: 'private-secret\n' }),
    async () => null, async () => ({ 'grpc-encoding': 'gzip' })]) {
    await assert.rejects(unary(create(undefined, { headers })), error => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /private-secret/); return true;
    });
  }
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function promptly(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('did not settle promptly')), 500); })]); }
  finally { clearTimeout(timer); }
}

test('deadline includes hanging headers, synchronous header work, fetch and body; errors stay sanitized', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Promise(() => {}); });
  const paused = async () => new Promise(() => {});
  const block = () => { const start = performance.now(); while (performance.now() - start < 30) {} return {}; };
  for (const headers of [paused, block, async () => ({ get Authorization() { block(); return 'private-secret'; } })]) {
    await assert.rejects(promptly(unary(create(undefined, { timeoutMs: 10, headers }))), { code: 'TIMEOUT' });
  }
  assert.equal(calls, 0);
  await assert.rejects(promptly(unary(create(undefined, { timeoutMs: 10 }))), { code: 'TIMEOUT' });
  assert.equal(calls, 1);
});

test('return interrupts pending reads, releases body and signal/timer hooks without awaiting foreign cancellation', async t => {
  let cancelled = 0, fetchSignal, pulls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    fetchSignal = init.signal;
    return new Response(new ReadableStream({
      pull(controller) { pulls++; if (pulls === 1) controller.enqueue(new TextEncoder().encode(base64(frame(new Uint8Array([3]))))); },
      cancel() { cancelled++; return new Promise(() => {}); },
    }, { highWaterMark: 0 }), { headers: { 'content-type': media } });
  });
  const iterator = stream(create(undefined, { timeoutMs: 10000 }));
  assert.deepEqual([...(await iterator.next()).value], [3]);
  await delay(10);
  assert.equal(pulls, 1, 'no transport read ahead while consumer paused');
  const next = iterator.next();
  const rejected = assert.rejects(promptly(next), { code: 'ABORTED' });
  await delay(10);
  assert.deepEqual(await promptly(iterator.return()), { value: undefined, done: true });
  await rejected;
  assert.equal(cancelled, 1);
  assert.equal(fetchSignal.aborted, true);
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
});

test('abort/deadline cancel a paused iterator and pre-abort prevents dispatch; concurrent next is bounded', async t => {
  let cancelled = 0, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(base64(frame(new Uint8Array([1]))))); },
      cancel() { cancelled++; },
    }), { headers: { 'content-type': media } });
  });
  const aborted = new AbortController(); aborted.abort('private-secret');
  await assert.rejects(unary(create(), undefined, aborted.signal), { code: 'ABORTED' });
  assert.equal(calls, 0);
  const controller = new AbortController();
  const iterator = stream(create(), controller.signal);
  await iterator.next(); controller.abort('private-secret'); await delay(10);
  assert.equal(cancelled, 1);
  await assert.rejects(iterator.next(), { code: 'ABORTED' });
  const expired = stream(create(undefined, { timeoutMs: 15 }));
  await expired.next(); await delay(40);
  assert.equal(cancelled, 2);
  await assert.rejects(expired.next(), { code: 'TIMEOUT' });
  const blocked = stream(create(undefined, { timeoutMs: 20 }));
  await blocked.next();
  const pending = blocked.next();
  const timeout = assert.rejects(promptly(pending), { code: 'TIMEOUT' });
  await assert.rejects(promptly(blocked.next()), { code: 'INVALID_ARGUMENT' });
  await timeout;
});

test('real localhost abort, timeout, early return and submission failure are one attempt', async t => {
  const fixture = await serveFixtures(); t.after(() => fixture.close());
  const transport = create(fixture.origin + '?case=stall', { timeoutMs: 40 });
  await assert.rejects(unary(transport), { code: 'TIMEOUT' });
  const iterator = stream(create(fixture.origin + '?case=stall'));
  await iterator.next(); await promptly(iterator.return());
  const controller = new AbortController();
  const aborted = stream(create(fixture.origin + '?case=stall'), controller.signal);
  await aborted.next(); controller.abort(); await assert.rejects(aborted.next(), { code: 'ABORTED' });
  for (const mode of ['error', 'http-error']) {
    await assert.rejects(create(fixture.origin + '?case=' + mode).unary({ method: 'SendTransaction', request: new Uint8Array([1]) }), { code: 'TRANSPORT_ERROR' });
  }
  await delay(30);
  assert.equal(fixture.requests.length, 5);
  assert.equal(fixture.closed.filter(mode => mode === 'stall').length, 3);
});

test('deadline expiry at Fetch resolution cancels its body even before reader acquisition', async t => {
  let cancelled = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const response = new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': media } });
    const start = performance.now(); while (performance.now() - start < 150) {}
    return response;
  });
  await assert.rejects(unary(create(undefined, { timeoutMs: 100 })), { code: 'TIMEOUT' });
  assert.equal(cancelled, 1);
});

test('all base64/5-byte frame split points preserve owned multiple response payloads', async t => {
  let text, split;
  t.mock.method(globalThis, 'fetch', async () => {
    const source = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(source.slice(0, split)); controller.enqueue(source.slice(split)); controller.close();
    } }), { headers: { 'content-type': media } });
  });
  const bytes = concat(frame(new Uint8Array([0, 127, 128, 255])), frame(new Uint8Array()), frame(new Uint8Array([9])), trailer());
  for (let flush = 1; flush <= 9; flush++) {
    text = '';
    for (let i = 0; i < bytes.length; i += flush) text += base64(bytes.subarray(i, i + flush));
    for (split = 1; split < text.length; split++) {
      assert.deepEqual(await collect(stream(create())), [[0, 127, 128, 255], [], [9]]);
    }
  }
});

test('late fetch completion is cancelled, foreign errors are secret, signals/timers have no lingering hooks', async t => {
  const { getEventListeners } = await import('node:events');
  let resolveFetch, cancelled = 0, calls = 0;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Promise(resolve => { resolveFetch = resolve; }); });
  const controller = new AbortController();
  const transport = create('https://synthetic.invalid/?private-secret', { timeoutMs: 30 });
  const pending = unary(transport, undefined, controller.signal);
  const rejection = assert.rejects(pending, { code: 'ABORTED' });
  controller.abort('private-secret'); await rejection;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': media } }));
  await delay(5); assert.equal(cancelled, 1);
  globalThis.fetch.mock.mockImplementation(async () => { calls++; throw Error('private-secret'); });
  await assert.rejects(unary(transport), error => {
    assert.equal(error.code, 'TRANSPORT_ERROR'); assert.equal(error.retryable, false);
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /private-secret/); return true;
  });
  assert.equal(calls, 2);
  t.after(() => { t.mock.restoreAll(); assert.equal(globalThis.fetch, originalFetch); });
});

test('HTTP content coding and even empty URL userinfo stay outside the identity-only endpoint profile', async t => {
  t.mock.method(globalThis, 'fetch', async () => reply(good(), { 'content-encoding': 'gzip' }));
  await assert.rejects(unary(create()), { code: 'PROTOCOL_MISMATCH' });
  assert.throws(() => create('https://@synthetic.invalid/'), { code: 'INVALID_ARGUMENT' });
});

test('reviewer signal-repro: hostile listener removal cannot leak or keep Fetch/body alive', async t => {
  let hostile = false, cancelled = 0, fetchSignal;
  const controller = new AbortController();
  const signal = new Proxy(controller.signal, { get(target, key, receiver) {
    if (hostile && String(key) === 'Symbol(kEvents)') throw Error('private-signal-secret');
    return Reflect.get(target, key, receiver);
  } });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    fetchSignal = init.signal;
    return new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('AAAAAAEH')); },
      cancel() { cancelled++; },
    }), { headers: { 'content-type': media } });
  });
  let iterator;
  try { iterator = stream(create(), signal); }
  catch (error) {
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /private-signal-secret/);
    assert.equal(fetchSignal, undefined);
    return; // Rejecting an unsupported proxy before dispatch is also safe.
  }
  await iterator.next(); hostile = true;
  await iterator.return();
  assert.equal(cancelled, 1);
  assert.equal(fetchSignal.aborted, true);
});

test('listener removal failure on an admitted native signal still cancels a pending read', async t => {
  const controller = new AbortController();
  let cancelled = 0, fetchSignal, body;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    fetchSignal = init.signal;
    body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('AAAAAAEH')); },
      cancel() { cancelled++; },
    });
    return new Response(body, { headers: { 'content-type': media } });
  });
  const iterator = stream(create(), controller.signal);
  await iterator.next();
  const pending = assert.rejects(iterator.next(), { code: 'ABORTED' });
  const remove = EventTarget.prototype.removeEventListener;
  t.mock.method(EventTarget.prototype, 'removeEventListener', function (...args) {
    if (this === controller.signal) throw new Proxy({}, { get() { throw Error('private-signal-secret'); } });
    return remove.apply(this, args);
  });
  assert.equal(await iterator.return().then(() => true, () => false), true);
  await pending;
  assert.equal(cancelled, 1);
  assert.equal(fetchSignal.aborted, true);
  assert.equal(body.locked, false);
});

test('preaborted proxy cannot suppress cancellation and dispatch SendTransaction', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return reply(); });
  const controller = new AbortController(); controller.abort('private-signal-secret');
  const signal = new Proxy(controller.signal, { get(target, key, receiver) {
    if (typeof key === 'symbol' && String(key) === 'Symbol(kAborted)') return false;
    return Reflect.get(target, key, receiver);
  } });
  await assert.rejects(create().unary({ method: 'SendTransaction', request: new Uint8Array(), signal }),
    { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 0);
  assert.equal(controller.signal.aborted, true);
  await assert.rejects(create().unary({ method: 'SendTransaction', request: new Uint8Array(), signal: controller.signal }),
    { code: 'ABORTED' });
  assert.equal(calls, 0);
});

test('URL policy checks the original HTTP(S) authority before URL normalization', async t => {
  for (const url of [
    'https:/@fixture.invalid/', 'https:@fixture.invalid/', 'https:///@fixture.invalid/',
    'https:////@fixture.invalid/', 'https://@fixture.invalid/', 'https://:@fixture.invalid/',
    'https:\\@fixture.invalid/', 'https:/\\@fixture.invalid/', 'https:\\/@@fixture.invalid/',
    'https:\\\\@fixture.invalid/', 'https://fixture.invalid\\@other.invalid/',
    'https:fixture.invalid/', 'https:/fixture.invalid/', 'https:///fixture.invalid/',
    ' https://fixture.invalid/', 'https://fixture.invalid/\n', 'https://fixture.invalid/#',
    'ftp://fixture.invalid/', '//fixture.invalid/', 'https://fixture.invalid/base',
  ]) assert.throws(() => create(url), { code: 'INVALID_ARGUMENT' }, url);
  const sent = [];
  t.mock.method(globalThis, 'fetch', async url => { sent.push(String(url)); return reply(); });
  for (const url of [
    'https://fixture.invalid', 'HTTPS://fixture.invalid/', 'https://fixture.invalid:443/?token=@opaque',
    'https://[::1]:8443/?a=b', 'http://127.0.0.1:1234/', 'https://bücher.invalid/',
  ]) {
    await unary(create(url));
    const expected = new URL(url); expected.pathname = service + 'GetLatestBlock';
    assert.equal(sent.at(-1), expected.href);
  }
});

test('foreign signal hook errors are sanitized while abort and timeout retain their codes', async t => {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  let current, failAdd = false, cancelled = 0, fetchSignal, calls = 0;
  const poison = new Proxy({}, { get() { throw Error('private-signal-secret'); } });
  t.mock.method(EventTarget.prototype, 'addEventListener', function (...args) {
    if (this === current && failAdd) throw poison;
    return add.apply(this, args);
  });
  t.mock.method(EventTarget.prototype, 'removeEventListener', function (...args) {
    if (this === current) throw poison;
    return remove.apply(this, args);
  });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++; fetchSignal = init.signal;
    return new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('AAAAAAEH')); },
      cancel() { cancelled++; },
    }), { headers: { 'content-type': media } });
  });
  const cleanError = code => error => {
    assert.equal(error.code, code);
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /private-signal-secret/);
    return true;
  };
  current = new AbortController().signal; failAdd = true;
  await assert.rejects(unary(create(), undefined, current), cleanError('TRANSPORT_ERROR'));
  assert.equal(calls, 0);
  failAdd = false;
  for (const mode of ['abort', 'timeout']) {
    const controller = new AbortController(); current = controller.signal;
    const iterator = stream(create(undefined, { timeoutMs: mode === 'timeout' ? 20 : 1000 }), current);
    await iterator.next();
    const pending = assert.rejects(promptly(iterator.next()), cleanError(mode === 'timeout' ? 'TIMEOUT' : 'ABORTED'));
    if (mode === 'abort') controller.abort('private-signal-secret');
    await pending;
    assert.equal(fetchSignal.aborted, true);
  }
  assert.equal(cancelled, 2);
  assert.equal(calls, 2);
});

test('return during a partial frame unwinds both decoders and releases the reader', async t => {
  let entered, cancelled = 0, pulls = 0, body, signal;
  const stalled = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    signal = init.signal;
    body = new ReadableStream({
      pull(controller) {
        if (++pulls === 1) controller.enqueue(new TextEncoder().encode(base64(new Uint8Array([0, 0, 0, 0, 3, 1]))));
        else entered();
      },
      cancel() { cancelled++; return new Promise(() => {}); },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: { 'content-type': media } });
  });
  const iterator = stream(create());
  const pending = assert.rejects(promptly(iterator.next()), { code: 'ABORTED' });
  await promptly(stalled);
  await promptly(iterator.return());
  await pending;
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
  assert.equal(signal.aborted, true);
});

test('a terminal failure after an emitted message stays a trusted gRPC status', async t => {
  t.mock.method(globalThis, 'fetch', async () => reply(base64(concat(
    frame(new Uint8Array([7])), trailer('grpc-status: 5\r\ngrpc-message: private-secret\r\n'),
  ))));
  const iterator = stream(create());
  assert.deepEqual([...(await iterator.next()).value], [7]);
  await assert.rejects(iterator.next(), error => {
    assert.equal(error.code, 'TRANSPORT_ERROR');
    assert.equal(isGrpcNotFound(error), true);
    assert.doesNotMatch(error.message, /private-secret/);
    return true;
  });
});

test('every byte is classified as a base64 symbol, pad or invalid, and nonzero pad bits fail', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  response = reply(base64(concat(frame(all), trailer())));
  assert.deepEqual(await collect(stream(create())), [[...all]]);
  const body = new TextEncoder().encode(base64(concat(frame(new Uint8Array([1])), trailer())));
  for (let byte = 0; byte < 256; byte++) {
    if (byte === 61 || alphabet.includes(String.fromCharCode(byte))) continue;
    for (const at of [0, 3, 10]) {
      const bytes = body.slice();
      bytes[at] = byte;
      response = new Response(bytes, { headers: { 'content-type': media } });
      await assert.rejects(collect(stream(create())), { code: 'PROTOCOL_MISMATCH' }, String(byte));
    }
  }
  // A 7- or 8-byte frame leaves one or two bytes for a padded final quartet.
  for (let value = 0; value < 64; value++) {
    for (const [payload, quartet, mask] of [
      [[5, 6], `B${alphabet[value]}==`, 15], [[5, 6, 7], `BB${alphabet[value]}=`, 3],
    ]) {
      const head = frame(new Uint8Array(payload)).subarray(0, 6);
      response = reply(base64(head) + quartet + base64(trailer()));
      const tail = [...atob(quartet)].map(symbol => symbol.charCodeAt(0));
      if ((value & mask) === 0) assert.deepEqual(await collect(stream(create())), [[payload[0], ...tail]]);
      else await assert.rejects(collect(stream(create())), { code: 'PROTOCOL_MISMATCH' }, quartet);
    }
  }
});
