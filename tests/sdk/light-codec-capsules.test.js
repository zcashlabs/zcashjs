import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('packed light codecs are lazy, native, owned and bound to their capsule receipts',async()=>{
  const root=resolve(import.meta.dirname,'../..'), scratch=await mkdtemp(join(tmpdir(),'packed-light-codecs-'));
  const [packed]=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',scratch],{cwd:root,encoding:'utf8'}));
  await mkdir(join(scratch,'unpacked'));
  execFileSync('tar',['-xzf',join(scratch,packed.filename),'-C',join(scratch,'unpacked')]);
  const runtime=join(scratch,'unpacked/package/dist/src/runtime');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const {release,revision:commit}=JSON.parse(await readFile(join(root,'scripts/native-source.json')));
  const revision=execFileSync('git',['-C',join(root,'.cache/native',commit??release,'source'),'rev-parse',`${commit??`refs/tags/${release}`}^{commit}`],{encoding:'utf8'}).trim();
  for(const name of ['primitive','lightwire','transparent-address']) {
    const receipt=JSON.parse(await readFile(join(runtime,`${name}-capsule.json`),'utf8'));
    assert.equal(receipt.nativeRelease,release??null);
    assert.equal(receipt.nativeRevision,revision);
    assert.equal(sha(await readFile(join(runtime,`${name}-capsule.mjs`))),receipt.sha256);
    assert.equal(sha(await readFile(join(root,'scripts/primitive-capsule.js'))),receipt.generatorSha256);
    assert.equal(sha(await readFile(join(root,'package-lock.json'))),receipt.lockSha256);
  }
  let instances=0;
  const original=WebAssembly.Instance,originalFetch=globalThis.fetch;
  WebAssembly.Instance=new Proxy(original,{construct(target,args){instances++;return Reflect.construct(target,args);}});
  globalThis.fetch=()=>{throw Error('unexpected fetch');};
  try {
    const wireModule=await import(pathToFileURL(join(runtime,'lightwire-capsule.mjs')));
    const addressModule=await import(pathToFileURL(join(runtime,'transparent-address-capsule.mjs')));
    assert.equal(instances,0);
    const wire=wireModule.initialize();assert.equal(wireModule.initialize(),wire);
    assert.deepEqual(wire.encodeRequest('GetTreeState','{"height":"7","hash":""}'),new Uint8Array([8,7]));
    assert.deepEqual(wire.encodeTreeState('{"height":"7","orchard_tree":"ab"}'),new Uint8Array([16,7,50,2,97,98]));
    assert.equal(wire.decodeResponse('GetLatestBlock',new Uint8Array([8,7])).height,'7');
    assert.equal(wire.decodeItem('GetBlockRange',new Uint8Array([16,7])).height,'7');
    assert.throws(()=>wire.decodeResponse('GetLatestBlock',new Uint8Array([255])));
    const address=addressModule.initialize();assert.equal(addressModule.initialize(),address);
    const token='t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs';
    const decoded=address.decode(token,'main');assert.equal(decoded.canonical,token);assert.equal(decoded.kind,'p2pkh');assert.equal(decoded.payload.length,20);
    const originalPayload=decoded.payload.slice();decoded.payload.fill(0);
    assert.deepEqual(address.decode(token,'main').payload,originalPayload);
    assert.throws(()=>address.decode(token,'test'));
    assert.equal(instances,2);
    console.log(JSON.stringify({packed:scratch,instances,fetches:0}));
  } finally {WebAssembly.Instance=original;globalThis.fetch=originalFetch;}
});
