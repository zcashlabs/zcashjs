import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel, Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { attachWalletWorker } from '../../dist/src/wallet/host.js';
import { installWalletWorker } from '../../dist/src/wallet/worker.js';
import { defineNetwork } from '../../dist/src/network.js';
import { isZcashError } from '../../dist/src/errors.js';

function local(t, call, close = () => {}, limits = { maxQueuedJobs: 4, maxQueuedBytes: 4096 }) {
  const { port1, port2 } = new MessageChannel(); let destructions = 0;
  installWalletWorker({ generation: 1, instance: 'fixture', call, close }, port2);
  const host = attachWalletWorker(port1, async () => { destructions++; port2.close(); }, limits);
  t.after(async () => { await host.close().catch(() => {}); });
  return { host, destructions: () => destructions };
}

test('host snapshots inputs, serializes operations and drains close once', async t => {
  const calls = [];
  const { host, destructions } = local(t, (_g, _i, op, args) => { calls.push([op, args]); return args; }, () => calls.push(['close']));
  const args = { accountId: 'original', request: { format: 'transparent' } };
  const first = host.addresses.next(args); args.accountId = 'changed'; args.request.format = 'changed';
  const second = host.accounts.list();
  const closing = host.close(); assert.equal(host.close(), closing);
  await assert.rejects(host.accounts.list(), { code: 'CLOSED' });
  assert.deepEqual(await first, { accountId: 'original', request: { format: 'transparent' } });
  await second; await closing;
  assert.deepEqual(calls.map(c => c[0]), ['address_next', 'account_list', 'close']);
  assert.equal(destructions(), 1);
});

test('queued cancellation and limits invoke no rejected native calls', async t => {
  const calls = [];
  const { host } = local(t, (_g, _i, op) => { calls.push(op); return []; }, undefined,
    { maxQueuedJobs: 2, maxQueuedBytes: 300 });
  const signal = new AbortController();
  const first = host.accounts.list();
  const second = host.accounts.get({ accountId: 'test', signal: signal.signal });
  const limited = host.accounts.list();
  signal.abort();
  await assert.rejects(limited, error => error.code === 'RESOURCE_LIMIT' && host.completion(error).completion === 'none');
  await assert.rejects(second, error => error.code === 'ABORTED' && host.completion(error).completion === 'none');
  await first;
  await assert.rejects(host.accounts.get({ accountId: 'x'.repeat(300) }), { code: 'RESOURCE_LIMIT' });
  let getters = 0;
  await assert.rejects(host.accounts.get({ get accountId() { getters++; return 'test'; } }), { code: 'INVALID_ARGUMENT' });
  assert.equal(getters, 0); assert.deepEqual(calls, ['account_list']);
});

test('in-flight cancellation waits for native completion and retains successful write privately', async t => {
  const controller = new AbortController();
  controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  let writes = 0;
  const { host } = local(t, () => { writes++; controller.abort(); return { address: 'private-fixture' }; });
  await assert.rejects(host.addresses.next({ accountId: 'test', signal: controller.signal }), error => {
    assert.equal(isZcashError(error), true); assert.equal(error.code, 'ABORTED');
    assert.deepEqual(host.completion(error), { completion: 'committed', value: { address: 'private-fixture' } });
    assert.doesNotMatch(JSON.stringify(error), /private-fixture/); return true;
  });
  assert.equal(writes, 1);
});

test('native failure completion is preserved, unknown failures invalidate and destroy', async t => {
  const { host, destructions } = local(t, (_g, _i, op) => {
    if (op === 'address_next') throw Object.assign(Error('ABORTED'), { commit: 'committed' });
    throw Error('private SQL fixture');
  });
  await assert.rejects(host.addresses.next({ accountId: 'test' }), error => {
    assert.equal(error.code, 'ABORTED'); assert.deepEqual(host.completion(error), { completion: 'committed' }); return true;
  });
  await assert.rejects(host.accounts.list(), error => {
    assert.equal(error.code, 'RUNTIME_UNAVAILABLE'); assert.doesNotMatch(error.message, /private/);
    assert.equal(host.completion(error).completion, 'unknown'); return true;
  });
  await host.close().catch(() => {}); assert.equal(destructions(), 1);
});

