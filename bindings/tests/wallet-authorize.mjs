import assert from 'node:assert/strict';
import fs from 'node:fs';
import {once} from 'node:events';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
if(isMainThread) {
  const worker=new Worker(new URL(import.meta.url),{workerData:{bundle:process.argv[2]}});
  try {const [result]=await once(worker,'message',{signal:AbortSignal.timeout(30000)});assert.equal(result.pass,true);console.log(JSON.stringify(result));}
  finally {await worker.terminate();}
} else {
  const bundle=pathToFileURL(workerData.bundle+'/');
  const {initializeWalletRuntime}=await import(new URL('wallet.mjs',bundle));
  const {viewsForStorage}=await import(new URL('views.mjs',bundle));
  const {parseStandalonePczt}=await import(new URL('network.mjs',bundle));
  const fixture=JSON.parse(fs.readFileSync(new URL('signer-fixture.json',import.meta.url)));
  const parameters=new TextEncoder().encode(fixture.parameters),genesis=new Uint8Array(Buffer.from(fixture.genesis,'hex'));
  const runtime=initializeWalletRuntime(fs.readFileSync(new URL('bindings_bg.wasm',bundle)));
  const owner=viewsForStorage(runtime.openMemory('zcash-js-network/1',parameters,genesis));
  const created=owner.call(owner.generation,owner.instance,'account_import_mnemonic_signer',{accountIndex:0,birthday:'fullScan'},undefined,new TextEncoder().encode(fixture.mnemonic));
  owner.close(owner.generation,owner.instance);
  const token=created.signerToken,caps=runtime.signers.capabilities(token);
  assert.equal(caps.revision,'zakura-memory-signer/1');assert.equal(caps.authorizations.length,5);
  const sign=(bytes,height,branch,max=caps.maxPcztBytes)=>runtime.signers.authorize(token,'zcash-js-network/1',parameters,genesis,height,branch,bytes,max);
  assert.throws(()=>sign(new Uint8Array([1]),-1,0),/INVALID_ARGUMENT/);
  assert.throws(()=>sign(new Uint8Array([1]),100,0,caps.maxPcztBytes+1),/RESOURCE_LIMIT/);
  assert.throws(()=>sign(new Uint8Array(2),100,0,1),/RESOURCE_LIMIT/);
  assert.throws(()=>sign([],100,0),/INVALID_PCZT/);
  assert.equal(runtime.invalid,false);
  let count=0;
  for(const vector of fixture.vectors) for(const field of ['bytes','wire2']) {
    const bytes=new Uint8Array(Buffer.from(vector[field],'hex')),original=bytes.slice();
    const signed=sign(bytes,vector.height,vector.branch);
    assert.deepEqual(bytes,original);assert.notDeepEqual(signed,bytes);
    const handle=parseStandalonePczt(parameters,genesis,vector.height,vector.branch,signed,caps.maxPcztBytes);
    try {assert.equal(handle.inspect().authorizationComplete,true);assert.equal(handle.inspect().proofsComplete,false);}
    finally {handle.dispose();}
    count++;
  }
  runtime.signers.release(token);
  assert.throws(()=>runtime.signers.capabilities(token),/STALE_HANDLE/);
  assert.equal(runtime.invalid,false);
  parentPort.postMessage({pass:true,case:'retained native signing after DB close; bounded facade; V5/V6',vectors:count});
}
