import { waitForConfirmation } from '../../examples/testnet/confirmation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {attachWalletWorker} from '../../dist/src/wallet/host.js';
import {installWalletWorker} from '../../dist/src/wallet/worker.js';
import {WalletPayments} from '../../dist/src/wallet/payments.js';
import {defineNetwork} from '../../dist/src/network.js';
import {failure,isZcashError} from '../../dist/src/errors.js';
import {networkDefinition} from '../sdk/light-client-fixture.js';
import {scalar,bytesField,concat} from '../clients/light-chain-reads-fixtures.js';
const network=await defineNetwork(networkDefinition()),txid='12'.repeat(32),hash='34'.repeat(32);
const operationId=n=>n.toString(16).padStart(64,'0');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup(t,{count=1,finalized=true,light=true,online=false,buffer=2,delayed=false,steps=1,retry,submissionSync=false,recoveryTimeoutMs=30}={}){
  const journal=Array.from({length:count},(_,index)=>({sequence:String(index+1),observationSequence:'0',state:{operationId:operationId(index+1),revision:'1',accountIds:['account'],phase:finalized?'ready':'proposed',missing:finalized?[]:['artifact','finalizedBytes'],steps:[{index:0,dependsOn:[],txid:finalized?txid:null,exactBytesSha256:finalized?'56'.repeat(32):null,attempts:[],inclusion:null,observation:null,expiry:{height:0,reached:false,confirmedUnminedAt:null},blockedBy:[]}]}}));
  const stepTxid=index=>(0x12+index).toString(16).repeat(32);
  for(const row of journal){row.state.steps=Array.from({length:steps},(_,index)=>({...structuredClone(row.state.steps[0]),index,dependsOn:index?[index-1]:[],txid:finalized?stepTxid(index):null}));row.observationSequences=Array(steps).fill('0');}
  const control={revision:1,calls:[],requests:0,dispatches:0,finish:0,position:'0',closed:0,reads:0,mined:false,stalled:false,started:null,reply:null};
  control.seen=new Set();control.order=[];control.policies=[];
  control.scannedHeight=19;control.sourceHeight=20;control.refreshes=0;
  const channels=new MessageChannel(),budget={jobs:0,bytes:0,active:false,wake:new Set(),signers:new Map(),proving:{capacity:128*1024*1024,bytes:0,active:false}};
  const current=row=>{row.state.revision=String(control.revision);return structuredClone({state:row.state,observationSequence:row.observationSequence,observationSequences:row.observationSequences});};
  installWalletWorker({generation:1,instance:'wallet',close(){control.closed++;},call(_g,_i,command,args){
    control.calls.push(command);
    if(command==='scan_state')return {revision:String(control.revision),tipHeight:control.scannedHeight,maxScannedHeight:control.scannedHeight,fullyScannedHeight:control.scannedHeight,scanComplete:true};
    if(command==='scan_block_hash')return {revision:String(control.revision),point:args.height<=control.scannedHeight?{height:args.height,hash}:null};
    const row=journal.find(row=>row.state.operationId===args.operationId);
    if(command==='payment_list')return {revision:String(control.revision),highWater:args.highWater??String(count),observationPosition:control.position,
      items:journal.filter(row=>BigInt(row.sequence)>BigInt(args.afterSequence)&&BigInt(row.sequence)<=BigInt(args.highWater??count)).slice(0,args.limit).map(row=>({sequence:row.sequence,operationId:row.state.operationId}))};
    if(command==='payment_recovery_position'){if(control.positionError)throw Object.assign(Error(control.positionError),{commit:'none'});control.position=args.afterSequence;control.revision++;return;}
    if(command==='payment_get'){if(control.getGate){control.started?.();return control.getGate.then(()=>row?current(row):null);}return row?current(row):null;}
    if(!row)throw Object.assign(Error('OPERATION_NOT_FOUND'),{commit:'none'});
    const step=command==='payment_attempt_finish'?row.state.steps.find(step=>step.attempts.some(attempt=>attempt.attemptId===args.attemptId)):row.state.steps[args.stepIndex??0];
    if(command==='payment_reconcile'){if(args.policy)control.policies.push(args.policy);for(const step of row.state.steps)for(const attempt of step.attempts)if(attempt.outcome==='started')attempt.outcome='unknown';control.revision++;return current(row);}
    if(command==='payment_observe'){if(control.observeError)throw Object.assign(Error(control.observeError),{commit:control.observeCommit??'none'});step.observation=args.observation;step.inclusion=args.observation.inclusion;row.observationSequence=String(+row.observationSequence+1);row.observationSequences[step.index]=row.observationSequence;control.revision++;if(control.observeGate){control.observeStarted?.();return control.observeGate.then(()=>current(row));}return current(row);}
    if(command==='payment_attempt_begin'){
      if(submissionSync)assert.equal(control.scannedHeight,control.sourceHeight,'submission requires the scanned observation tip');
      assert.equal(args.maximum,65536);if(!step.txid)throw Object.assign(Error('NOT_FINALIZED'),{commit:'none'});
      if(args.mode==='automatic')return null;
      assert.equal(args.observationSequence,row.observationSequences[step.index]);
      for(const parent of step.dependsOn)assert.equal(row.state.steps[parent].observation.state,'mempool','child requires a new parent observation, not its broadcast acknowledgment');
      assert.equal(step.attempts.some(attempt=>attempt.outcome==='started'),false);
      step.attempts.push({attemptId:step.index+':'+(step.attempts.length+1),outcome:'started',sourceId:args.sourceId,startedAt:args.wallTimeMs,completedAt:null,diagnosticCode:null});control.revision++;
      return {attemptId:step.attempts.at(-1).attemptId,bytes:new Uint8Array([step.index+1,2,3]),txid:step.txid};
    }
    if(command==='payment_attempt_finish'){
      assert.equal('txid'in args,args.outcome==='acknowledged');if(args.diagnosticCode)assert.match(args.diagnosticCode,/^[A-Z0-9_]{1,64}$/);
      const attempt=step.attempts.find(item=>item.attemptId===args.attemptId);Object.assign(attempt,{outcome:args.outcome,completedAt:args.wallTimeMs,diagnosticCode:args.diagnosticCode??null});control.finish++;control.revision++;return current(row);
    }
    throw Error(command);
  }},channels.port2);
  const session=attachWalletWorker(channels.port1,async()=>{channels.port2.close();},{maxQueuedJobs:8,maxQueuedBytes:65536,maxPcztBytes:65536},budget);
  const client={network,async getTreeState({height}){control.requests++;const block=height===0?network.genesisHash:hash;return {network,point:{height,hash:block},sapling:null,ironwood:null,encoded:concat(scalar(2,height),bytesField(3,new TextEncoder().encode(block))),sourceId:'source',observedAt:new Date().toISOString()};},
    async getTip(){control.requests++;return {height:control.sourceHeight,hash,sourceId:'source',observedAt:new Date().toISOString()};},
    async getTransaction(){throw Error('not used');},
    async getTransactionStatus({txid}){control.reads++;control.visited?.push(txid);if(control.stalled){control.started?.();return new Promise(()=>{});}if(control.catchUpAfter && control.reads > control.catchUpAfter)control.sourceHeight=21;return {txid,state:control.mined?'mined':control.seen.has(txid)?'mempool':'notSeen',inclusion:control.mined?{height:control.minedHeight??19,blockHash:control.blockHash??hash,confirmations:999}:null,tip:null,priorInclusion:control.prior??null,sourceId:'source',observedAt:new Date().toISOString()};},
    async broadcastTransaction({bytes}){const index=bytes[0]-1;assert.deepEqual([...bytes],[index+1,2,3]);control.dispatches++;control.order.push(index);control.seen.add(stepTxid(index));control.started?.();if(delayed)return new Promise(resolve=>{control.reply=resolve;});return {txid:stepTxid(index),outcome:'acknowledged',diagnosticCode:null,sourceId:'source',observedAt:new Date().toISOString()};}};
  const wallet={session,close:()=>session.close()};
  const options={network,storage:{kind:'memory'},runtime:{maxQueuedJobs:8},observation:{pollIntervalMs:5,maxBufferedUpdates:buffer},recovery:online?{mode:'online',timeoutMs:recoveryTimeoutMs,...(retry?{rebroadcast:retry}:{})}:{mode:'offline'},...(light?{light:client}:{}),broadcaster:client};
  const payments=new WalletPayments(wallet,{},options,submissionSync?async()=>{
    control.refreshes++;
    if(control.refreshError)throw control.refreshError;
    control.scannedHeight=control.sourceHeight;
    if(control.advanceOnRefresh)control.sourceHeight++;
  }:undefined);
  t.after(async()=>{await payments.close();await session.close();assert.equal(budget.proving.bytes,0);});
  return {payments,session,journal,control,budget,client,wallet,options};
}