test('worker loss rejects dispatched and queued calls with distinct completion', async t => {
  const { port1, port2 } = new MessageChannel();
  let posted;
  const seen = new Promise(resolve => { posted = resolve; });
  port2.on('message', posted);
  const host = attachWalletWorker(port1, async () => port2.close(), { maxQueuedJobs: 2, maxQueuedBytes: 4096 });
  t.after(async () => { await host.close().catch(() => {}); });
  const one = host.accounts.list(), two = host.accounts.list();
  await seen;
  host.crashed();
  await assert.rejects(one, error => error.code === 'WORKER_CRASHED' && host.completion(error).completion === 'unknown');
  await assert.rejects(two, error => error.code === 'WORKER_CRASHED' && host.completion(error).completion === 'none');
});

test('native close failure still destroys the worker and remains the cached outcome', async t => {
  const { host, destructions } = local(t, () => [], () => { throw Error('STORAGE_CLOSE_FAILED'); });
  const close = host.close(); await assert.rejects(close, { code: 'STORAGE_ERROR' });
  assert.equal(host.close(), close); assert.equal(destructions(), 1);
});

test('cancellation does not hide a native storage failure', async t => {
  const controller = new AbortController();
  const { host } = local(t, () => { controller.abort(); throw Error('STORAGE_ERROR'); });
  await assert.rejects(host.addresses.next({ accountId: 'test', signal: controller.signal }), error => {
    assert.equal(error.code, 'STORAGE_ERROR'); assert.equal(host.completion(error).completion, 'unknown'); return true;
  });
});

test('malformed worker failure invalidates rather than leaving a pending request', async t => {
  const { port1, port2 } = new MessageChannel();
  port2.on('message', ({ id }) => port2.postMessage({ id, completion: 'unknown', invalid: false, outcome: { ok: false } }));
  const host = attachWalletWorker(port1, async () => port2.close(), { maxQueuedJobs: 2, maxQueuedBytes: 4096 });
  t.after(async () => { await host.close().catch(() => {}); });
  await assert.rejects(host.accounts.list(), error => error.code === 'WORKER_CRASHED' && host.completion(error).completion === 'unknown');
});

test('scan batches own binary inputs and share queue bounds and committed cancellation', async t => {
  const target = { height: 100, hash: '03'.repeat(32) };
  const controller = new AbortController(); let calls = 0;
  const { host } = local(t, (_g, _i, operation, args) => {
    calls++; assert.equal(operation, 'scan_ingest_batch');
    assert.equal(args.blocks.length, 16); assert.equal(args.blocks[0][0], 7);
    assert.equal(args.priorTreeState[0], 8); assert.deepEqual(args.target, target);
    controller.abort(); return { revision: 'next', start: 100, endExclusive: 101, blocks: 16 };
  }, undefined, { maxQueuedJobs: 4, maxQueuedBytes: 65536 });
  const bytes = new Uint8Array([7]), prior = new Uint8Array([8]);
  const args = { target, revision: 'old', blocks: Array.from({ length: 16 }, () => bytes), priorTreeState: prior, signal: controller.signal };
  const pending = host.scan.ingest(args); bytes.fill(9); prior.fill(9);
  await assert.rejects(pending, error => error.code === 'ABORTED'
    && host.completion(error).completion === 'committed' && host.completion(error).value.revision === 'next');
  await assert.rejects(host.scan.ingest({ ...args, signal: undefined, blocks: [new Uint8Array(65536)] }), { code: 'RESOURCE_LIMIT' });
  await assert.rejects(host.scan.ingest({ ...args, signal: undefined, blocks: [new Uint8Array(new SharedArrayBuffer(1))] }), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 1);
});
test('native scan admission errors retain completion and allow replanning', async t => {
  let calls = 0;
  const { host } = local(t, () => {
    if (++calls === 1) throw Object.assign(Error('STALE_REVISION'), { commit: 'none' });
    return { revision: 'new', target: { height: 100, hash: '03'.repeat(32) }, ranges: [] };
  });
  const args = { target: { height: 100, hash: '03'.repeat(32) } };
  await assert.rejects(host.scan.plan(args), error => error.code === 'CURSOR_STALE' && error.stage === 'sync'
    && error.recovery === 'sync' && host.completion(error).completion === 'none');
  assert.equal((await host.scan.plan(args)).revision, 'new');
});

