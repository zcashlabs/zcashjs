// Facade admission/receipts; native fixture tests actual construction and persistence.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {copyBytes} from '../bytes.mjs';
let calls=0,after=()=>{},beforeRun=()=>{},failure,missing=false,getArtifactId;
const nativeResult=()=>missing?'null':JSON.stringify({bytes:'0001feff',outputs:[{amount:'10000',memo:'00ff'},{amount:'5000',memo:null}],proofsComplete:false,authorizationComplete:false});
const context=vm.createContext({Object,Array,Number,Uint8Array,TextDecoder,AbortSignal,TypeError,Error,Set,Reflect,JSON,BigInt});
const facade=new vm.SourceTextModule(fs.readFileSync(new URL('../views.mjs',import.meta.url),'utf8'),{context});
await facade.link(async name=>{
  const exports=name==='./wallet.mjs'?{initializeStorage(){throw Error('unused');}}:name==='./bytes.mjs'?{copyBytes}:{pczt_build_call(g,op,input){
    calls++;assert.equal(g,1);assert.deepEqual(JSON.parse(input),op==='pczt_build'?request:{operationId:request.operationId,...(getArtifactId?{artifactId:getArtifactId}:{})});
    if(failure)throw failure;after();
    return nativeResult();
  },pczt_prove_call(g,operationId,artifactId,spend,output,maximum){
    calls++;assert.equal(g,1);assert.equal(operationId,request.operationId);assert.equal(artifactId,'04'.repeat(32));assert.equal(maximum,16);
    assert.equal(spend.byteLength,0);assert.equal(output.byteLength,0);if(failure)throw failure;after();return nativeResult();
  },pczt_finalize_call(g,operationId,artifactId,spend,output,maximum){
    calls++;assert.equal(g,1);assert.equal(operationId,request.operationId);assert.equal(artifactId,'04'.repeat(32));assert.equal(maximum,16);assert.equal(spend.length,0);assert.equal(output.length,0);if(failure)throw failure;after();return JSON.stringify({bytes:'0001',txid:'05'.repeat(32)});
  },finalized_get(g,operationId){calls++;assert.equal(operationId,request.operationId);return JSON.stringify({operationId,revision:'1',transactions:[{bytes:'0001',stepIndex:0,artifactId:null}]});
  },fused_send_call(g,operationId,proposalId,reviewCommitment,token,spend,output,maximum){
    calls++;assert.equal(g,1);assert.equal(operationId,request.operationId);assert.equal(proposalId,request.proposalId);assert.equal(reviewCommitment,request.reviewCommitment);assert.equal(token,7);assert.equal(spend.length,0);assert.equal(output.length,0);assert.equal(maximum,16);if(failure)throw failure;after();return JSON.stringify({transactions:[{bytes:'0001',artifactId:null},{bytes:'0203',artifactId:null}]});
  },payment_call(g,op,text){
    calls++;assert.equal(g,1);const input=JSON.parse(text);assert.equal(input.operationId,request.operationId);
    if(op==='payment_attempt_begin'){assert.equal(input.policy.minIntervalMs,100);assert.equal(input.maximum,2097152);}
    if(failure)throw failure;after();return op==='payment_attempt_begin'?JSON.stringify({attemptId:'06'.repeat(32),bytes:'0001',txid:'05'.repeat(32)}):JSON.stringify({state:{operationId:request.operationId},observationSequence:'1'});
  },pczt_import_call(g,operationId,bytes,maximum){
    calls++;assert.equal(g,1);assert.equal(operationId,request.operationId);assert.equal(maximum,16);
    assert.deepEqual(bytes,new Uint8Array([1,2]));if(failure)throw failure;after();return nativeResult();
  }};
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});
});
await facade.evaluate();
const storage={generation:1,instance:{},binding(){},run:fn=>{beforeRun();return fn();}};
const owner=facade.namespace.viewsForStorage(storage),call=(op,args)=>owner.call(1,storage.instance,op,args);
const request={operationId:'01'.repeat(32),proposalId:'02'.repeat(32),reviewCommitment:'03'.repeat(32)};
for(const args of [{...request,proposalId:'bad'},{...request,extra:true},{...request,get reviewCommitment(){throw Error('getter');}}]) {
  assert.throws(()=>call('pczt_build',args),{message:'INVALID_ARGUMENT',commit:'none'});
}
assert.equal(calls,0);
const value=call('pczt_build',request);
assert.deepEqual(value.bytes,new Uint8Array([0,1,254,255]));
assert.equal(value.outputs[0].amount,10000n);assert.deepEqual(value.outputs[0].memo,new Uint8Array([0,255]));
assert.equal(value.outputs[1].memo,null);
missing=true;assert.equal(call('pczt_get_artifact',{operationId:request.operationId}),null);missing=false;
failure='STALE_PROPOSAL';assert.throws(()=>call('pczt_build',request),{message:'STALE_PROPOSAL',commit:'none'});failure=undefined;
const controller=new AbortController();after=()=>controller.abort();
assert.throws(()=>call('pczt_build',{...request,signal:controller.signal}),{message:'ABORTED',commit:'committed'});
after=()=>{};assert.equal(call('pczt_build',request).outputs[0].amount,10000n);
console.log('PCZT build facade admission, byte conversion and commit receipts passed');

