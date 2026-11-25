// Intent ownership/freshness admission only; selection and idempotency are native qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {walletPropose} from '../../dist/src/wallet/propose-intent.js';
const policy=()=>({spendPools:['sapling'],transparent:'disallow',changePool:'sapling',feeRule:'zip317-standard',confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},expiry:{kind:'offset',blocks:40},lockExpiryBlocks:20,shieldingThreshold:100000n,freshness:{mode:'require-synced',maxLagBlocks:0}});
const status=()=>({scan:{revision:'epoch:1',tipHeight:100,fullyScannedHeight:100,scanComplete:true},target:{height:100},enhancement:{actionable:0,delayed:0}});
const input=()=>({accountId:'account',to:'recipient',amount:1000n,memo:{text:'memo'},idempotencyKey:'one'});
test('intent and policy are captured before awaited freshness and single payment normalized',async()=>{
  let finish,received;const configured=policy();
  const propose=walletPropose({lookup:async()=>null,create:async value=>(received=value)}, {getSyncStatus:async()=>new Promise(resolve=>finish=resolve),sync:async()=>{throw Error('unexpected sync');}},configured);
  const args=input(),pending=propose(args);args.memo.text='changed';configured.spendPools[0]='ironwood';configured.expiry.blocks=1;while(!finish)await new Promise(resolve=>setImmediate(resolve));finish(status());
  await pending;assert.equal(received.revision,'epoch:1');assert.deepEqual(received.policy.spendPools,['sapling']);assert.equal(received.policy.expiry.blocks,40);
  assert.equal(received.idempotencyKey,'one');assert.equal(new TextDecoder().decode(received.payments[0].memo),'memo');assert.equal(received.payments[0].amount,1000n);
});
test('shield defaults are explicit configured native inputs and byte memos are owned',async()=>{
  const received=[],propose=walletPropose({lookup:async()=>null,create:async args=>received.push(args)},{getSyncStatus:async()=>status(),sync:async()=>status()},policy());
  await propose({kind:'shield',accountId:'account',fromAddresses:[]});
  assert.equal(received[0].threshold,100000n);assert.equal(received[0].policy.changePool,'sapling');assert.deepEqual(received[0].fromAddresses,[]);
  const bytes=new Uint8Array([0,255]),pending=propose({accountId:'account',payments:[{to:'recipient',amount:1n,memo:{bytes}}]});bytes.fill(8);await pending;
  assert.deepEqual([...received[1].payments[0].memo],[0,255]);
});
test('freshness rejects unresolved work and catch-up has a finite deadline without selection',async()=>{
  let creates=0,syncs=0;const native={lookup:async()=>null,create:async()=>{creates++;}},stale={...status(),enhancement:{actionable:1,delayed:0}};
  await assert.rejects(walletPropose(native,{getSyncStatus:async()=>stale,sync:async()=>{syncs++;}},policy())(input()),{code:'SYNC_REQUIRED'});
  const catchup={...policy(),freshness:{mode:'catch-up',maxLagBlocks:0,timeoutMs:10}};
  await assert.rejects(walletPropose(native,{getSyncStatus:async()=>stale,sync:async()=>{syncs++;return new Promise(()=>{});}},catchup)(input()),{code:'TIMEOUT'});
  assert.equal(creates,0);assert.equal(syncs,1);
  await walletPropose(native,{getSyncStatus:async()=>stale,sync:async()=>status()},catchup)(input());assert.equal(creates,1);
});
test('invalid unions, getters, oversized memos and cancellation do not query or mutate wallet',async()=>{
  let calls=0;const propose=walletPropose({lookup:async()=>null,create:async()=>{calls++;}},{getSyncStatus:async()=>{calls++;return status();},sync:async()=>status()},policy());
  for(const args of [{...input(),payments:[]},{...input(),memo:{text:'a',bytes:new Uint8Array()}},{...input(),memo:{bytes:new Uint8Array(513)}},{...input(),get amount(){throw Error('getter');}}])await assert.rejects(propose(args),error=>['INVALID_ARGUMENT','RESOURCE_LIMIT'].includes(error.code));
  await assert.rejects(propose({...input(),signal:AbortSignal.abort()}),{code:'ABORTED'});assert.equal(calls,0);
});

test('idempotent native lookup precedes stale freshness without selecting again',async()=>{
  const retained={operationId:'existing'},propose=walletPropose({lookup:async()=>retained,create:async()=>{throw Error('must not select');}},{getSyncStatus:async()=>{throw Error('must not gate retained work');},sync:async()=>{throw Error('must not sync');}},policy());
  assert.equal(await propose(input()),retained);
  assert.throws(()=>walletPropose({}, {},{...policy(),freshness:{mode:'catch-up',maxLagBlocks:0,timeoutMs:0x80000000}}),{code:'INVALID_ARGUMENT'});
});

test('catch-up repeats sync passes while they progress, then reports SYNC_REQUIRED (#35)',async()=>{
  const catchup={...policy(),freshness:{mode:'catch-up',maxLagBlocks:0,timeoutMs:10_000}};
  const pending=n=>({...status(),scan:{...status().scan,revision:`epoch:${n}`},enhancement:{actionable:1,delayed:0}});
  let creates=0,syncs=0,received;const native={lookup:async()=>null,create:async value=>{creates++;received=value;}};
  // First pass reaches the target with enhancement outstanding; the second finishes it.
  const passes=[pending(2),{...status(),scan:{...status().scan,revision:'epoch:3'}}];
  await walletPropose(native,{getSyncStatus:async()=>pending(1),sync:async()=>passes[syncs++]},catchup)(input());
  assert.equal(syncs,2);assert.equal(creates,1);assert.equal(received.revision,'epoch:3');
  // A pass that changes nothing ends catch-up instead of spinning until the deadline.
  syncs=0;
  await assert.rejects(walletPropose(native,{getSyncStatus:async()=>pending(1),sync:async()=>{syncs++;return pending(2);}},catchup)(input()),{code:'SYNC_REQUIRED'});
  assert.equal(syncs,2);
  // Progress is bounded by a fixed number of rounds.
  syncs=0;
  await assert.rejects(walletPropose(native,{getSyncStatus:async()=>pending(0),sync:async()=>pending(++syncs)},catchup)(input()),{code:'SYNC_REQUIRED'});
  assert.equal(syncs,8);assert.equal(creates,1);
});
