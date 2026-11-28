import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as host from '../wallet-host/storage-host.mjs';
import { acquire } from '../wallet-host/node-fs.mjs';
import { Worker, isMainThread } from 'node:worker_threads';
if(isMainThread) {
  const worker=new Worker(new URL(import.meta.url));
  await new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(Error(`worker exit ${code}`)));});
} else {
const sharedHost=await import('../wallet-host/storage-host.mjs?shared-entropy');
const sharedMemory=new WebAssembly.Memory({initial:1,maximum:1,shared:true});sharedHost.attachMemory(sharedMemory,true);
const originalRandom=crypto.getRandomValues;let entropyCalls=0,scratch;
try {
  crypto.getRandomValues=value=>{assert.ok(value.buffer instanceof ArrayBuffer);entropyCalls++;scratch=value;value.fill(9);return value;};
  assert.equal(sharedHost.entropy(0,32),32);assert.ok(new Uint8Array(sharedMemory.buffer,0,32).every(value=>value===9));assert.ok(scratch.every(value=>value===0));
  assert.equal(sharedHost.entropy(65530,32),0);assert.equal(entropyCalls,1,'bounds checked before entropy callback');
} finally {crypto.getRandomValues=originalRandom;}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-host-multi-'));
const directories=['one','two'].map(name=>{const p=path.join(root,name);fs.mkdirSync(p,{mode:0o700});return p;});
const owners=directories.map(p=>acquire(p,{create:true}));
const memory=new WebAssembly.Memory({initial:1});host.attachMemory(memory);
const bytes=new Uint8Array(memory.buffer), view=new DataView(memory.buffer);
bytes.set(new TextEncoder().encode('/wallet.db\0'),0);
try {
  for(const owner of owners) host.attachBackend(owner);
  const ids=owners.map(owner=>host.withBackend(owner,()=>{assert.equal(host.file_open(0,2|4|0x100,64),0);return view.getInt32(64,true);}));
  owners.forEach((owner,i)=>host.withBackend(owner,()=>{
    bytes[128]=i+1;assert.equal(host.file_write(ids[i],128,1,0n),0);assert.equal(host.file_sync(ids[i],0),0);
  }));
  owners.forEach((owner,i)=>host.withBackend(owner,()=>{
    bytes[128]=0;assert.equal(host.file_read(ids[i],128,1,0n),0);assert.equal(bytes[128],i+1);
    assert.throws(()=>host.file_read(ids[1-i],128,1,0n),/foreign file/);
  }));
  host.withBackend(owners[0],()=>{assert.equal(host.file_close(ids[0]),0);owners[0].release();});
  host.withBackend(owners[1],()=>{
    assert.equal(host.state.closeError,false);assert.equal(host.file_read(ids[1],128,1,0n),0);assert.equal(bytes[128],2);
    assert.equal(host.file_close(ids[1]),0);owners[1].release();
  });
  assert.equal(fs.readFileSync(path.join(directories[0],'wallet.db'))[0],1);
  assert.equal(fs.readFileSync(path.join(directories[1],'wallet.db'))[0],2);
  console.log(JSON.stringify({pass:true,backends:2,isolatedFiles:true,independentClose:true}));
} finally {for(const owner of owners)if(owner.owned)owner.release();}

}