test('payment wait survives multi-poll lag without observing incoherent state or submitting', async t => {
  const { payments, control, journal } = setup(t);
  await payments.recover();
  control.mined = true; control.minedHeight = 21; control.catchUpAfter = 4;
  const handle = await payments.operations.resume({ operationId: operationId(1) });
  const result = await handle.wait({ confirmations: 1, timeoutMs: 5000 });
  assert.ok(control.reads >= 5);
  assert.equal(result.transactions[0].height, 21);
  assert.equal(control.calls.filter(c => c === 'payment_observe').length, 1);
  assert.equal(control.dispatches, 0);
  assert.deepEqual(journal[0].state.steps[0].attempts, []);
});

test('persistent lag respects payment wait deadline and preserves prior coherent state', async t => {
  const { payments, control, journal } = setup(t);
  await payments.recover();
  const handle = await payments.operations.resume({ operationId: operationId(1) });
  const before = structuredClone(journal[0].state.steps[0]);
  control.mined = true; control.minedHeight = 21;
  await assert.rejects(handle.wait({ timeoutMs: 700 }), { code: 'TIMEOUT' });
  assert.deepEqual(journal[0].state.steps[0], before);
  assert.equal(control.dispatches, 0);
  const reads = control.reads;
  await wait(30);
  assert.equal(control.reads, reads, 'deadline stops background observation');
});

