import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { build, packet, verifiedPacket } from './public-transaction-reads-packet.js';
import { blockOne, fixture, result, transportOptions } from './public-chain-reads-fixtures.js';
const { vectors } = await verifiedPacket();
const { initialize } = await import(pathToFileURL(`${packet}/network.mjs`));
const { readFile } = await import('node:fs/promises');
initialize(new Uint8Array(await readFile(`${packet}/bindings_bg.wasm`)));
const { decodeTransaction } = await import(pathToFileURL(`${packet}/transaction.mjs`));
test('real accepted transactions retain exact bytes and mempool observation', async () => {
  const module = await import(pathToFileURL(`${build}/src/clients/public-transaction-reads.js`)).catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e;
  });
  assert.equal(typeof module.getTransaction, 'function', 'positive internal read must exist');
  const { httpTransport } = await import(pathToFileURL(`${build}/src/http.js`));
  const server = await fixture(call => {
    assert.deepEqual(call.params, [vectors.find(v => v.display === call.params[0]).display, 1]);
    assert.equal(call.method, 'getrawtransaction');
    const v = vectors.find(v => v.display === call.params[0]);
    return result({ txid: v.display, hex: v.hex, in_active_chain: false });
  });
  try {
    for (const v of vectors) {
      const actual = await module.getTransaction({ transport: httpTransport(`${server.origin}/rpc`, transportOptions), sourceId: 'fixture' },
        { txid: v.display, decodeTransaction: raw => decodeTransaction(raw, v.branch) }, { txid: v.display });
      assert.equal(Buffer.from(actual.raw).toString('hex'), v.hex);
      assert.equal(actual.observation.state, 'mempool');
      assert.equal(actual.txid, v.display);
    }
    assert.deepEqual(server.unexpected, []);
  } finally { await server.close(); }
});

test('transaction observations retain uncertainty and reject DTO/decoder contradictions', async () => {
  const v = vectors[0];
  const { getTransaction } = await import(pathToFileURL(`${build}/src/clients/public-transaction-reads.js`));
  const { httpTransport } = await import(pathToFileURL(`${build}/src/http.js`));
  let dto = { txid: v.display, hex: v.hex, in_active_chain: false,
    blockhash: blockOne.verbose.hash, height: -1, confirmations: 0 };
  const server = await fixture(call => result(call.method === 'getrawtransaction' ? dto
    : call.method === 'getblock' ? { ...blockOne.verbose, nTx: 1, tx: [v.display] }
    : call.params[1] ? blockOne.verbose : blockOne.raw));
  const source = { transport: httpTransport(`${server.origin}/rpc`, transportOptions), sourceId: 'fixture' };
  const context = { txid: v.display, decodeTransaction: raw => decodeTransaction(raw, v.branch) };
  try {
    const off = await getTransaction(source, context, { txid: v.display });
    assert.equal(off.observation.state, 'offMainChain');
    assert.equal(off.observation.inclusion, null);
    assert.equal(server.calls.length, 1);
    dto = { ...dto, in_active_chain: true, height: 1, confirmations: 1, blockhash: 'ab'.repeat(32) };
    const changed = await getTransaction(source, context, { txid: v.display });
    assert.equal(changed.observation.state, 'unknown');
    assert.equal(changed.observation.inclusion, null);
    for (const bad of [{ ...dto, txid: 'ab'.repeat(32) }, { ...dto, in_active_chain: 'true' },
      { ...dto, height: 1.5 }, { ...dto, hex: 'zz' }]) {
      dto = bad;
      await assert.rejects(getTransaction(source, context, { txid: v.display }), error => error.code === 'PROTOCOL_MISMATCH');
    }
    dto = { txid: v.display, hex: v.hex, in_active_chain: false };
    for (const change of [{ display: 'ab'.repeat(32) }, { txid: new Uint8Array(32) }, { bytes: new Uint8Array([0]) }]) {
      await assert.rejects(getTransaction(source, { ...context,
        decodeTransaction: raw => ({ ...decodeTransaction(raw, v.branch), ...change }) },
      { txid: v.display }), error => error.code === 'PROTOCOL_MISMATCH');
    }
    assert.deepEqual(server.unexpected, []);
  } finally { await server.close(); }
});

test('native cancellation stops an in-flight transaction response after a synthetic event', async () => {
  const v = vectors[0];
  const { getTransaction } = await import(pathToFileURL(`${build}/src/clients/public-transaction-reads.js`));
  const { httpTransport } = await import(pathToFileURL(`${build}/src/http.js`));
  let started;
  const seen = new Promise(resolve => { started = resolve; });
  const server = await fixture((_call, _req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); started();
  });
  try {
    const controller = new AbortController();
    controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
    const pending = assert.rejects(getTransaction({ sourceId: 'fixture',
      transport: httpTransport(`${server.origin}/rpc`, transportOptions) },
    { txid: v.display, decodeTransaction: raw => decodeTransaction(raw, v.branch) },
    { txid: v.display, signal: controller.signal }), error => error.code === 'ABORTED');
    await seen;
    controller.signal.dispatchEvent(new Event('abort'));
    assert.equal(controller.signal.aborted, false);
    controller.abort(); await pending;
    assert.equal(server.calls.length, 1);
    assert.deepEqual(server.unexpected, []);
  } finally { await server.close(); }
});

