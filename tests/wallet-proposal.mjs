import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { Worker,isMainThread,parentPort,workerData } from 'node:worker_threads';
if(isMainThread) {
  const worker=new Worker(new URL(import.meta.url),{workerData:{bundle:process.argv[2]}});
  try {const [result]=await once(worker,'message',{signal:AbortSignal.timeout(120000)});assert.equal(result.pass,true);console.log(JSON.stringify(result));}
  finally {await worker.terminate();}
} else {
  const bundle=pathToFileURL(`${workerData.bundle}/`);
  const {initializeWalletRuntime}=await import(new URL('wallet.mjs',bundle));
  const {viewsForStorage}=await import(new URL('views.mjs',bundle));
  const {acquire}=await import(new URL('wallet-host/node-fs.mjs',bundle));
  const fixture=JSON.parse(fs.readFileSync(new URL('tests/views-fixture.json',bundle)));
  const parameters=new Uint8Array(Buffer.from(fixture.import.birthday.parameters,'hex'));
  const genesis=new Uint8Array(Buffer.from(fixture.import.birthday.genesis,'hex'));
  const runtime=initializeWalletRuntime(fs.readFileSync(new URL('bindings_bg.wasm',bundle)));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-wallet-proposal-'));
  const paths=['one','two'].map(name=>{const p=path.join(root,name);fs.mkdirSync(p,{mode:0o700});return p;});
  const open=(i,create)=>viewsForStorage(runtime.open(acquire(paths[i],{create}),'zcash-js-network/1',parameters,genesis));
  const call=(owner,operation,args={},mnemonic)=>owner.call(owner.generation,owner.instance,operation,args,undefined,mnemonic);
  const first=open(0,true),second=open(1,true);
  const close=owner=>owner.close(owner.generation,owner.instance);
  let reopened;
  try {
    const scan=fixture.scan;
    const account=call(first,'account_import',scan.import);
    let revision=call(first,'scan_plan',{target:scan.target}).revision;
    for(const batch of scan.batches)revision=call(first,'scan_ingest_batch',{...batch,target:scan.target,revision,priorTreeState:new Uint8Array(Buffer.from(batch.priorTreeState,'hex')),blocks:batch.blocks.map(hex=>new Uint8Array(Buffer.from(hex,'hex')))}).revision;
    const address=call(first,'address_next',{accountId:account.id,request:{format:'transparent'}});
    revision=call(first,'scan_state').revision;
    const input={revision,accountId:account.id,payments:[{to:address.address,amount:10000n}],policy:{spendPools:['sapling'],transparent:'disallow',changePool:'sapling',feeRule:'zip317-standard',confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},expiry:{kind:'offset',blocks:40},lockExpiryBlocks:20}};
    assert.throws(()=>call(first,'proposal_create',{...input,maxFee:1n}),e=>e.message==='FEE_LIMIT_EXCEEDED'&&e.commit==='none');
    assert.deepEqual(call(first,'proposal_list',{afterSequence:'0',limit:200}).items,[]);
    assert.equal(call(first,'scan_state').revision,revision);
    const plan=call(first,'proposal_create',{...input,payments:`zcash:${address.address}?amount=0.0001&label=Coffee`});
    assert.equal(plan.targetHeight,101);assert.equal(plan.steps[0].outputs[0].address,address.address);
    assert.equal(plan.steps[0].outputs[0].label,'Coffee');assert.equal(plan.steps[0].outputs[0].message,null);
    assert.equal(plan.steps[0].outputs[1].address,null);assert.equal(typeof plan.totalFee,'bigint');
    assert.throws(()=>call(first,'proposal_create',{...input,revision:plan.revision}),e=>e.message==='INSUFFICIENT_FUNDS'&&e.commit==='none');
    for(const payments of [`zcash:${address.address}`,'zcash:invalid?amount=1'])assert.throws(()=>call(first,'proposal_create',{...input,revision:plan.revision,payments}),e=>e.message==='INVALID_ARGUMENT'&&e.commit==='none');
    close(first);reopened=open(0,false);
    const inventory=call(reopened,'proposal_list',{afterSequence:'0',limit:1});
    assert.equal(inventory.highWater,'1');assert.equal(inventory.items.length,1);
    assert.deepEqual(call(reopened,'proposal_get',{operationId:inventory.items[0].operationId}),plan);
    assert.deepEqual(call(second,'proposal_list',{afterSequence:'0',limit:1}).items,[]);
    parentPort.postMessage({pass:true,nativeSelection:true,atomicLocks:true,idFreeDiscovery:true,reopened:true,isolated:true});
  } finally {if(reopened)close(reopened);else if(!runtime.invalid) {try{close(first);}catch{}}close(second);}
}
