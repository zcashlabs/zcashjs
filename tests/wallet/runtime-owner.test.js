// Fault injection at the bootstrap cleanup boundary, not native qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {Worker,MessageChannel} from 'node:worker_threads';
import {walletProfile} from '../../dist/src/runtime/wallet-profile.js';

for (const failing of ['release','close','control','busy']) test(`shared owner invalidation after ${failing} failure`, async t => {
  const root=await mkdtemp(join(tmpdir(),'wallet-owner-cleanup-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const identity={...walletProfile,mode:'baseline',buildSha256:'0'.repeat(64),dependencyGraphSha256:'1'.repeat(64),memory:{initialPages:321,maximumPages:4096,shared:false}};
  const {memory,...expected}=identity;
  await writeFile(join(root,'native.mjs'),`
    export const runtimeIdentity=${JSON.stringify(identity)};
    export const consensusContext=()=>{};
    export const initializeWalletRuntime=()=>({invalid:false,open(){${failing==='release'?"throw 'NETWORK_MISMATCH'":"return {}"};}});
    export const viewsForStorage=()=>{let reads=0;return {get generation(){if(!reads++)throw Error('INVALID_ARGUMENT');return 1},instance:'fixture',close(){throw Error('cleanup')}};};
  `);
  await writeFile(join(root,'host.mjs'),failing==='busy' ? `export const acquire=async()=>{throw new DOMException('private fixture path','NoModificationAllowedError')};` : `export const acquire=async()=>({owned:true,access(){return false;},release(){${failing==='release'?"throw Error('cleanup')":''};}});`);
  const worker=new Worker(new URL('../../dist/src/runtime/wallet-worker.js',import.meta.url));
  const channel=new MessageChannel();
  t.after(async()=>{channel.port1.close();channel.port2.close();await worker.terminate();});
  const reply=async data=>{const answer=once(worker,'message',{signal:AbortSignal.timeout(5000)});worker.postMessage(data,data.port?[data.port]:[]);return (await answer)[0];};
  assert.equal((await reply({id:1,type:'initialize',moduleUrl:pathToFileURL(join(root,'native.mjs')).href,wasm:new Uint8Array([0]),expected,maxMemoryBytes:512*1024*1024})).type,'ready');
  if(failing==='control') {
    const result=await reply({id:2,type:'invalid-control'});
    assert.equal(result.type,'failure');assert.equal(result.code,'PROTOCOL_MISMATCH');assert.equal(result.fatal,true);
    return;
  }
  const result=await reply({id:2,type:'open',storage:{kind:'node-filesystem',path:root},hostUrl:pathToFileURL(join(root,'host.mjs')).href,parametersFormat:'zcash-js-network/1',parameters:new Uint8Array([1]),genesis:new Uint8Array(32),port:channel.port2});
  assert.equal(result.type,'failure');
  if(failing==='busy'){assert.equal(result.code,'STORAGE_BUSY');assert.equal(result.fatal,false);assert.doesNotMatch(JSON.stringify(result),/private fixture path/);return;}
  assert.equal(result.fatal,true);
  assert.equal(result.code,failing==='release'?'STORAGE_ERROR':'INVALID_ARGUMENT');
});

// Protocol only: actual shared Rust/TLS and scanner work require the native artifact.
for (const buildFailure of [false,true]) test(`threaded owner pool build ${buildFailure?'failure retains initialization id':'gates readiness'}`, async t => {
  const root=await mkdtemp(join(tmpdir(),'wallet-owner-pool-'));
  const worker=new Worker(new URL('../../dist/src/runtime/wallet-worker.js',import.meta.url));
  t.after(async()=>{await worker.terminate();await rm(root,{recursive:true,force:true});});
  const identity={...walletProfile,mode:'threaded',buildSha256:'0'.repeat(64),dependencyGraphSha256:'1'.repeat(64),memory:{initialPages:321,maximumPages:4096,shared:true}};
  const {memory,...expected}=identity;
  await writeFile(join(root,'native.mjs'),`
    export const runtimeIdentity=${JSON.stringify(identity)};
    let prepared=false;
    export function prepareThreaded(bytes,count){if(count!==2)throw Error('INVALID_ARGUMENT');prepared=true;return {module:new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0])),memory:new WebAssembly.Memory({initial:1,maximum:2,shared:true})};}
    export function finishThreaded(){if(!prepared)throw Error('PROTOCOL_MISMATCH');${buildFailure?"throw Error('RUNTIME_UNAVAILABLE');":''}return {invalid:false};}
  `);
  const answers=[];worker.on('message',value=>answers.push(value));
  const reply=async data=>{const answer=once(worker,'message',{signal:AbortSignal.timeout(5000)});worker.postMessage(data);return (await answer)[0];};
  const pool=await reply({id:1,type:'initialize',moduleUrl:pathToFileURL(join(root,'native.mjs')).href,wasm:new Uint8Array([0]),expected,maxMemoryBytes:512*1024*1024,workers:2});
  assert.equal(pool.type,'pool');assert.ok(pool.memory.buffer instanceof SharedArrayBuffer);
  assert.equal(answers.some(value=>value.type==='ready'),false);
  const ready=await reply({type:'pool-build'});assert.equal(ready.id,1);
  if(buildFailure){assert.equal(ready.type,'failure');assert.equal(ready.code,'RUNTIME_UNAVAILABLE');assert.equal(ready.fatal,true);return;}
  assert.equal(ready.type,'ready');
  const duplicate=await reply({type:'pool-build'});assert.equal(duplicate.type,'failure');assert.equal(duplicate.fatal,true);
});

test('compute initialization failure never reports loaded', async t => {
  const root=await mkdtemp(join(tmpdir(),'wallet-compute-init-'));
  const worker=new Worker(new URL('../../dist/src/runtime/wallet-worker.js',import.meta.url));
  t.after(async()=>{await worker.terminate();await rm(root,{recursive:true,force:true});});
  await writeFile(join(root,'native.mjs'),`export function enterThreaded(){throw Error('RUNTIME_UNAVAILABLE')}`);
  const answers=[];worker.on('message',value=>answers.push(value));
  const answer=once(worker,'message',{signal:AbortSignal.timeout(5000)});
  worker.postMessage({type:'compute-initialize',moduleUrl:pathToFileURL(join(root,'native.mjs')).href,module:new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0])),memory:new WebAssembly.Memory({initial:1,maximum:2,shared:true}),index:0});
  assert.equal((await answer)[0].type,'failure');assert.equal(answers.some(value=>value.type==='compute-loaded'),false);
});

