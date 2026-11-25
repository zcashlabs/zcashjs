import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEnhancement, applyUnspentBatch } from '../../dist/src/wallet/enhancement.js';
import { failure } from '../../dist/src/errors.js';

test('address enhancement commits bounded batches but only completes after successful exhaustion', async () => {
  const request = { kind: 'address', address: 'fixture', start: 1, endExclusive: 10, requestAt: null, txStatus: 'mined', outputStatus: 'all' };
  for (const fail of [false, true]) {
    const commits = [];
    const session = { enhancement: { async requests() { return { revision: String(commits.length), requests: [request] }; }, async apply(args) {
      assert.equal(args.revision, String(commits.length)); commits.push(args.result);
      return { revision: String(commits.length) };
    } } };
    const light = { async *streamAddressTransactions() {
      for (let i = 0; i < 17; i++) yield { raw: new Uint8Array([i]), observation: { state: 'mined', inclusion: { height: 2 } } };
      if (fail) throw Error('fixture transport failed');
    } };
    const result = applyEnhancement(session, light, '0', request);
    if (fail) await assert.rejects(result, /fixture transport failed/); else await result;
    assert.equal(commits[0].transactions.length, 16); assert.equal(commits[0].complete, false);
    assert.equal(commits.length, fail ? 1 : 2);
    if (!fail) { assert.equal(commits[1].transactions.length, 1); assert.equal(commits[1].complete, true); }
  }
});

test('a partial batch that resolves the native request closes the stream without a stale final write', async () => {
  let writes = 0, closed = false;
  const session = { enhancement: {
    async apply() { writes++; return { revision: '1' }; },
    async requests() { return { revision: '1', requests: [] }; },
  } };
  const light = { async *streamAddressTransactions() {
    try { for (let i = 0; i < 20; i++) yield { raw: new Uint8Array([i]), observation: { state: 'mined', inclusion: { height: 2 } } }; }
    finally { closed = true; }
  } };
  await applyEnhancement(session, light, '0', { kind: 'address', address: 'fixture', start: 1,
    endExclusive: 10, requestAt: null, txStatus: 'mined', outputStatus: 'all' });
  assert.equal(writes, 1); assert.equal(closed, true);
});

function unspentFixture(count=17){
  const hash=Array.from({length:32},(_,i)=>i.toString(16).padStart(2,'0')).join(''),nativeHash=hash.match(/../g).reverse().join('');
  const request={kind:'address',address:'fixture',start:1,endExclusive:null,requestAt:null,txStatus:'all',outputStatus:'unspent'};
  const items=Array.from({length:count},(_,i)=>({txid:(i+1).toString(16).padStart(64,'0'),outputIndex:0,address:'fixture',value:1n,script:new Uint8Array([1]),minedHeight:2}));
  const commits=[],control={tips:0,failAfter:false,wrongNative:false,raw:0,stall:false,entered:null};let revision='0';
  const session={scan:{async state(){return {revision,tipHeight:50};},async block(){return {revision,point:{height:50,hash:control.wrongNative?'ff'.repeat(32):nativeHash}};}},enhancement:{async apply(args){assert.equal(args.revision,revision);assert.equal(args.result.asOfHash,nativeHash);commits.push(structuredClone(args.result));return {revision:revision=String(+revision+1)};}}};
  const light={async getTip(){control.tips++;return {height:50,hash:control.failAfter&&control.tips>=2?'ff'.repeat(32):hash,sourceId:'source',observedAt:'fixture'};},
    async getAddressUtxos(){return {items,tip:null,sourceId:'source',observedAt:'fixture'};},
    async getTransaction({txid}){control.raw++;if(control.stall){control.entered?.();return new Promise(()=>{});}items[0]?.script.fill(99);return {txid,raw:new Uint8Array([1,2]),sourceId:'source',observedAt:'fixture',observation:{txid,state:'mined',inclusion:{height:2,blockHash:null,confirmations:null},tip:null,priorInclusion:null,sourceId:'source',observedAt:'fixture'}};}};
  return {session,light,request,commits,control,items};
}

test('unspent enhancement owns positive outputs, brackets native tip and completes only after all raw reads',async()=>{
  for(const failAfter of [false,true]){
    const value=unspentFixture();value.control.failAfter=failAfter;
    const result=applyEnhancement(value.session,value.light,'0',value.request);
    await result;
    assert.equal(value.control.raw,17);assert.equal(value.commits.length,failAfter?0:1);
    if(!failAfter){assert.equal(value.commits[0].transactions.length,17);assert.equal(value.commits[0].complete,true);
      assert.equal(value.commits[0].transactions[0].unspentOutputs[0].script[0],1);assert.equal(value.commits[0].transactions[0].txid,value.items[0].txid);}
  }
});

test('unspent enhancement defers ordinary extension without completing the native request', async () => {
  const value = unspentFixture(0);
  value.session.scan.state = async () => ({ revision: '0', tipHeight: 49 });
  value.session.scan.block = async () => ({ revision: '0', point: null });
  value.light.getAddressUtxos = async () => { throw Error('future-tip inventory must not be read'); };
  await applyEnhancement(value.session, value.light, '0', value.request);
  assert.equal(value.commits.length, 0);
});

