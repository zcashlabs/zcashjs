import assert from 'node:assert/strict';
import test from 'node:test';
import * as methods from '../../dist/src/clients/light-transaction-reads.js';
import { recordNotFound } from '../../dist/src/clients/grpc-status.js';
import { failure } from '../../dist/src/errors.js';
const revision = 'lightwire:80575dbe59a9bf2e6b79e2391eb78679c453f1a0477292eb97ea3b58bb6c8b10:d8d0c8aaa5ceec7d5dcc188ef25b04011df2ec0254901620fce982fc13aeb32d';
const id = '01'.repeat(32), raw = new Uint8Array([1, 2, 255]);
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const decode = value => JSON.parse(new TextDecoder().decode(value));
function fixture() {
  const state = { calls: [], returns: 0, pulls: 0, items: [], response: { data: '0102ff', height: '0' }, contexts: [] };
  const source = {
    wire: { encodeRequest: (_, json) => new TextEncoder().encode(json), decodeResponse: (_, value) => decode(value), decodeItem: (_, value) => decode(value) },
    transport: { kind: 'custom-lightwallet', protocolRevision: revision, sourceId: 'fixture',
      async unary(args) { state.calls.push(args); return encode(state.response); },
      stream(args) { state.calls.push(args); let index = 0; return { [Symbol.asyncIterator]() { return this; },
        async next() { state.pulls++; return index < state.items.length ? { value: encode(state.items[index++]), done: false } : { done: true }; },
        async return() { state.returns++; return { done: true }; } }; },
    },
    decodeTransaction(value, height) { state.contexts.push(height); return { bytes: value, txid: new Uint8Array(32).fill(1), display: id }; },
    validateAddress(value) { assert.equal(value, 'synthetic-address'); return value; },
  };
  return { source, state };
}
test('transaction sentinel mapping, exact bytes/id and trusted absent status', async () => {
  const { source, state } = fixture();
  for (const [height, expected] of [['0', 'mempool'], ['18446744073709551615', 'offMainChain'], ['9', 'mined']]) {
    state.response.height = height;
    const result = await methods.getTransaction(source, { txid: id });
    assert.equal(result.observation.state, expected); assert.deepEqual(result.raw, raw);
    assert.equal(result.observation.inclusion?.height ?? null, expected === 'mined' ? 9 : null);
    assert.equal(result.observation.inclusion?.confirmations ?? null, null);
  }
  assert.deepEqual(state.contexts, [null, null, 9]);
  for (const value of ['', '18446744073709551614', '-1', '01', 9]) {
    state.response.height = value;
    await assert.rejects(methods.getTransaction(source, { txid: id }), { code: 'PROTOCOL_MISMATCH' });
  }
  state.response.height = '1'; source.decodeTransaction = () => ({ bytes: raw, txid: new Uint8Array(32), display: '00'.repeat(32) });
  await assert.rejects(methods.getTransaction(source, { txid: id }), { code: 'PROTOCOL_MISMATCH' });
  source.transport.unary = async () => { throw recordNotFound(failure('TRANSPORT_ERROR', 'transport', 'configure', 'Not found.')); };
  assert.equal(await methods.getTransaction(source, { txid: id }), null);
  source.transport.unary = async () => { throw { code: 5 }; };
  await assert.rejects(methods.getTransaction(source, { txid: id }), { code: 'TRANSPORT_ERROR' });
});
test('subtrees retain wire order, pool/index and bounded pulls; return releases', async () => {
  const { source, state } = fixture();
  state.items = [{ root_hash: '02'.repeat(32), completing_block_hash: '00'.repeat(31) + '03', completing_block_height: '9' }];
  const iterator = methods.getSubtreeRoots(source, { pool: 'ironwood', startIndex: 4n, limit: 1 });
  assert.equal(state.calls.length, 0);
  const item = (await iterator.next()).value;
  assert.equal(item.index, 4n); assert.equal(item.pool, 'ironwood');
  assert.equal(item.completingBlock.hash, '03' + '00'.repeat(31));
  assert.deepEqual(decode(state.calls[0].request), { start_index: 4, shielded_protocol: 2, max_entries: 1 });
  await iterator.return(); assert.equal(state.returns, 1); assert.equal(state.pulls, 1);
  state.items.push(state.items[0]);
  const bounded = methods.getSubtreeRoots(source, { pool: 'sapling', startIndex: 0n, limit: 1 });
  await bounded.next(); await assert.rejects(bounded.next(), { code: 'RESOURCE_LIMIT' });
  assert.equal(state.returns, 2);
});

