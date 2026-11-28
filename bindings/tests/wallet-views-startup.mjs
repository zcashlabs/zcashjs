// Harness scheduling regression only: stop at the backend import; no fake WalletDb.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./wallet-views-worker.mjs',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function boot() {
  const messages=[], listeners=new Map();
  let release, imports=0;
  const gate=new Promise(r=>{release=r;});
  const self={postMessage:v=>messages.push(v),addEventListener:(kind,fn)=>listeners.set(kind,fn)};
  const context=vm.createContext({performance,self});
  const dependency=new vm.SyntheticModule(['initializeViews'],function(){this.setExport('initializeViews',()=>{throw Error('must not initialize storage in harness test');});},{context});
  await dependency.link(()=>{});await dependency.evaluate();
  const module=new vm.SourceTextModule(source,{context,initializeImportMeta:m=>{m.url='file:///synthetic-test/worker.mjs';},importModuleDynamically:async name=>{
    if(name==='../views.mjs'){imports++;await gate;return dependency;}
    throw Error('synthetic backend boundary');
  }});
  await module.link(()=>{});
  const evaluated=module.evaluate();
  await tick();
  const send=request=>{listeners.get('message')?.({data:request});self.onmessage?.({data:request});};
  return {messages,send,release,evaluated,imports:()=>imports};
}
const first=await boot();
first.send({op:'initialize',id:41});await tick();first.release();await first.evaluated;await tick();await tick();
assert.equal(first.messages.filter(v=>v.diagnostic?.phase==='receive:initialize').length,1,'early initialize must be received exactly once');
assert.equal(first.messages.filter(v=>v.id===41&&v.ok===false&&v.error==='synthetic backend boundary').length,1,'early caller must settle with its own ID');
assert.equal(first.imports(),1);
console.log('PASS: initialize during delayed facade import is received once and settles');
const closing=await boot();
closing.send({op:'initialize',id:51});await tick();
closing.send({op:'initialize',id:52});closing.send({op:'account_list',id:53});
closing.send({op:'close',id:54});closing.send({op:'close',id:55});await tick();
assert.equal(closing.messages.find(v=>v.id===55)?.error,'ABORTED');
assert.equal(closing.messages.find(v=>v.id===51)?.error,'ABORTED');
assert.equal(closing.messages.find(v=>v.id===52)?.error,'DOMAIN_USED');
assert.equal(closing.messages.find(v=>v.id===53)?.error,'DOMAIN_NOT_READY');
closing.release();await closing.evaluated;await tick();await tick();
assert.equal(closing.messages.find(v=>v.id===54)?.ok,true);
assert.equal(closing.messages.filter(v=>v.id===51).length,1);
assert.equal(closing.messages.some(v=>v.diagnostic?.phase==='backend-acquire-start'),false,'cancelled startup must not acquire storage');
console.log('PASS: close cancels delayed startup, settles IDs once, and prevents storage acquisition');