test('unspent enhancement distinguishes revision races from chain recovery', async () => {
  const value = unspentFixture(0);
  value.session.scan.state = async () => ({ revision: '1', tipHeight: 50 });
  await assert.rejects(applyEnhancement(value.session, value.light, '0', value.request), { code: 'CURSOR_STALE' });
  assert.equal(value.commits.length, 0);
});

test('unspent enhancement never defers a changed source identity', async () => {
  const value = unspentFixture(0), original = value.light.getTip;
  value.light.getTip = async () => {
    const tip = await original();
    return { ...tip, sourceId: value.control.tips > 1 ? 'different' : tip.sourceId };
  };
  await assert.rejects(applyEnhancement(value.session, value.light, '0', value.request), { code: 'PROTOCOL_MISMATCH' });
  assert.equal(value.commits.length, 0);
});

test('unspent enhancement rejects unpinned native chain and cancels an ignored raw read',async()=>{
  const mismatch=unspentFixture(1);mismatch.control.wrongNative=true;
  await assert.rejects(applyEnhancement(mismatch.session,mismatch.light,'0',mismatch.request),{code:'RECOVERY_REQUIRED'});assert.equal(mismatch.control.raw,0);assert.equal(mismatch.commits.length,0);
  const pending=unspentFixture(1),controller=new AbortController();pending.control.stall=true;
  const entered=new Promise(resolve=>{pending.control.entered=resolve;});const result=applyEnhancement(pending.session,pending.light,'0',pending.request,controller.signal);
  const rejected=assert.rejects(result,{code:'ABORTED'});await entered;controller.abort();await rejected;assert.equal(pending.commits.length,0);
  const duplicate=unspentFixture(1);duplicate.items.push(duplicate.items[0]);await assert.rejects(applyEnhancement(duplicate.session,duplicate.light,'0',duplicate.request),{code:'PROTOCOL_MISMATCH'});assert.equal(duplicate.commits.length,0);
});

test('worker admission copies bounded nested positive outputs using existing queue accounting',async()=>{
  const {MessageChannel}=await import('node:worker_threads');
  const {attachWalletWorker}=await import('../../dist/src/wallet/host.js');
  const {installWalletWorker}=await import('../../dist/src/wallet/worker.js');
  const channel=new MessageChannel();let received;
  installWalletWorker({generation:1,instance:'fixture',close(){},call(_g,_i,command,args){assert.equal(command,'enhancement_apply');received=args;return {revision:'1'};}},channel.port2);
  const session=attachWalletWorker(channel.port1,async()=>channel.port2.close(),{maxQueuedJobs:4,maxQueuedBytes:65536,maxPcztBytes:65536});
  try{
    const outputs=Array.from({length:20},(_,outputIndex)=>({outputIndex,script:new Uint8Array([1]),value:2n}));
    const args={revision:'0',request:unspentFixture(0).request,result:{transactions:[{txid:'01'.repeat(32),bytes:new Uint8Array([1]),minedHeight:2,unspentOutputs:outputs}],asOfHeight:50,asOfHash:'ab'.repeat(32),complete:true}};
    const pending=session.enhancement.apply(args);outputs[0].script[0]=99;await pending;
    assert.equal(received.result.transactions[0].txid,'01'.repeat(32));assert.equal(received.result.transactions[0].unspentOutputs.length,20);assert.equal(received.result.transactions[0].unspentOutputs[0].script[0],1);assert.equal(received.result.transactions[0].unspentOutputs[0].value,2n);
    const original=args.result.transactions[0];args.result.transactions=Array.from({length:17},()=>({...original,unspentOutputs:[outputs[0]]}));await session.enhancement.apply(args);assert.equal(received.result.transactions.length,17);
    let reads=0;const request=new Proxy(args.request,{getOwnPropertyDescriptor(target,key){if(key==='txStatus'){reads++;return {...Reflect.getOwnPropertyDescriptor(target,key),value:reads===1?'all':'mined'};}return Reflect.getOwnPropertyDescriptor(target,key);}});
    await session.enhancement.apply({...args,request});assert.equal(reads,1);assert.equal(received.request.txStatus,'all');
    args.result.transactions=[original];
    args.result.transactions[0].unspentOutputs=Array.from({length:1001},()=>outputs[0]);await assert.rejects(session.enhancement.apply(args),{code:'INVALID_ARGUMENT'});
  }finally{await session.close();}
});

test('empty inventory and positive mempool evidence complete without inventing mined height',async()=>{
  const empty=unspentFixture(0);await applyEnhancement(empty.session,empty.light,'0',empty.request);
  assert.equal(empty.control.raw,0);assert.deepEqual(empty.commits[0].transactions,[]);assert.equal(empty.commits[0].complete,true);
  const value=unspentFixture(1);value.items[0].minedHeight=null;
  value.light.getTransaction=async({txid})=>({txid,raw:new Uint8Array([1]),sourceId:'source',observedAt:'fixture',observation:{txid,state:'mempool',inclusion:null,tip:null,priorInclusion:null,sourceId:'source',observedAt:'fixture'}});
  await applyEnhancement(value.session,value.light,'0',value.request);assert.equal(value.commits[0].transactions[0].minedHeight,null);
});

