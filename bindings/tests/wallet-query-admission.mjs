// Private representation/admission only; native tests query real scanned databases.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {copyBytes} from '../bytes.mjs';
let calls=0,received,result,after=()=>{};
const context=vm.createContext({Object,Array,Number,Uint8Array,TextDecoder,AbortSignal,TypeError,Error,Set,Reflect,JSON,BigInt});
const facade=new vm.SourceTextModule(fs.readFileSync(new URL('../views.mjs',import.meta.url),'utf8'),{context});
await facade.link(async name=>{
  const exports=name==='./wallet.mjs'?{initializeStorage:()=>{throw Error('unused');}}:name==='./bytes.mjs'?{copyBytes}:{query_call:(token,op,input)=>{calls++;received={token,op,input:JSON.parse(input)};after();return JSON.stringify(result);}};
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});
});
await facade.evaluate();
const owner={},views=facade.namespace.viewsForStorage({generation:1,instance:owner,run:fn=>fn(),binding(){}});
const call=(operation,args)=>views.call(1,owner,operation,args);
const id='00000000-0000-0000-0000-000000000001',txid='ab'.repeat(32);
result={items:[{balanceDelta:'-1',totalReceived:'2',totalSpent:'3',fee:null}],nextCursor:null};
const page=call('wallet_history',{accountId:id,limit:1});assert.equal(page.items[0].balanceDelta,-1n);assert.equal(page.items[0].fee,null);
assert.deepEqual(received,{token:1,op:'wallet_history',input:{accountId:id,limit:1}});
result={raw:'00ff',accounts:[],outputs:[{value:'7',memo:{kind:'binary',bytes:'01fe'}}]};
const detail=call('wallet_transaction',{txid});assert.deepEqual([...detail.raw],[0,255]);assert.equal(detail.outputs[0].value,7n);assert.deepEqual([...detail.outputs[0].memo.bytes],[1,254]);
result=null;assert.equal(call('wallet_transaction',{txid}),null);
let invoked=0;
for(const args of [{txid:'aa'},Object.defineProperty({},'txid',{get(){invoked++;return txid;}})]) {
  const before=calls;assert.throws(()=>call('wallet_transaction',args),error=>error.commit==='none');assert.equal(calls,before);
}
assert.equal(invoked,0);
for(const args of [{accountId:id,limit:201},{accountId:id,cursor:'a'.repeat(1025)}])assert.throws(()=>call('wallet_history',args),error=>error.commit==='none');
result={items:[{value:'9',lock:null,lockKnown:false,uneconomic:null,spendState:'unknown'}],nextCursor:null};
assert.equal(call('wallet_notes',{accountId:id,pool:'sapling',spendState:'unknown'}).items[0].value,9n);
assert.equal(call('wallet_utxos',{accountId:id}).items[0].lockKnown,false);
for(const args of [{accountId:id,locked:null},{accountId:id,uneconomic:0},{accountId:id,pool:'legacyOrchard'},{accountId:id,spendState:'available'}])assert.throws(()=>call('wallet_notes',args),error=>error.commit==='none');
const controller=new AbortController();result=null;after=()=>controller.abort();
assert.throws(()=>call('wallet_transaction',{txid,signal:controller.signal}),error=>error.message==='ABORTED'&&error.commit==='none');
console.log('private query dispatch, native representation and read cancellation passed');
