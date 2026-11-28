// Actual shared module, two direct compute workers, upstream scanning and FS reopen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {initialize} from './wallet-support.mjs';
const hex=s=>Uint8Array.from(s.match(/../g)??[],b=>parseInt(b,16));
const plain=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x));
if (!isMainThread) {
  const {bundle,role,root,create}=workerData;
  const facade=await import(pathToFileURL(`${bundle}/wallet.mjs`));
  if(role==='compute') {
    parentPort.once('message',({module,memory,index})=>facade.enterThreaded(module,memory,index,()=>parentPort.postMessage({loaded:true})));
  } else {
    const prepared=facade.prepareThreaded(new Uint8Array(fs.readFileSync(`${bundle}/bindings_bg.wasm`)),2);
    parentPort.once('message',()=>{
      try {
        const runtime=facade.finishThreaded();
        Promise.all([import(pathToFileURL(`${bundle}/wallet-host/node-fs.mjs`)),import(pathToFileURL(`${bundle}/views.mjs`))]).then(([{acquire},{viewsForStorage}])=>{
          try {
            const network=initialize(), fixture=JSON.parse(fs.readFileSync(`${bundle}/tests/views-fixture.json`)).scan;
            const storage=runtime.open(acquire(root,{create}),network.format,network.parameters,network.genesis);
            const owner=viewsForStorage(storage),call=(op,args={})=>owner.call(owner.generation,owner.instance,op,args);
            let account;
            if(create) {
              account=call('account_import',fixture.import);
              let state=call('scan_plan',{target:fixture.target});
              for(const batch of fixture.batches) state=call('scan_ingest_batch',{revision:state.revision,target:fixture.target,priorTreeState:hex(batch.priorTreeState),blocks:batch.blocks.map(hex)});
            } else {const accounts=call('account_list');assert.equal(accounts.length,1);account=accounts[0];}
            const result=call('account_balance',{accountId:account.id,confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:true}});
            assert.deepEqual(plain(result.amounts),fixture.expectedAmounts);
            assert.equal(result.scan.fullyScannedHeight,fixture.expectedScan.fullyScannedHeight);
            owner.close(owner.generation,owner.instance);
            parentPort.postMessage({pass:true,result:plain(result)});
          } catch(error) {parentPort.postMessage({error:String(error),stack:error?.stack});}
        }).catch(error=>parentPort.postMessage({error:String(error)}));
      } catch(error) {parentPort.postMessage({error:String(error),stack:error?.stack});}
    });
    parentPort.postMessage(prepared);
  }
} else {
  const bundle=process.argv[2],root=fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/threaded-node-`);
  let destroyed=0,first;
  try {
    for(const create of [true,false]) {
      const workers=[];
      const spawn=role=>{const w=new Worker(new URL(import.meta.url),{workerData:{bundle,role,root,create},trackUnmanagedFds:true});w.on('error',()=>{});workers.push(w);return w;};
      const next=w=>new Promise((resolve,reject)=>{
        const done=(error,value)=>{clearTimeout(timer);w.off('message',message);w.off('error',failed);w.off('exit',exited);error?reject(error):resolve(value);};
        const message=v=>done(v.error?Error(v.error):null,v),failed=e=>done(e),exited=n=>done(Error(`unexpected worker exit ${n}`));
        const timer=setTimeout(()=>done(Error('threaded fixture deadline')),45000);
        w.once('message',message);w.once('error',failed);w.once('exit',exited);
      });
      try {
        const owner=spawn('owner'),prepared=await next(owner);
        assert.ok(prepared.module instanceof WebAssembly.Module);
        assert.ok(prepared.memory.buffer instanceof SharedArrayBuffer);
        await Promise.all([0,1].map(async index=>{const compute=spawn('compute'),loaded=next(compute);compute.postMessage({...prepared,index});assert.deepEqual(await loaded,{loaded:true});}));
        const finished=next(owner);owner.postMessage({build:true});const result=await finished;
        assert.equal(result.pass,true);
        if(create) first=result.result;
        else {
          assert.notEqual(result.result.scan.revision,first.scan.revision,'fresh owner has a new revision epoch');
          assert.deepEqual({...result.result,scan:{...result.result.scan,revision:first.scan.revision}},first,'exact persisted scan/balance after fresh shared owner');
        }
      } finally {
        const stopped=await Promise.allSettled(workers.map(async w=>{await w.terminate();destroyed++;}));
        const failure=stopped.find(result=>result.status==='rejected');if(failure)throw failure.reason;
      }
    }
    assert.equal(destroyed,6);
    console.log(JSON.stringify({pass:true,computeWorkersPerOwner:2,destroyed,scanAndReopen:true}));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
