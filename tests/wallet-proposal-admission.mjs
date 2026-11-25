// Private DTO ownership/receipt boundary; native selection uses wallet-proposal.mjs.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {copyBytes} from '../bytes.mjs';
let received,calls=0,after=()=>{};
const context=vm.createContext({Object,Array,Number,Uint8Array,TextDecoder,AbortSignal,TypeError,Error,Set,Reflect,JSON,BigInt});
const facade=new vm.SourceTextModule(fs.readFileSync(new URL('../views.mjs',import.meta.url),'utf8'),{context});
await facade.link(async name=>{
  const exports=name==='./wallet.mjs'?{initializeStorage:()=>{throw Error('unused');}}:name==='./bytes.mjs'?{copyBytes}:{proposal_call:(g,op,input)=>{calls++;received=JSON.parse(input);after();return op==='proposal_list'?'{"highWater":"1","items":[]}':op==='proposal_get'?'null':op==='payment_request_parse'?'{"payments":[{"index":"0","address":"synthetic","amount":null,"memo":"00ff","label":null,"message":null},{"index":"1","address":"synthetic","amount":"10","memo":null,"label":null,"message":null}]}':'{"totalFee":"10000","steps":[{"fee":"10000","inputs":[{"value":"20000"}],"outputs":[{"amount":"10000","memo":"00ff"}]}]}';}};
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context});
});
await facade.evaluate();
const storage={generation:1,instance:{},binding:()=>{},run:fn=>fn()};
const owner=facade.namespace.viewsForStorage(storage);
const call=(op,args)=>owner.call(1,storage.instance,op,args);
const input={revision:'native:1',accountId:'a'.repeat(36),payments:[{to:'synthetic',amount:10n,memo:new Uint8Array([0,255])}],policy:{spendPools:['sapling'],transparent:'disallow',changePool:'sapling',feeRule:'zip317-standard',confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},expiry:{kind:'offset',blocks:40},lockExpiryBlocks:20}};
const result=call('proposal_create',input);
assert.equal(received.payments[0].amount,'10');assert.equal(received.payments[0].memo,'00ff');assert.equal(result.totalFee,10000n);assert.deepEqual([...result.steps[0].outputs[0].memo],[0,255]);
call('proposal_create',{...input,payments:'zcash:synthetic?amount=0.0001'});assert.equal(received.payments,'zcash:synthetic?amount=0.0001');
assert.throws(()=>call('proposal_create',{...input,payments:'z'.repeat(8193)}),e=>e.commit==='none');
const parsed=call('payment_request_parse',{uri:'zcash:synthetic'});assert.deepEqual(received,{uri:'zcash:synthetic'});
assert.equal(parsed.payments[0].amount,null);assert.deepEqual([...parsed.payments[0].memo],[0,255]);assert.equal(parsed.payments[1].amount,10n);
call('proposal_create',{...input,payments:'zcash:synthetic',amounts:{0:5n}});assert.deepEqual({...received.amounts},{0:'5'});
for(const change of [{amounts:{0:5n}},{payments:'zcash:synthetic',amounts:{'00':5n}},{payments:'zcash:synthetic',amounts:{0:5}}]) {
  const before=calls;assert.throws(()=>call('proposal_create',{...input,...change}),e=>e.commit==='none');assert.equal(calls,before);
}
assert.equal(call('proposal_get',{operationId:'ab'.repeat(32)}),null);
assert.equal(call('proposal_list',{afterSequence:'0',limit:1}).highWater,'1');
for(const payments of [[],Array(17),[{get to(){throw Error('getter');},amount:1n}]]) {
  const before=calls;assert.throws(()=>call('proposal_create',{...input,payments}),e=>e.commit==='none');assert.equal(calls,before);
}
call('proposal_create',{...input,payments:new Proxy(input.payments,{get(target,key){if(key==='length')throw Error('length getter');return Reflect.get(target,key);}})});
const shield={...input,kind:'shield',threshold:20n,fromAddresses:[],idempotencyKey:'shield-1'};delete shield.payments;
call('proposal_create',shield);assert.equal(received.threshold,'20');assert.equal(received.idempotencyKey,'shield-1');assert.deepEqual(received.fromAddresses,[]);
for(const change of [{payments:input.payments},{amounts:{0:1n}},{threshold:20},{idempotencyKey:''}]) {
  const before=calls;assert.throws(()=>call('proposal_create',{...shield,...change}),e=>e.commit==='none');assert.equal(calls,before);
}
after=()=>{throw 'STALE_REVISION';};assert.throws(()=>call('proposal_create',input),e=>e.message==='STALE_REVISION'&&e.commit==='none');
const controller=new AbortController();after=()=>controller.abort();assert.throws(()=>call('proposal_create',{...input,signal:controller.signal}),e=>e.message==='ABORTED'&&e.commit==='committed');
after=()=>{throw new WebAssembly.RuntimeError('trap');};assert.throws(()=>call('proposal_list',{afterSequence:'0',limit:1}),e=>e.message==='DOMAIN_INVALID'&&e.commit===undefined);
console.log(JSON.stringify({pass:true,proposalAdmission:true,receipts:true}));