test('mined transaction composes block reads with a signal and preserves cancellation', async () => {
  const v = vectors[0];
  const { getTransaction } = await import(pathToFileURL(`${build}/src/clients/public-transaction-reads.js`));
  const { httpTransport } = await import(pathToFileURL(`${build}/src/http.js`));
  const server = await fixture(call => {
    if (call.method === 'getrawtransaction') return result({ txid: v.display, hex: v.hex,
      in_active_chain: true, blockhash: blockOne.verbose.hash, height: 1, confirmations: 1 });
    if (call.method === 'getblock') return result({ ...blockOne.verbose, nTx: 1, tx: [v.display] });
    return result(call.params[1] ? blockOne.verbose : blockOne.raw);
  });
  const context = { txid: v.display, decodeTransaction: raw => decodeTransaction(raw, v.branch) };
  try {
    const source = { transport: httpTransport(`${server.origin}/rpc`, transportOptions), sourceId: 'fixture' };
    const actual = await getTransaction(source, context, { txid: v.display, signal: new AbortController().signal });
    assert.equal(actual.observation.state, 'mined');
    assert.deepEqual(actual.observation.inclusion, { height: 1, blockHash: blockOne.verbose.hash, confirmations: null });
    assert.deepEqual(server.calls.map(call => call.method), ['getrawtransaction', 'getblock', 'getblockheader', 'getblockheader']);

    // Cancellation must cross every nested read even when a caller stops abort events.
    for (let stage = 0; stage < 4; stage++) {
      const controller = new AbortController();
      controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
      let admitted = 0;
      const before = server.calls.length;
      const transport = httpTransport(`${server.origin}/rpc`, { ...transportOptions, headers() {
        if (admitted++ === stage) controller.abort();
        return {};
      } });
      await assert.rejects(getTransaction({ ...source, transport }, context,
        { txid: v.display, signal: controller.signal }), error => error.code === 'ABORTED');
      assert.equal(server.calls.length - before, stage, 'aborted admission sends no next RPC');
    }
    assert.deepEqual(server.unexpected, []);
  } finally { await server.close(); }
});

test('validated mined height reaches native decoder; off-chain contexts remain null', async () => {
  const v=vectors[0];
  const {getTransaction}=await import(pathToFileURL(`${build}/src/clients/public-transaction-reads.js`));
  const {httpTransport}=await import(pathToFileURL(`${build}/src/http.js`));
  let mined=true, seen;
  const server=await fixture(call=>result(call.method==='getrawtransaction'?{txid:v.display,hex:v.hex,in_active_chain:mined,...(mined?{height:1,blockhash:blockOne.verbose.hash,confirmations:1}:{})}:call.method==='getblock'?{...blockOne.verbose,nTx:1,tx:[v.display]}:call.params[1]?blockOne.verbose:blockOne.raw));
  try {
    const source={transport:httpTransport(server.origin+'/rpc',transportOptions),sourceId:'fixture'};
    const context={txid:v.display,decodeTransaction(raw,height){seen=height;return decodeTransaction(raw,v.branch);}};
    await getTransaction(source,context,{txid:v.display});assert.equal(seen,1);
    mined=false;await getTransaction(source,context,{txid:v.display});assert.equal(seen,null);
  }finally{await server.close();}
});

test('RPC transaction hex converts every byte value and rejects malformed hex before decoding', async () => {
  const { getTransaction } = await import(pathToFileURL(`${build}/src/clients/public-transaction-reads.js`));
  const { httpTransport } = await import(pathToFileURL(`${build}/src/http.js`));
  const txid = vectors[0].display;
  let hex = '';
  const server = await fixture(() => result({ txid, hex, in_active_chain: false }));
  const source = { transport: httpTransport(`${server.origin}/rpc`, { ...transportOptions, timeoutMs: 15000, maxResponseBytes: 8 * 1024 * 1024 }), sourceId: 'fixture' };
  let decoded = 0;
  const context = { txid, decodeTransaction: raw => { decoded++; return { bytes: raw.slice(), txid: Uint8Array.from(Buffer.from(txid, 'hex').reverse()), display: txid }; } };
  try {
    const all = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7) & 255)).toString('hex');
    for (const value of ['00', 'ff', '0a', 'a0', all, '0f'.repeat(2097152)]) {
      hex = value;
      const actual = await getTransaction(source, context, { txid });
      assert.ok(actual.raw instanceof Uint8Array);
      assert.equal(Buffer.from(actual.raw).toString('hex'), value);
    }
    const before = decoded;
    for (const value of ['', '0', 'AB', 'ab cd', ' abcd', 'g0', '0g', 'abcg', '/0', ':0', '`0', '0'.repeat(4194306)]) {
      hex = value;
      await assert.rejects(getTransaction(source, context, { txid }), error => error.code === 'PROTOCOL_MISMATCH');
    }
    assert.equal(decoded, before);
    assert.deepEqual(server.unexpected, []);
  } finally { await server.close(); }
});