test('wallet-wide state reads and rewind preserve native points and commit receipts', async t => {
  const controller = new AbortController();
  const point = { height: 80, hash: '04'.repeat(32) };
  const { host } = local(t, (_g, _i, command, args) => {
    if (command === 'scan_state') return { revision: 'before', fullyScannedHeight: 100 };
    if (command === 'scan_block_hash') { assert.equal(args.height, 80); return { revision: 'before', point }; }
    assert.equal(command, 'scan_rewind');
    assert.equal(args.revision, 'before'); assert.deepEqual(args.requestedPoint, point);
    controller.abort();
    return { revision: 'after', point: { height: 64, hash: '05'.repeat(32) } };
  });
  assert.equal((await host.scan.state()).fullyScannedHeight, 100);
  assert.deepEqual((await host.scan.block({ height: 80 })).point, point);
  const args = { revision: 'before', requestedPoint: { ...point }, signal: controller.signal };
  const pending = host.scan.rewind(args); args.requestedPoint.height = 99;
  await assert.rejects(pending, error => error.code === 'ABORTED'
    && host.completion(error).completion === 'committed'
    && host.completion(error).value.point.height === 64);
});

test('enhancement application owns full transaction bytes and preserves stale-request failure', async t => {
  const request = { kind: 'enhancement', txid: '06'.repeat(32) };
  let writes = 0;
  const { host } = local(t, (_g, _i, command, args) => {
    if (command === 'enhancement_requests') return { revision: 'r1', requests: [request] };
    assert.equal(command, 'enhancement_apply');
    if (writes++) throw Object.assign(Error('STALE_REVISION'), { commit: 'none' });
    assert.deepEqual(args.request, request);
    assert.deepEqual([...args.result.transactions[0].bytes], [1, 2, 3]);
    return { revision: 'r2' };
  });
  assert.deepEqual((await host.enhancement.requests()).requests, [request]);
  const bytes = new Uint8Array([1, 2, 3]);
  const args = { revision: 'r1', request, result: { transactions: [{ bytes, minedHeight: 100 }] } };
  const pending = host.enhancement.apply(args); bytes.fill(9);
  assert.equal((await pending).revision, 'r2');
  await assert.rejects(host.enhancement.apply(args), error => error.code === 'CURSOR_STALE'
    && error.stage === 'sync' && host.completion(error).completion === 'none');
});

test('completed tree snapshots own bytes and retain committed cancellation receipts', async t => {
  const controller=new AbortController(),target={height:99,hash:'03'.repeat(32)};
  const {host}=local(t,(_g,_i,command,args)=>{
    assert.equal(command,'scan_complete');assert.equal(args.treeState[0],7);assert.equal(args.target.height,99);
    controller.abort();return{revision:'completed'};
  });
  const treeState=new Uint8Array([7]),pending=host.scan.complete({revision:'before',target,treeState,signal:controller.signal});
  treeState[0]=8;target.height=100;
  await assert.rejects(pending,error=>error.code==='ABORTED'&&host.completion(error).completion==='committed'
    &&host.completion(error).value.revision==='completed');
});

test('wallet queries preserve native nulls and bytes, and stale cursors remain recoverable read failures', async t => {
  const bytes = new Uint8Array([1, 2, 3]);
  const { host } = local(t, (_g, _i, command, args) => {
    if (command === 'wallet_history') {
      assert.equal(args.accountId, 'account');
      if (args.cursor) throw Object.assign(Error('CURSOR_STALE'), { commit: 'none' });
      return { items: [{ balanceDelta: -9n, fee: null }], nextCursor: 'page', historyComplete: 'unknown' };
    }
    assert.equal(command, 'wallet_transaction');
    return args.txid === 'absent' ? null : { raw: args.txid === 'pending' ? null : bytes, outputs: [] };
  });
  const args = { accountId: 'account', limit: 1 };
  const pending = host.getHistory(args); args.accountId = 'mutated';
  assert.equal((await pending).items[0].balanceDelta, -9n);
  await assert.rejects(host.getHistory({ accountId: 'account', cursor: 'stale' }), error =>
    error.code === 'CURSOR_STALE' && error.stage === 'query' && host.completion(error).completion === 'none');
  assert.equal(await host.getTransaction({ txid: 'absent' }), null);
  assert.equal((await host.getTransaction({ txid: 'pending' })).raw, null);
  const transaction = await host.getTransaction({ txid: 'enhanced' });
  assert.deepEqual(transaction.raw, bytes);
  transaction.raw.fill(0);
  assert.deepEqual([...bytes], [1, 2, 3]);
});