test('payment wait does not swallow permanent inclusion conflicts', async t => {
  const { payments, control } = setup(t);
  await payments.recover();
  control.mined = true; control.blockHash = 'ff'.repeat(32);
  const handle = await payments.operations.resume({ operationId: operationId(1) });
  await assert.rejects(handle.wait({ timeoutMs: 1000 }), { code: 'PROTOCOL_MISMATCH' });
  assert.equal(control.dispatches, 0);
});

test('explicit submission refreshes a tip advanced during proving without changing finalized bytes',async t=>{
  const {payments,control,journal}=setup(t,{submissionSync:true});
  await payments.recover();
  const before=structuredClone(journal[0].state.steps[0]);
  const pending=await payments.dispatch({operationId:operationId(1),origin:'send'});
  const state=await pending.snapshot();
  assert.equal(control.refreshes,1);assert.equal(control.dispatches,1);
  assert.equal(state.steps[0].txid,before.txid);
  assert.equal(state.steps[0].exactBytesSha256,before.exactBytesSha256);
  assert.equal(state.steps[0].attempts.length,1);
  assert.equal(state.steps[0].attempts[0].outcome,'acknowledged');
});

test('persistent tip movement exhausts bounded refresh before any submission attempt',async t=>{
  const {payments,control,journal}=setup(t,{submissionSync:true});
  control.advanceOnRefresh=true;
  await payments.recover();
  await assert.rejects(payments.broadcast({operationId:operationId(1)}),error=>error.code==='SYNC_REQUIRED'
    &&error.retryable&&error.operationId===operationId(1));
  assert.equal(control.refreshes,3);assert.equal(control.dispatches,0);
  assert.equal(journal[0].state.steps[0].attempts.length,0);
});

test('submission scan failure preserves finalized operation with no attempt',async t=>{
  const {payments,control,journal}=setup(t,{submissionSync:true});
  control.refreshError=Error('scan failed');
  await payments.recover();
  await assert.rejects(payments.broadcast({operationId:operationId(1)}),/scan failed/);
  assert.equal(control.dispatches,0);assert.equal(control.refreshes,1);
  assert.equal(journal[0].state.steps[0].attempts.length,0);
});