for (const fault of ['acquire', 'native-known', 'native-unknown', 'consensus']) test(`storage opening contains ${fault} failure`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'wallet-owner-boundary-'));
  const worker = new Worker(new URL('../../dist/src/runtime/wallet-worker.js', import.meta.url));
  const channels = [];
  t.after(async () => {
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    await worker.terminate();
    await rm(root, {recursive: true, force: true});
  });
  const identity = {...walletProfile, mode: 'baseline', buildSha256: '0'.repeat(64), dependencyGraphSha256: '1'.repeat(64),
    memory: {initialPages: 321, maximumPages: 4096, shared: false}};
  const {memory, ...expected} = identity;
  const log = join(root, 'events');
  await writeFile(join(root, 'native.mjs'), `
    import {appendFileSync} from 'node:fs';
    const log = event => appendFileSync(${JSON.stringify(log)}, event + '\\n');
    let validations = 0, opens = 0;
    export const runtimeIdentity = ${JSON.stringify(identity)};
    export const consensusContext = () => { log('validate'); if (++validations === 1 && ${fault === 'consensus'}) throw Error('INVALID_ARGUMENT'); };
    export const initializeWalletRuntime = () => ({invalid: false, open(backend) {
      log('open');
      if (++opens === 1 && ${fault.startsWith('native')}) throw Error(${JSON.stringify(fault === 'native-known' ? 'NETWORK_MISMATCH' : 'private native text')});
      return backend;
    }});
    export const viewsForStorage = backend => ({generation: 1, instance: 'fixture', call() {}, close() {backend.release();}});
  `);
  await writeFile(join(root, 'host.mjs'), `
    import {appendFileSync} from 'node:fs';
    let acquisitions = 0;
    export const acquire = async () => {
      appendFileSync(${JSON.stringify(log)}, 'acquire\\n');
      if (++acquisitions === 1 && ${fault === 'acquire'}) throw Error('private filesystem text');
      return {owned: true, access() {return false;}, release() {this.owned = false; appendFileSync(${JSON.stringify(log)}, 'release\\n');}};
    };
  `);
  const reply = async data => {
    const answer = once(worker, 'message', {signal: AbortSignal.timeout(5000)});
    worker.postMessage(data, data.port ? [data.port] : []);
    return (await answer)[0];
  };
  await reply({id: 1, type: 'initialize', moduleUrl: pathToFileURL(join(root, 'native.mjs')).href,
    wasm: new Uint8Array([0]), expected, maxMemoryBytes: 512 * 1024 * 1024});
  const open = id => {
    const channel = new MessageChannel(); channels.push(channel);
    return reply({id, type: 'open', storage: {kind: 'node-filesystem', path: root},
      hostUrl: pathToFileURL(join(root, 'host.mjs')).href, parametersFormat: 'zcash-js-network/1',
      parameters: new Uint8Array([1]), genesis: new Uint8Array(32), port: channel.port2});
  };
  const first = await open(2);
  assert.equal(first.type, 'failure');
  assert.equal(first.fatal, fault === 'native-unknown');
  assert.equal(first.code, fault === 'native-known' ? 'NETWORK_MISMATCH' : fault === 'consensus' ? 'INVALID_ARGUMENT' : 'STORAGE_ERROR');
  assert.doesNotMatch(JSON.stringify(first), /private/);
  const {readFile} = await import('node:fs/promises');
  const events = (await readFile(log, 'utf8')).trim().split('\n');
  assert.deepEqual(events, fault === 'consensus' ? ['validate'] : fault === 'acquire'
    ? ['validate', 'acquire'] : ['validate', 'acquire', 'open', 'release']);
  const second = await open(3);
  assert.equal(second.type, fault === 'native-unknown' ? 'failure' : 'opened');
  if (fault === 'native-unknown') {
    assert.equal(second.fatal, true);
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, events.length);
  }
});