test('inventory queries own filters and preserve unknown fields and read cancellation', async t => {
  const controller = new AbortController();
  let cancel = false;
  const { host } = local(t, (_g, _i, command, args) => {
    assert.ok(command === 'wallet_notes' || command === 'wallet_utxos');
    if (args.cursor) throw Object.assign(Error('CURSOR_STALE'), { commit: 'none' });
    if (command === 'wallet_notes') assert.equal(args.locked, false);
    if (cancel) { cancel = false; controller.abort(); }
    return { items: [{ value: 9n, coinbase: null, lock: null, lockKnown: false,
      spendState: 'unknown', spendingTxid: null, uneconomic: null, eligibility: 'unknown' }], nextCursor: null };
  });
  const args = { accountId: 'account', locked: false };
  const pending = host.listNotes(args); args.locked = true;
  const note = (await pending).items[0];
  assert.equal(note.value, 9n); assert.equal(note.coinbase, null); assert.equal(note.lockKnown, false);
  await assert.rejects(host.listUtxos({ accountId: 'account', cursor: 'stale' }), error =>
    error.code === 'CURSOR_STALE' && error.stage === 'query' && host.completion(error).completion === 'none');
  cancel = true;
  await assert.rejects(host.listUtxos({ accountId: 'account', signal: controller.signal }), error =>
    error.code === 'ABORTED' && host.completion(error).completion === 'none');
  assert.equal((await host.listUtxos({ accountId: 'account' })).items[0].eligibility, 'unknown');
});

test('checkpoint import snapshots registered network and bounded bytes before queueing', async t => {
  const definition = {identity:'checkpoint-fixture',genesisHash:Array.from({length:32},(_,i)=>i.toString(16).padStart(2,'0')).join(''),
    parametersFormat:'zcash-js-network/1',parameters:new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}')};
  const network = await defineNetwork(definition), calls = [];
  const {host} = local(t, (_g,_i,op,args) => { calls.push([op,args]); return args; });
  const input = {viewingKey:'fixture',birthday:{network,firstScanHeight:100,priorTreeState:new Uint8Array([1,2,3]),source:'checkpoint'}};
  const pending = host.accounts.import(input);
  input.birthday.priorTreeState.fill(9); input.birthday.firstScanHeight=1;
  const received = await pending;
  assert.deepEqual(received.birthday.priorTreeState,new Uint8Array([1,2,3]));
  assert.equal(received.birthday.firstScanHeight,100);
  assert.deepEqual(received.birthday.genesis,Uint8Array.from({length:32},(_,i)=>31-i));
  assert.deepEqual(received.birthday.parameters,definition.parameters);
  assert.equal(Object.hasOwn(received.birthday,'network'),false);
  assert.equal(Object.hasOwn(received.birthday,'recoverUntilExclusive'),false);
  let reads=0;
  for(const birthday of [{...input.birthday,network:{...network}},
    {...input.birthday,get priorTreeState(){reads++;return new Uint8Array();}}]) {
    await assert.rejects(host.accounts.import({...input,birthday}), error => {
      assert.equal(error.code,'INVALID_ARGUMENT');assert.equal(host.completion(error).completion,'none');return true;
    });
  }
  await assert.rejects(host.accounts.import({...input,birthday:{...input.birthday,priorTreeState:new Uint8Array(4096)}}),{code:'RESOURCE_LIMIT'});
  assert.equal(reads,0);assert.equal(calls.length,1);
});

test('wallet ports share one owner queue budget and release it on close', async t => {
  const shared = {jobs:0,bytes:0,active:false,wake:new Set()};
  const ports=[],calls=[];
  for(let i=0;i<2;i++) {
    const {port1,port2}=new MessageChannel();
    installWalletWorker({generation:i+1,instance:'shared',call(){calls.push(i);return [];},close(){}},port2);
    const host=attachWalletWorker(port1,async()=>port2.close(),{maxQueuedJobs:1,maxQueuedBytes:128},shared);
    ports.push(host);t.after(()=>host.close().catch(()=>{}));
  }
  const first=ports[0].accounts.list();
  await assert.rejects(ports[1].accounts.list(),{code:'RESOURCE_LIMIT'});
  await first;
  await ports[0].close();
  await ports[1].accounts.list();
  await ports[1].close();
  assert.deepEqual(calls,[0,1]);
  assert.equal(shared.jobs,0);assert.equal(shared.bytes,0);assert.equal(shared.active,false);assert.equal(shared.wake.size,0);
});