test('submission refresh SYNC_REQUIRED identifies the retained finalized operation',async t=>{
  const {payments,control,journal}=setup(t,{submissionSync:true});
  control.refreshError=failure('SYNC_REQUIRED','submission','sync','Wallet scan did not reach its submission target.',true);
  await payments.recover();
  await assert.rejects(payments.broadcast({operationId:operationId(1)}),error=>{
    assert.equal(isZcashError(error),true);
    assert.equal(error.code,'SYNC_REQUIRED');assert.equal(error.stage,'submission');assert.equal(error.retryable,true);
    assert.equal(error.message,'Wallet scan did not reach its submission target.');
    assert.equal(error.operationId,operationId(1));
    assert.equal(error.paymentState.operationId,operationId(1));
    assert.equal(error.paymentState.steps[0].txid,journal[0].state.steps[0].txid);
    assert.deepEqual(error.paymentState.steps[0].attempts,[]);
    return true;
  });
  assert.equal(control.dispatches,0);assert.equal(control.refreshes,1);
  // Recovering the same operation after a successful catch-up dispatches the same bytes once.
  control.refreshError=undefined;
  const state=await payments.broadcast({operationId:operationId(1)});
  assert.equal(control.dispatches,1);
  assert.equal(state.steps[0].exactBytesSha256,journal[0].state.steps[0].exactBytesSha256);
});

test('offline recovery traverses more than one page without IDs or network, then paginates locally',async t=>{
  const {payments,control}=setup(t,{count:405,finalized:false,light:false});
  const result=await payments.recover();assert.equal(result.operations,405);assert.equal(result.local,'complete');assert.equal(result.deferredOperations,0);assert.equal(control.requests,0);
  assert.equal(control.calls.filter(op=>op==='payment_reconcile').length,405);
  const first=await payments.operations.list({limit:200});assert.equal(first.items.length,200);assert.ok(first.nextCursor);
  const second=await payments.operations.list({limit:200,cursor:first.nextCursor});assert.equal(second.items.length,200);
  assert.equal(await payments.operations.get({operationId:operationId(999)}),null);
  const before=control.calls.length;const handle=await payments.operations.resume({operationId:operationId(1)});await handle.snapshot();assert.ok(control.calls.slice(before).every(op=>op==='payment_get'));
  await assert.rejects(handle.wait(),{code:'NOT_FINALIZED'});
});

test('multi-step dispatch observes parent after acknowledgment and uses each step sequence',async t=>{
  const {payments,control}=setup(t,{steps:2});
  const recovered=await payments.recover();assert.equal(recovered.deferredOperations,1);
  const state=await payments.broadcast({operationId:operationId(1)});
  assert.deepEqual(control.order,[0,1]);
  assert.deepEqual(state.steps.map(step=>step.attempts.length),[1,1]);
  assert.equal(state.steps[0].observation.state,'mempool');
});

test('inventory stops at its captured final sequence even when the page is full',async t=>{
  const {payments}=setup(t,{count:2});await payments.recover();
  const first=await payments.operations.list({limit:1});assert.ok(first.nextCursor);
  const last=await payments.operations.list({limit:1,cursor:first.nextCursor});
  assert.equal(last.items.length,1);assert.equal(last.nextCursor,null);
});

test('startup adopts retry limits locally before a timed-out network pass',async t=>{
  const {payments,control}=setup(t,{steps:2,online:true,retry:{mode:'previously-dispatched',maxAttempts:2,minIntervalMs:100}});
  control.stalled=true;
  const report=await payments.recover();
  assert.deepEqual(control.policies,[{maxAttempts:2,minIntervalMs:100}]);
  assert.equal(report.local,'complete');assert.equal(report.lastError.code,'TIMEOUT');
  assert.equal(control.dispatches,0);assert.equal(report.deferredOperations,1);
});

test('coherently mined steps are observed but not dispatched again',async t=>{
  const {payments,control}=setup(t,{steps:2});control.mined=true;
  await payments.recover();const state=await payments.broadcast({operationId:operationId(1)});
  assert.equal(control.dispatches,0);assert.ok(state.steps.every(step=>step.inclusion.confirmations===2));
});

