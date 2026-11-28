// Harness-only regression: inject a module-loading failure before any WalletDb exists.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./wallet-views-worker.mjs',import.meta.url),'utf8');
const messages=[], listeners=new Map();
const context=vm.createContext({performance, self:{postMessage:v=>messages.push(v),addEventListener:(kind,fn)=>listeners.set(kind,fn)}});
const module=new vm.SourceTextModule(source,{context,initializeImportMeta:meta=>{meta.url='file:///synthetic-test/wallet-views-worker.mjs';},importModuleDynamically:()=>{throw Error('synthetic module load failure');}});
await module.link(()=>{throw Error('unexpected static import');});
await module.evaluate();
{
  context.self.onmessage({data:{op:'initialize',id:7}});
  await new Promise(r=>setImmediate(r));
}
assert.equal(messages.find(v=>v.id===7)?.error,'synthetic module load failure');
assert.ok(messages.some(v=>v.diagnostic?.phase==='module-error'&&v.diagnostic.error.message==='synthetic module load failure'),'module loading errors must reach the owning page before its deadline');
assert.ok(messages.filter(v=>v.diagnostic).every(v=>v.diagnostic.source==='file:///synthetic-test/wallet-views-worker.mjs'));
console.log('PASS: worker module-load failure is attributed and reported to its caller');
const {ownedLifecycle}=await import('./wallet-views-lifecycle.mjs');
const recorded=JSON.parse(fs.readFileSync(new URL('./wallet-views-firefox-failure.json',import.meta.url)));
const worker=recorded.events.find(e=>e.params.type==='dedicated-worker').params;
const origin=new URL(worker.origin).origin, scripts=[worker.origin.slice(origin.length)];
const lifecycle=ownedLifecycle(recorded.events,origin,scripts);
assert.deepEqual(lifecycle.created,[worker.realm]);
assert.deepEqual(lifecycle.destroyed,[worker.realm],'unrelated window destructions must not count as worker evidence');
assert.equal(lifecycle.allWorkersDestroyed,true);
assert.equal(ownedLifecycle(recorded.events,origin,[scripts[0]+'-wrong']).allWorkersDestroyed,false);
assert.equal(ownedLifecycle(recorded.events.filter(e=>e.params.type!=='window'),origin,scripts).allWorkersDestroyed,false);
console.log('PASS: retained Firefox event replay counts only the exact page-owned worker');