test('worker rejects malformed signer payloads before calling native authority', async t => {
  const { port1, port2 } = new MessageChannel();
  t.after(() => { port1.close(); port2.close(); });
  let calls = 0;
  installWalletWorker(undefined, port2, () => false, {
    capabilities(token) { calls++; return { token }; },
    authorize() { calls++; throw Error('unexpected native call'); },
  });
  let id = 0;
  const send = (command, args) => new Promise(resolve => {
    port1.once('message', resolve);
    port1.postMessage({ id: ++id, command, args });
  });
  for (const args of [null, [], {}, { token: '1' }]) {
    const reply = await send('signer_capabilities', args);
    assert.equal(reply.outcome.ok, false);
    assert.equal(reply.outcome.error.code, 'INVALID_ARGUMENT');
    assert.equal(reply.invalid, false);
  }
  const malformed = await send('signer_authorize', {
    token: 1, format: 'zcash-js-network/1', parameters: new Uint8Array(), genesis: new Uint8Array(32),
    height: 1, branch: 1, bytes: 'not bytes', maximum: 1024,
  });
  assert.equal(malformed.outcome.error.code, 'INVALID_ARGUMENT');
  assert.equal(calls, 0);
  const valid = await send('signer_capabilities', { token: 1 });
  assert.deepEqual(valid.outcome, { ok: true, value: { token: 1 } });
  assert.equal(calls, 1);
});

// Inject native tags at the port boundary; these do not execute native failure scenarios.
for (const [tag, code, fatal, message] of [
  ['ACCOUNT_KEY_MISMATCH', 'ACCOUNT_KEY_MISMATCH', true, /signing authority/],
  ['PROTOCOL_MISMATCH', 'PROTOCOL_MISMATCH', true, /inconsistent/],
  ['ACCOUNT_NOT_SPENDABLE', 'FULL_VIEWING_KEY_REQUIRED', true, /full viewing/],
  ['UNSUPPORTED_STORED_ADDRESS', 'STORAGE_ERROR', true, /storage/],
  ['MIGRATION_REQUIRED', 'MIGRATION_REQUIRED', true, /migration/],
  ['UNSUPPORTED_HD_POOLS', 'UNSUPPORTED_POOL', false, /pool/],
  ['SIGNER_MISMATCH', 'ACCOUNT_KEY_MISMATCH', false, /signing authority/],
  ['INVALID_MNEMONIC', 'INVALID_MNEMONIC', false, /mnemonic/],
  ['ENTROPY_UNAVAILABLE', 'ENTROPY_UNAVAILABLE', false, /randomness/],
  ['ACCOUNT_NOT_FOUND', 'ACCOUNT_NOT_FOUND', false, /account/],
  ['ACCOUNT_COLLISION', 'ACCOUNT_COLLISION', false, /already exists/],
  ['ADDRESS_INDEX_REUSE', 'ADDRESS_ALREADY_EXPOSED', false, /index/],
  ['INPUT_LOCKED', 'INPUT_LOCKED', false, /reserved/],
  ['ASSET_UNAVAILABLE', 'ASSET_UNAVAILABLE', false, /proving asset/],
  ['PAYMENT_BLOCKED', 'PAYMENT_BLOCKED', false, /dependency/],
  ['TRANSACTION_EXPIRED', 'TRANSACTION_EXPIRED', false, /reconcile/],
  ['SUBMISSION_REJECTED', 'SUBMISSION_REJECTED', false, /retained operation/],
  ['SUBMISSION_UNKNOWN', 'SUBMISSION_UNKNOWN', false, /reconcile/],
]) test(`native ${tag} retains classification and correct session lifetime`, async t => {
  let calls = 0;
  const {host} = local(t, () => { if (!calls++) throw Object.assign(Error(tag), {private: 'PRIVATE_SENTINEL'}); return []; });
  await assert.rejects(host.accounts.list(), error => {
    assert.ok(isZcashError(error)); assert.equal(error.code, code); assert.match(error.message, message);
    assert.equal(error.recovery, fatal ? 'reopen' : 'correct-input');
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /PRIVATE_SENTINEL/);
    assert.equal(host.completion(error).completion, 'unknown'); return true;
  });
  if (fatal) await assert.rejects(host.accounts.list(), {code: 'CLOSED'});
  else assert.deepEqual(await host.accounts.list(), []);
  assert.equal(calls, fatal ? 1 : 2);
});