test('broadcast serializes reconciliation through durable result and records cancellation as unknown',async t=>{
  const {payments,control,journal}=setup(t,{delayed:true});await payments.recover();
  const controller=new AbortController(),started=new Promise(resolve=>{control.started=resolve;});
  const first=payments.broadcast({operationId:operationId(1),signal:controller.signal});await started;
  await assert.rejects(payments.broadcast({operationId:operationId(1)}),{code:'STORAGE_BUSY'});
  assert.equal(journal[0].state.steps[0].attempts[0].outcome,'started');controller.abort();
  await assert.rejects(first,error=>error.code==='ABORTED'&&error.paymentState.steps[0].attempts[0].outcome==='unknown');
  assert.equal(control.finish,1);assert.equal(control.dispatches,1);assert.equal(journal[0].state.steps[0].attempts[0].outcome,'unknown');
});

test('wait checks coherent confirmations; one subscriber cancellation does not stop another',async t=>{
  const {payments,control}=setup(t);await payments.recover();const handle=await payments.operations.resume({operationId:operationId(1)});
  const a=new AbortController(),first=handle.wait({signal:a.signal}),second=handle.wait({confirmations:2,timeoutMs:1000});
  const rejected=assert.rejects(first,{code:'ABORTED'});await wait(15);a.abort();await rejected;control.mined=true;
  const result=await second;assert.equal(result.transactions[0].confirmations,2);assert.equal(result.snapshot.operationId,operationId(1));
});

test('event overflow is explicit and return releases owned buffers',async t=>{
  const {payments,budget}=setup(t,{buffer:1});await payments.recover();const handle=await payments.operations.resume({operationId:operationId(1)}),events=handle.events();
  assert.equal((await events.next()).done,false);await wait(30);await assert.rejects(events.next(),{code:'RESOURCE_LIMIT'});await events.return();assert.equal(budget.proving.bytes,0);
});

test('online timeout leaves complete local recovery and a rotating deferred inventory',async t=>{
  const {payments,control}=setup(t,{count:3,online:true});control.stalled=true;
  const result=await payments.recover();assert.equal(result.operations,3);assert.equal(result.observedOperations,0);assert.equal(result.deferredOperations,3);assert.equal(result.lastError.code,'TIMEOUT');assert.equal(control.position,'1');assert.equal(control.dispatches,0);
  assert.ok(await payments.operations.get({operationId:operationId(2)}));
});

test('close cancels a hung observer and leaves runtime closure to its owner',async t=>{
  const {payments,control}=setup(t);await payments.recover();control.stalled=true;
  const started=new Promise(resolve=>{control.started=resolve;}),handle=await payments.operations.resume({operationId:operationId(1)}),events=handle.events();
  const next=events.next();const rejected=assert.rejects(next,{code:'ABORTED'});await started;await payments.close();await rejected;await events.return();assert.equal(control.closed,0);
});

 test('close drains a wait stalled in its initial local read',async t=>{
  const {payments,control}=setup(t);await payments.recover();
  const handle=await payments.operations.resume({operationId:operationId(1)});
  let release,started;control.getGate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});control.started=started;
  const pending=handle.wait({timeoutMs:60000});const rejected=assert.rejects(pending,{code:'ABORTED'});
  await entered;let closed=false;const closing=payments.close().then(()=>{closed=true;});
  await wait(10);assert.equal(closed,false);release();await rejected;await closing;
  assert.equal(control.requests,0);
});

test('recovery retains native no-commit observation uncertainty but rejects storage failure',async t=>{
  // This tests native error classification, not a race against the 30 ms deadline fixture.
  const uncertain=setup(t,{online:true,recoveryTimeoutMs:1000});uncertain.control.observeError='RECOVERY_REQUIRED';
  const report=await uncertain.payments.recover();assert.equal(report.local,'complete');
  assert.equal(report.lastError.code,'RECOVERY_REQUIRED');assert.equal(report.deferredOperations,1);
  const broken=setup(t,{online:true,recoveryTimeoutMs:1000});broken.control.observeError='STORAGE_ERROR';
  await assert.rejects(broken.payments.recover(),{code:'STORAGE_ERROR'});
});

test('first observation retains owned source prior inclusion without old confirmations',async t=>{
  const {payments,control}=setup(t);await payments.recover();
  control.prior={height:18,blockHash:hash,confirmations:100};
  const handle=await payments.operations.resume({operationId:operationId(1)}),events=handle.events();
  const state=(await events.next()).value;control.prior.height=1;
  assert.deepEqual(state.steps[0].observation.priorInclusion,{height:18,blockHash:hash,confirmations:null});
  await events.return();
});

