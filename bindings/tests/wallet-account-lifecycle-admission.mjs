// Existing VM facade seam; actual key comparison/deletion is tested by native fixtures.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {copyBytes} from '../bytes.mjs';
let called=0,fail=false,after=()=>{};
const context=vm.createContext({Object,Array,Number,Uint8Array,TextDecoder,AbortSignal,TypeError,Error,Set,Reflect,JSON,BigInt});
const facade=new vm.SourceTextModule(fs.readFileSync(new URL('../views.mjs',import.meta.url),'utf8'),{context});
await facade.link(async name=>{
  const exports=name==='./wallet.mjs'?{initializeStorage(){throw Error('unused');}}:name==='./bytes.mjs'?{copyBytes}:{account_lifecycle_call(g,op,input){called++;if(fail)throw 'INPUT_LOCKED';after();return op==='account_remove'?'null':op==='account_viewing_key'?'"ufvk-canonical"':'"ready"';}};
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context});
});
await facade.evaluate();const storage={generation:1,instance:{},binding(){},run:fn=>fn()};
const owner=facade.namespace.viewsForStorage(storage),call=(op,args)=>owner.call(1,storage.instance,op,args);
assert.equal(call('account_viewing_key',{accountId:'account'}),'ufvk-canonical');
assert.equal(call('account_check_key',{accountId:'account',viewingKey:'native'}),'ready');
assert.throws(()=>call('account_remove',{accountId:'account',get acknowledge(){throw Error('getter');}}),{message:'INVALID_ARGUMENT',commit:'none'});
assert.equal(called,2);fail=true;
assert.throws(()=>call('account_remove',{accountId:'account',acknowledge:'deletes-local-history'}),{message:'INPUT_LOCKED',commit:'none'});
fail=false;const controller=new AbortController();after=()=>controller.abort();
assert.throws(()=>call('account_remove',{accountId:'account',acknowledge:'deletes-local-history',signal:controller.signal}),{message:'ABORTED',commit:'committed'});
after=()=>{};assert.equal(call('account_check_key',{accountId:'other',viewingKey:'native'}),'ready');
console.log('account lifecycle facade admission/receipts passed');