test('unspent raw-plus-script overflow rejects the whole inventory before any commit',async()=>{
  const value=unspentFixture(2),get=value.light.getTransaction;value.light.getTransaction=async args=>({...await get(args),raw:new Uint8Array(1024*1024)});
  await assert.rejects(applyEnhancement(value.session,value.light,'0',value.request),{code:'RESOURCE_LIMIT'});assert.equal(value.commits.length,0);
});


test('unspent item validation rejects accessors and malformed fields before fetching transactions', async () => {
  for (const change of [{outputIndex: '0'}, {value: 1}, {minedHeight: 51}, {txid: {}}, {minedHeight: undefined}]) {
    const fixture = unspentFixture(1);
    Object.assign(fixture.items[0], change);
    await assert.rejects(applyEnhancement(fixture.session, fixture.light, '0', fixture.request), {code: 'PROTOCOL_MISMATCH'});
    assert.equal(fixture.control.raw, 0);
    assert.equal(fixture.commits.length, 0);
  }
  const fixture = unspentFixture(1);
  let reads = 0;
  Object.defineProperty(fixture.items[0], 'value', {get() { reads++; return 1n; }});
  await assert.rejects(applyEnhancement(fixture.session, fixture.light, '0', fixture.request), {code: 'PROTOCOL_MISMATCH'});
  assert.equal(reads, 0);
  assert.equal(fixture.control.raw, 0);
});

test('unspent batch answers several addresses from one source view with one commit each', async () => {
  const hash = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(''),
    nativeHash = hash.match(/../g).reverse().join('');
  const request = address => ({ kind: 'address', address, start: 1, endExclusive: null, requestAt: null,
    txStatus: 'all', outputStatus: 'unspent' });
  const requests = ['a', 'b', 'c'].map(request);
  const shared = '11'.repeat(32);
  const items = [
    { txid: shared, outputIndex: 0, address: 'a', value: 1n, script: new Uint8Array([1]), minedHeight: 2 },
    { txid: shared, outputIndex: 1, address: 'b', value: 2n, script: new Uint8Array([2]), minedHeight: 2 },
  ];
  let revision = '0', tips = 0, inventories = 0, raws = 0;
  const commits = [];
  const session = { scan: {
    async state() { return { revision, tipHeight: 50 }; },
    async block() { return { revision, point: { height: 50, hash: nativeHash } }; },
  }, enhancement: { async apply(args) {
    assert.equal(args.revision, revision); commits.push(args);
    return { revision: revision = String(+revision + 1) };
  } } };
  const light = {
    async getTip() { tips++; return { height: 50, hash, sourceId: 'source', observedAt: 'fixture' }; },
    async getAddressUtxos({ addresses }) { inventories++; assert.deepEqual(addresses, ['a', 'b', 'c']);
      return { items, tip: null, sourceId: 'source', observedAt: 'fixture' }; },
    async getTransaction({ txid }) { raws++; return { txid, raw: new Uint8Array([1, 2]), sourceId: 'source', observedAt: 'fixture',
      observation: { txid, state: 'mined', inclusion: { height: 2, blockHash: null, confirmations: null }, tip: null,
        priorInclusion: null, sourceId: 'source', observedAt: 'fixture' } }; },
  };
  const committed = await applyUnspentBatch(session, light, '0', requests);
  assert.deepEqual(committed, requests);
  assert.equal(tips, 2); assert.equal(inventories, 1); assert.equal(raws, 1, 'a shared transaction is read once');
  assert.deepEqual(commits.map(c => [c.request.address, c.result.transactions.length, c.result.complete]),
    [['a', 1, true], ['b', 1, true], ['c', 0, true]]);
  assert.deepEqual(commits[1].result.transactions[0].unspentOutputs.map(o => o.outputIndex), [1]);

  // A moved source defers every request without committing.
  commits.length = 0; revision = '0'; tips = 0;
  light.getTip = async () => ({ height: 50, hash: ++tips === 2 ? 'ff'.repeat(32) : hash, sourceId: 'source', observedAt: 'fixture' });
  assert.deepEqual(await applyUnspentBatch(session, light, '0', requests), []);
  assert.equal(commits.length, 0);

  // Too many UTXOs for one response: the caller falls back to one request at a time.
  light.getTip = async () => ({ height: 50, hash, sourceId: 'source', observedAt: 'fixture' });
  light.getAddressUtxos = async () => { throw failure('RESOURCE_LIMIT', 'transport', 'configure', 'Too many.'); };
  assert.equal(await applyUnspentBatch(session, light, '0', requests), null);
  // Any other failure propagates.
  light.getAddressUtxos = async () => { throw failure('TRANSPORT_ERROR', 'transport', 'configure', 'Down.', true); };
  await assert.rejects(applyUnspentBatch(session, light, '0', requests), { code: 'TRANSPORT_ERROR' });
});