test('native decoder input rejection means malformed endpoint bytes, while cancellation and submission retain identity', async () => {
  const { source } = fixture();
  const invalid = failure('INVALID_ARGUMENT', 'validation', 'correct-input', 'Invalid transaction.');
  source.decodeTransaction = () => { throw invalid; };
  await assert.rejects(methods.getTransaction(source, { txid: id }), { code: 'PROTOCOL_MISMATCH' });
  await assert.rejects(methods.broadcastTransaction(source, { bytes: raw }), error => error === invalid);
  for (const code of ['ABORTED', 'TRANSPORT_ERROR']) {
    const error = failure(code, 'query', 'none', 'Interrupted.');
    source.decodeTransaction = () => { throw error; };
    await assert.rejects(methods.getTransaction(source, { txid: id }), actual => actual === error);
  }
});
test('address range and mempool stream do not silently admit wrong transaction states', async () => {
  const { source, state } = fixture();
  state.items = [{ data: '0102ff', height: '3' }];
  const address = methods.streamAddressTransactions(source, { address: 'synthetic-address', fromHeight: 2, toHeight: 4 });
  assert.equal((await address.next()).value.observation.inclusion.height, 3);
  assert.equal((await address.next()).done, true); assert.equal(state.returns, 1);
  const mempool = methods.streamMempool(source);
  const result = (await mempool.next()).value;
  assert.equal(result.observation.state, 'mempool'); assert.equal(result.observation.inclusion, null);
  assert.equal(state.contexts.at(-1), null); await mempool.return();
  assert.equal(state.returns, 2);
  for (const height of ['18446744073709551615', '4294967296', '-1']) {
    state.items = [{ data: '0102ff', height }];
    await assert.rejects(methods.streamMempool(source).next(), { code: 'PROTOCOL_MISMATCH' });
  }
});
test('real abort interrupts stalled custom pull and return; synthetic abort does not', async () => {
  const { source, state } = fixture(); const controller = new AbortController();
  controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  let started; const ready = new Promise(resolve => { started = resolve; });
  source.transport.stream = () => ({ [Symbol.asyncIterator]() { return this; }, next() { started(); return new Promise(() => {}); },
    return() { state.returns++; return new Promise(() => {}); } });
  const iterator = methods.streamMempool(source, { signal: controller.signal });
  const pending = iterator.next(); await ready;
  controller.signal.dispatchEvent(new Event('abort'));
  assert.equal(state.returns, 0); controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' }); assert.equal(state.returns, 1);
  await iterator.return(); assert.equal(state.returns, 1);
});
test('broadcast owns bytes before await and attempts once; ambiguity never becomes rejection', async () => {
  const { source, state } = fixture();
  for (const [code, outcome] of [[0, 'acknowledged'], [-26, 'rejected']]) {
    state.response = { error_code: code, error_message: code === 0 ? JSON.stringify(id) : 'SECRET' };
    const input = new Uint8Array(raw), pending = methods.broadcastTransaction(source, { bytes: input }); input.fill(0);
    const result = await pending;
    assert.equal(result.outcome, outcome); assert.equal(result.txid, id);
    assert.equal(decode(state.calls.at(-1).request).data, '0102ff');
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  for (const message of ['', 'SECRET', JSON.stringify('ff'.repeat(32)), '{}']) {
    state.response = { error_code: 0, error_message: message };
    const before = state.calls.length;
    assert.equal((await methods.broadcastTransaction(source, { bytes: raw })).outcome, 'unknown');
    assert.equal(state.calls.length, before + 1);
  }
  let dispatches = 0;
  source.transport.unary = async () => { dispatches++; throw Error('SECRET'); };
  assert.equal((await methods.broadcastTransaction(source, { bytes: raw })).outcome, 'unknown'); assert.equal(dispatches, 1);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(methods.broadcastTransaction(source, { bytes: raw, signal: aborted.signal }), { code: 'ABORTED' });
  assert.equal(dispatches, 1);
  source.transport.unary = ({ signal }) => { dispatches++; return new Promise(() => {}); };
  const controller = new AbortController();
  const pending = methods.broadcastTransaction(source, { bytes: raw, signal: controller.signal });
  while (dispatches < 2) await new Promise(resolve => setImmediate(resolve)); controller.abort();
  assert.equal((await pending).outcome, 'unknown'); assert.equal(dispatches, 2);
});

test('accepted native protobuf and all13 native transaction vectors compose without reserialization', async () => {
  const { fixtureCodec, bytesField, scalar, concat } = await import('./light-chain-reads-fixtures.js');
  const { codec } = await fixtureCodec();
  const { verifiedPacket, packet } = await import('./public-transaction-reads-packet.js');
  const { vectors, files } = await verifiedPacket();
  const { initialize } = await import(`${packet}/network.mjs`);
  const { decodeTransaction } = await import(`${packet}/transaction.mjs`);
  initialize(new Uint8Array(files.get('bindings_bg.wasm')));
  const { source } = fixture(); source.wire = codec;
  let calls = 0, sends = 0, vector;
  source.decodeTransaction = value => decodeTransaction(value, vector.branch);
  source.transport.unary = async ({ method, request }) => {
    calls++;
    if (method === 'GetTransaction') {
      assert.deepEqual(request, bytesField(3, Buffer.from(vector.display, 'hex').reverse()));
      return concat(bytesField(1, Buffer.from(vector.hex, 'hex')), scalar(2, 7));
    }
    assert.equal(method, 'SendTransaction'); sends++;
    assert.deepEqual(request, bytesField(1, Buffer.from(vector.hex, 'hex')));
    return bytesField(2, new TextEncoder().encode(JSON.stringify(vector.display))); // code0 + exact server txid
  };
  for (vector of vectors) {
    const result = await methods.getTransaction(source, { txid: vector.display });
    assert.equal(Buffer.from(result.raw).toString('hex'), vector.hex);
    assert.equal(result.txid, vector.display);
    assert.equal((await methods.broadcastTransaction(source, { bytes: Buffer.from(vector.hex, 'hex') })).outcome, 'acknowledged');
  }
  assert.equal(vectors.length, 13); assert.equal(calls, 26);
  // Decoder output differing in length, first or last byte is a protocol mismatch, and broadcast never sends.
  vector = vectors[0];
  const before = sends, input = Buffer.from(vector.hex, 'hex');
  for (const mutate of [value => value.subarray(1), value => value.subarray(0, -1),
    value => { value[0] ^= 1; return value; }, value => { value[value.length - 1] ^= 1; return value; }]) {
    source.decodeTransaction = value => {
      const result = decodeTransaction(value, vector.branch);
      return { ...result, bytes: mutate(new Uint8Array(result.bytes)) };
    };
    await assert.rejects(methods.getTransaction(source, { txid: vector.display }), { code: 'PROTOCOL_MISMATCH' });
    await assert.rejects(methods.broadcastTransaction(source, { bytes: input }), { code: 'PROTOCOL_MISMATCH' });
  }
  assert.equal(sends, before); assert.equal(before, 13);
});