test('malformed provider prior hash is a protocol error',async t=>{
  const {payments,control}=setup(t);await payments.recover();control.prior={height:18,blockHash:'bad',confirmations:null};
  const handle=await payments.operations.resume({operationId:operationId(1)}),events=handle.events();
  await assert.rejects(events.next(),{code:'PROTOCOL_MISMATCH'});await events.return();
});

test('recovery pause stays asynchronous when the monotonic clock advances during setup',async t=>{
  let clock=0;t.mock.method(performance,'now',()=>clock+=2);
  const {payments}=setup(t,{count:2,finalized:false,light:false});
  const report=await payments.recover();
  assert.equal(report.local,'complete');assert.equal(report.operations,2);
});


test('short-deadline recovery rotates across fresh payment owners without refreshing work',async t=>{
  const {payments,journal,control,budget,wallet,options}=setup(t,{count:3,online:true});
  journal.forEach((row,index)=>{row.state.steps[0].txid=operationId(index+1);});
  control.stalled=true;control.visited=[];
  let owner=payments;
  for(let cycle=0;cycle<4;cycle++){
    if(cycle)owner=new WalletPayments(wallet,{},options);
    try{
      const report=await owner.recover();
      assert.equal(report.local,'complete');assert.equal(report.operations,3);
      assert.equal(report.observedOperations,0);assert.equal(report.deferredOperations,3);
      assert.equal(report.lastError.code,'TIMEOUT');
      assert.equal(control.position,String(cycle%3+1));
    }finally{await owner.close();}
    assert.equal(control.dispatches,0);assert.equal(budget.jobs,0);assert.equal(budget.bytes,0);
    const reads=control.reads;await wait(5);assert.equal(control.reads,reads,'no background recovery after return/close');
  }
  assert.deepEqual(control.visited,[operationId(1),operationId(2),operationId(3),operationId(1)]);
  assert.ok(journal.every(row=>row.state.steps[0].attempts.length===0));
});


test('recovery finishes observation and cursor writes when its network deadline expires during commit', async t => {
  const {payments, control, journal} = setup(t, {online: true});
  let release;
  control.observeGate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { control.observeStarted = resolve; });
  const recovering = payments.recover();
  await entered;
  await wait(50);
  assert.equal(control.position, '0');
  release();
  const report = await recovering;
  assert.equal(report.observedOperations, 1);
  assert.equal(report.lastError.code, 'TIMEOUT');
  assert.equal(control.position, '1');
  assert.equal(journal[0].state.steps[0].observation.state, 'notSeen');
  const observe = control.calls.indexOf('payment_observe');
  assert.deepEqual(control.calls.slice(observe), ['payment_observe', 'payment_recovery_position']);
});

test('recovery propagates uncertain observation commits and cursor storage failures', async t => {
  const uncertain = setup(t, {online: true});
  uncertain.control.observeError = 'RECOVERY_REQUIRED';
  uncertain.control.observeCommit = 'unknown';
  await assert.rejects(uncertain.payments.recover(), {code: 'RECOVERY_REQUIRED'});
  assert.equal(uncertain.control.position, '0');
  assert.ok(!uncertain.control.calls.includes('payment_recovery_position'));

  const broken = setup(t, {online: true});
  broken.control.positionError = 'STORAGE_ERROR';
  await assert.rejects(broken.payments.recover(), {code: 'STORAGE_ERROR'});
  assert.equal(broken.control.position, '0');
});

test('confirmation helper preserves payment timeout context and drains scanning', async t => {
  const { payments, control } = setup(t);
  await payments.recover();
  const pending = await payments.operations.resume({ operationId: operationId(1) });
  control.stalled = true;
  let scanClosed = false;
  const wallet = { async *watchSync({ signal }) {
    try {
      await new Promise((_, reject) => signal.addEventListener('abort', () => {
        reject(Object.assign(Error('Scan stopped'), { code: 'ABORTED' }));
      }, { once: true }));
    } finally { scanClosed = true; }
  } };
  await assert.rejects(waitForConfirmation(wallet, pending, { timeoutMs: 500 }), error => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.operationId, operationId(1));
    assert.equal(error.paymentState.operationId, operationId(1));
    return true;
  });
  assert.equal(scanClosed, true);
  assert.equal(control.dispatches, 0);
});
