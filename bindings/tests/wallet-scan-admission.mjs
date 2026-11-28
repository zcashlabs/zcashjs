// Facade admission/dispatch only. Native scan correctness uses the real wallet tests.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {copyBytes} from '../bytes.mjs';
let calls=0, received, afterCall=()=>{};
const context=vm.createContext({Object,Array,Number,Uint8Array,TextDecoder,AbortSignal,TypeError,Error,Set,Reflect,JSON,BigInt});
const facade=new vm.SourceTextModule(fs.readFileSync(new URL('../views.mjs',import.meta.url),'utf8'),{context});
await facade.link(async name=>{
  const dispatch=route=>(token,operation,input)=>{calls++;received={token,operation,input:JSON.parse(input)};assert.equal(route,operation.startsWith('enhancement_')?'enhancement': ['scan_state','scan_block_hash','scan_rewind','scan_complete'].includes(operation)?'sync':'scan');afterCall();return '{"revision":"native:1"}';};
  const exports=name==='./wallet.mjs'?{initializeStorage:()=>{throw Error('unused');}}:name==='./bytes.mjs'?{copyBytes}:{scan_call:dispatch('scan'),sync_call:dispatch('sync'),enhancement_call:dispatch('enhancement'),views_call:()=>{throw Error('wrong dispatch');}};
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value);},{context});
});
await facade.evaluate();
const owner={},storage={generation:1,instance:owner,run:fn=>fn(),binding:(token,instance)=>{assert.equal(token,1);assert.equal(instance,owner);}};
const views=facade.namespace.viewsForStorage(storage);
const target={height:7,hash:'03'.repeat(32)};
const call=(operation,args)=>views.call(1,owner,operation,args);
assert.equal(call('scan_plan',{target}).revision,'native:1');
assert.deepEqual(received,{token:1,operation:'scan_plan',input:{target:{height:7,hash:'03'.repeat(32)}}});
const batch={target,revision:'native:1',priorTreeState:new Uint8Array([0,255]),blocks:[new Uint8Array([1,2])]};
call('scan_ingest_batch',batch);
assert.deepEqual(received.input.blocks,['0102']);assert.equal(received.input.priorTreeState,'00ff');
call('scan_ingest_batch',{...batch,blocks:[new Uint8Array(2*1024*1024).fill(0xaf)]});
assert.equal(received.input.blocks[0].length,4*1024*1024);
assert.equal(received.input.blocks[0],'af'.repeat(2*1024*1024));
const shared=new Uint8Array(new SharedArrayBuffer(1));
const detached=new Uint8Array(1);structuredClone(detached.buffer,{transfer:[detached.buffer]});
const accessor=[];Object.defineProperty(accessor,'0',{get(){throw Error('getter must not run');}});
for(const blocks of [[],Array(17).fill(new Uint8Array(1)),Array(1),accessor,[shared],[detached],[new Uint8Array(1048577),new Uint8Array(1048576)]]) {
  const before=calls;assert.throws(()=>call('scan_ingest_batch',{...batch,blocks}),e=>/INVALID_ARGUMENT|RESOURCE_LIMIT/.test(e.message)&&e.commit==='none');assert.equal(calls,before);
}
for(const args of [{target:{...target,hash:new Uint8Array(31)}},{target:{...target,height:0xffffffff}},{target,blocks:[]},{get target(){throw Error('getter must not run');}}])assert.throws(()=>call('scan_plan',args),/INVALID_ARGUMENT/);
assert.throws(()=>call('account_list',{target}),/INVALID_ARGUMENT/);
const rewind={revision:'native:1',requestedPoint:target};
const completion={revision:'native:1',target,treeState:new Uint8Array([0,255])};
call('scan_complete',completion);assert.equal(received.input.treeState,'00ff');
for(const [operation,input] of [['scan_state',{}],['scan_block_hash',{height:0xffffffff}],['scan_rewind',rewind],['enhancement_requests',{}]]) {
  call(operation,input);assert.deepEqual(received.input,input);
}
const enhancement={revision:'native:1',request:{kind:'enhancement',txid:'01'.repeat(32)},result:{transactions:[{bytes:new Uint8Array([0,255]),minedHeight:7}]}};
call('enhancement_apply',enhancement);
assert.deepEqual(received.input.result,{transactions:[{bytes:'00ff',minedHeight:7}]});
for(const complete of [false,true])call('enhancement_apply',{...enhancement,request:{kind:'address',address:'synthetic',start:1,endExclusive:8,requestAt:null,txStatus:'mined',outputStatus:'all'},result:{transactions:[],asOfHeight:7,complete}});
call('enhancement_apply',{...enhancement,result:{status:'notRecognized'}});
for(const [operation,input] of [['scan_state',{height:0}],['scan_block_hash',{height:-1}],['scan_rewind',{...rewind,requestedPoint:{...target,hash:'bad'}}],
  ['enhancement_apply',{...enhancement,result:{transactions:[{bytes:shared,minedHeight:7}]}}],
  ['enhancement_apply',{...enhancement,result:{transactions:[{bytes:new Uint8Array(2097153),minedHeight:7}]}}],
  ['enhancement_apply',{...enhancement,result:{transactions:[{get bytes(){throw Error('getter must not run');},minedHeight:7}]}}],
  ['enhancement_apply',{...enhancement,result:{status:'notRecognized',height:7}}]]) {
  const before=calls;assert.throws(()=>call(operation,input),e=>/INVALID_ARGUMENT|RESOURCE_LIMIT/.test(e.message)&&e.commit==='none');assert.equal(calls,before);
}
afterCall=()=>{throw 'STALE_REVISION';};
assert.throws(()=>call('scan_ingest_batch',batch),e=>e.message==='STALE_REVISION'&&e.commit==='none');
assert.throws(()=>call('scan_rewind',rewind),e=>e.message==='STALE_REVISION'&&e.commit==='none');
assert.throws(()=>call('enhancement_apply',enhancement),e=>e.message==='STALE_REVISION'&&e.commit==='none');
afterCall=()=>{};
assert.equal(call('scan_plan',{target}).revision,'native:1','native rejection leaves owner reusable');
const before=calls, controller=new AbortController();controller.abort();
assert.throws(()=>call('scan_plan',{target,signal:controller.signal}),e=>e.message==='ABORTED'&&e.commit==='none');assert.equal(calls,before);
for(const [operation,input] of [['scan_plan',{target}],['scan_ingest_batch',batch],['scan_rewind',rewind],['scan_complete',completion],['enhancement_apply',enhancement]]) {
  const controller=new AbortController();afterCall=()=>controller.abort();
  assert.throws(()=>call(operation,{...input,signal:controller.signal}),e=>e.message==='ABORTED'&&e.commit==='committed');
}
for(const [operation,input] of [['scan_state',{}],['scan_block_hash',{height:7}],['enhancement_requests',{}]]) {
  const controller=new AbortController();afterCall=()=>controller.abort();
  assert.throws(()=>call(operation,{...input,signal:controller.signal}),e=>e.message==='ABORTED'&&e.commit==='none');
}
afterCall=()=>{};