getArtifactId='04'.repeat(32);call('pczt_get_artifact',{operationId:request.operationId,artifactId:getArtifactId});getArtifactId=undefined;
for(const input of [{operationId:'bad',bytes:new Uint8Array([1]),maximum:16},{operationId:request.operationId,bytes:new Uint8Array(17),maximum:16},{operationId:request.operationId,bytes:new Uint8Array([1]),maximum:0}]) {
  const before=calls;assert.throws(()=>call('pczt_import',input),error=>error.commit==='none');assert.equal(calls,before);
}
const bytes=new Uint8Array([1,2]);beforeRun=()=>bytes.fill(99);
assert.deepEqual(call('pczt_import',{operationId:request.operationId,bytes,maximum:16}).bytes,new Uint8Array([0,1,254,255]));beforeRun=()=>{};
failure='INVALID_PCZT';assert.throws(()=>call('pczt_import',{operationId:request.operationId,bytes:new Uint8Array([1,2]),maximum:16}),{message:'INVALID_PCZT',commit:'none'});failure=undefined;
const importedAbort=new AbortController();after=()=>importedAbort.abort();
assert.throws(()=>call('pczt_import',{operationId:request.operationId,bytes:new Uint8Array([1,2]),maximum:16,signal:importedAbort.signal}),{message:'ABORTED',commit:'committed'});after=()=>{};
assert.equal(call('pczt_get_artifact',{operationId:request.operationId}).outputs[0].amount,10000n);
console.log('PCZT import owned bytes, maximum admission, retained lookup and commit receipts passed');

const proof={operationId:request.operationId,artifactId:'04'.repeat(32),spend:new Uint8Array(),output:new Uint8Array(),maximum:16};
for(const input of [{...proof,artifactId:undefined},{...proof,spend:new Uint8Array(1)},{...proof,maximum:0},{...proof,get output(){throw Error('getter');}}]) {
  const before=calls;assert.throws(()=>call('pczt_prove',input),error=>error.commit==='none');assert.equal(calls,before);
}
assert.equal(call('pczt_prove',proof).outputs[0].amount,10000n);
failure='ROLE_PRECONDITION';assert.throws(()=>call('pczt_prove',proof),{message:'ROLE_PRECONDITION',commit:'none'});failure=undefined;
const proofAbort=new AbortController();after=()=>proofAbort.abort();
assert.throws(()=>call('pczt_prove',{...proof,signal:proofAbort.signal}),{message:'ABORTED',commit:'committed'});after=()=>{};
assert.equal(call('pczt_prove',proof).outputs[0].amount,10000n);
console.log('PCZT prove asset admission, exact artifact binding and commit receipts passed');

assert.deepEqual(call('pczt_finalize',proof).bytes,new Uint8Array([0,1]));
assert.deepEqual(call('finalized_get',{operationId:request.operationId}).transactions[0].bytes,new Uint8Array([0,1]));
const finalAbort=new AbortController();after=()=>finalAbort.abort();
assert.throws(()=>call('pczt_finalize',{...proof,signal:finalAbort.signal}),{message:'ABORTED',commit:'committed'});after=()=>{};
const attempt={operationId:request.operationId,stepIndex:0,sourceId:'fixture',mode:'automatic',routeBinding:'07'.repeat(32),wallTimeMs:1000,monotonicElapsedMs:100,observationSequence:'1',policy:{maxAttempts:1,minIntervalMs:100},maximum:2097152};
const attemptPolicy=attempt.policy;beforeRun=()=>{attemptPolicy.minIntervalMs=999;};
assert.deepEqual(call('payment_attempt_begin',attempt).bytes,new Uint8Array([0,1]));beforeRun=()=>{};attemptPolicy.minIntervalMs=100;
for(const args of [{...attempt,maximum:0},{...attempt,maximum:2097153},{...attempt,policy:{get minIntervalMs(){throw Error('getter');},maxAttempts:1}}]){
  const before=calls;assert.throws(()=>call('payment_attempt_begin',args),error=>error.commit==='none');assert.equal(calls,before);
}
failure='RECOVERY_REQUIRED';assert.throws(()=>call('payment_attempt_begin',attempt),{message:'RECOVERY_REQUIRED',commit:'none'});failure=undefined;
const startAbort=new AbortController();after=()=>startAbort.abort();
assert.throws(()=>call('payment_attempt_begin',{...attempt,signal:startAbort.signal}),{message:'ABORTED',commit:'committed'});after=()=>{};
assert.equal(call('payment_get',{operationId:request.operationId}).observationSequence,'1');
console.log('Finalization and submission facade owned metadata, exact binary routes, bounds and commit receipts passed');

const fused={...request,token:7,spend:new Uint8Array(),output:new Uint8Array(),maximum:16};
assert.deepEqual(call('fused_send',fused).transactions.map(t=>t.bytes),[new Uint8Array([0,1]),new Uint8Array([2,3])]);
for(const token of [-1,0x100000000,1.5]){const before=calls;assert.throws(()=>call('fused_send',{...fused,token}),{message:'INVALID_ARGUMENT',commit:'none'});assert.equal(calls,before);}
failure='STALE_HANDLE';assert.throws(()=>call('fused_send',fused),{message:'STALE_HANDLE',commit:'none'});failure=undefined;
const fusedAbort=new AbortController();after=()=>fusedAbort.abort();assert.throws(()=>call('fused_send',{...fused,signal:fusedAbort.signal}),{message:'ABORTED',commit:'committed'});after=()=>{};
call('payment_reconcile',{operationId:request.operationId,wallTimeMs:1000,policy:{maxAttempts:1,minIntervalMs:100}});
console.log('Fused multi-step owned result, authority token admission, and committed cancellation passed');
const abandonAbort=new AbortController();after=()=>abandonAbort.abort();
assert.throws(()=>call('payment_abandon',{operationId:request.operationId,signal:abandonAbort.signal}),{message:'ABORTED',commit:'committed'});after=()=>{};
assert.equal(call('payment_abandon',{operationId:request.operationId}).state.operationId,request.operationId);