// Startup fault injection verifies classification and cleanup, not actual disk exhaustion/migration.
for (const tag of ['MIGRATION_REQUIRED', 'QuotaExceededError', 'ENOSPC', 'EDQUOT']) test(`startup preserves ${tag}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'wallet-error-code-'));
  const worker = new Worker(new URL('../../dist/src/runtime/wallet-worker.js', import.meta.url));
  const channel = new MessageChannel();
  t.after(async () => {channel.port1.close(); channel.port2.close(); await worker.terminate(); await rm(root, {recursive:true,force:true});});
  const identity = {...walletProfile,mode:'baseline',buildSha256:'0'.repeat(64),dependencyGraphSha256:'1'.repeat(64),memory:{initialPages:321,maximumPages:4096,shared:false}};
  const {memory,...expected} = identity;
  await writeFile(join(root,'native.mjs'), `
    export const runtimeIdentity=${JSON.stringify(identity)};
    export const consensusContext=()=>{};
    export const initializeWalletRuntime=()=>({invalid:false,open(){throw 'MIGRATION_REQUIRED';}});
  `);
  const acquire = tag === 'MIGRATION_REQUIRED' ? 'return {owned:true,access(){return false;},release(){}}'
    : tag === 'QuotaExceededError' ? "throw new DOMException('PRIVATE_SENTINEL','QuotaExceededError')"
    : `throw Object.assign(Error('PRIVATE_SENTINEL'),{code:${JSON.stringify(tag)}})`;
  await writeFile(join(root,'host.mjs'), `export const acquire=async()=>{${acquire}};`);
  const reply = async data => {
    const answer = once(worker,'message',{signal:AbortSignal.timeout(5000)});
    worker.postMessage(data,data.port?[data.port]:[]); return (await answer)[0];
  };
  assert.equal((await reply({id:1,type:'initialize',moduleUrl:pathToFileURL(join(root,'native.mjs')).href,wasm:new Uint8Array([0]),expected,maxMemoryBytes:512*1024*1024})).type,'ready');
  const result = await reply({id:2,type:'open',storage:{kind:'node-filesystem',path:root},hostUrl:pathToFileURL(join(root,'host.mjs')).href,parametersFormat:'zcash-js-network/1',parameters:new Uint8Array([1]),genesis:new Uint8Array(32),port:channel.port2});
  assert.equal(result.type,'failure'); assert.equal(result.code,tag === 'MIGRATION_REQUIRED' ? tag : 'STORAGE_QUOTA');
  assert.equal(result.fatal,tag === 'MIGRATION_REQUIRED'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
});