for (const importing of [true, false]) test(`missing authority ${importing ? 'rejects import without closing' : 'invalidates inconsistent stored authority'}`, async t => {
  let calls = 0;
  const {host} = local(t, () => {if (!calls++) throw 'MISSING_AUTHORITY'; return [];});
  const request = importing ? host.accounts.import({viewingKey:'synthetic',birthday:'fullScan'}) : host.accounts.list();
  await assert.rejects(request, error => {
    assert.equal(error.code, 'RECEIVER_UNAVAILABLE'); assert.equal(error.recovery, importing ? 'correct-input' : 'reopen');
    assert.match(error.message, /receiver/); return true;
  });
  if (importing) assert.deepEqual(await host.accounts.list(), []);
  else await assert.rejects(host.accounts.list(), {code:'CLOSED'});
});

test('scan batches transfer only host-owned copies and keep caller views usable', async t => {
  const target = { height: 100, hash: '03'.repeat(32) };
  const seen = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { host } = local(t, async (_g, _i, operation, args) => {
    if (operation === 'account_list') { await gate; return []; }
    seen.push({ blocks: args.blocks.map(b => [...b]), prior: [...args.priorTreeState],
      buffers: new Set(args.blocks.map(b => b.buffer)).size });
    return { revision: 'next', start: 100, endExclusive: 101, blocks: args.blocks.length };
  }, undefined, { maxQueuedJobs: 4, maxQueuedBytes: 65536 });
  const backing = new Uint8Array(64).map((_, i) => i);
  const view = backing.subarray(8, 12), repeated = new Uint8Array([5, 6]), prior = backing.subarray(0, 3);
  const args = { target, revision: 'old', blocks: [view, repeated, repeated, backing.subarray(10, 11)], priorTreeState: prior };
  const blocker = host.accounts.list();
  const controller = new AbortController();
  const aborted = host.scan.ingest({ ...args, signal: controller.signal });
  const pending = host.scan.ingest(args);
  controller.abort();
  await assert.rejects(aborted, error => error.code === 'ABORTED' && host.completion(error).completion === 'none');
  backing.fill(0xff); repeated.fill(0xee);
  release(); await blocker;
  assert.equal((await pending).revision, 'next');
  assert.deepEqual(seen, [{ blocks: [[8, 9, 10, 11], [5, 6], [5, 6], [10]], prior: [0, 1, 2], buffers: 4 }]);
  for (const caller of [backing, view, repeated, prior]) {
    assert.ok(caller.buffer.byteLength > 0); caller[0] = 1; assert.equal(caller[0], 1);
  }
  assert.equal(backing.byteLength, 64);
  await assert.rejects(host.scan.ingest({ ...args, blocks: [new Uint8Array(40000)] }), error =>
    error.code === 'RESOURCE_LIMIT' && host.completion(error).completion === 'none');
  assert.equal((await host.scan.ingest(args)).revision, 'next');
});

test('real worker thread receives transferred scan copies while caller buffers stay attached', async t => {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL('./scan-transfer-worker.js', import.meta.url), { workerData: { port: port2 }, transferList: [port2] });
  const host = attachWalletWorker(port1, () => worker.terminate(), { maxQueuedJobs: 4, maxQueuedBytes: 65536 });
  worker.on('error', host.crashed); worker.on('exit', host.crashed);
  t.after(async () => { await host.close().catch(() => {}); });
  await once(worker, 'message');
  const backing = new Uint8Array([1, 2, 3, 4, 5, 6]), repeated = new Uint8Array([7]);
  const args = { target: { height: 100, hash: '03'.repeat(32) }, revision: 'old',
    blocks: [backing.subarray(2, 4), repeated, repeated], priorTreeState: backing.subarray(0, 1) };
  const first = host.scan.ingest(args), second = host.scan.ingest(args);
  backing.fill(0); repeated.fill(0);
  assert.equal((await first).revision, '1,3,4,7,7');
  assert.equal((await second).revision, '1,3,4,7,7');
  assert.equal(backing.buffer.byteLength, 6); assert.equal(repeated.byteLength, 1);
  assert.equal((await host.scan.ingest(args)).revision, '0,0,0,0,0');
});