const unspent={...enhancement,request:{kind:'address',address:'synthetic',start:0,endExclusive:null,requestAt:null,txStatus:'all',outputStatus:'unspent'},result:{transactions:[{txid:'04'.repeat(32),bytes:new Uint8Array([1,2]),minedHeight:null,unspentOutputs:[{outputIndex:1,script:new Uint8Array([0x51]),value:42n}]}],asOfHeight:7,asOfHash:'03'.repeat(32),complete:true}};
call('enhancement_apply',unspent);assert.deepEqual(received.input.result.transactions[0],{txid:'04'.repeat(32),bytes:'0102',minedHeight:null,unspentOutputs:[{outputIndex:1,script:'51',value:'42'}]});
for(const output of [{outputIndex:0,get script(){throw Error('getter');},value:1n},{outputIndex:0,script:new Uint8Array(10001),value:1n}]){const before=calls;assert.throws(()=>call('enhancement_apply',{...unspent,result:{...unspent.result,transactions:[{...unspent.result.transactions[0],unspentOutputs:[output]}]}}),e=>e.commit==='none');assert.equal(calls,before);}
console.log('Positive unspent outputs retain owned script/value admission');

afterCall=()=>{throw new WebAssembly.RuntimeError('trap');};
assert.throws(()=>call('scan_plan',{target}),e=>e.message==='DOMAIN_INVALID'&&e.commit===undefined);
afterCall=()=>{};
assert.throws(()=>call('scan_plan',{target}),e=>e.message==='DOMAIN_INVALID'&&e.commit===undefined);
console.log('PASS: bounded scan admission, exact byte lowering, native dispatch and cancellation receipts');
