import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
const dir = process.env.LIGHTWIRE_BUILD;
if (!dir) throw new Error('LIGHTWIRE_BUILD required');
const { createLightwire } = await import(pathToFileURL(`${dir}/codec.mjs`));
const bytes = new Uint8Array(await readFile(`${dir}/wasm/zakura_lightwire_bg.wasm`));
const codec = createLightwire(bytes);
test('real WASM balance codec', () => {
 assert.deepEqual(codec.encodeRequest('GetTaddressBalance', JSON.stringify({addresses:['a','bc']})), Uint8Array.of(10,1,97,10,2,98,99));
 assert.deepEqual(codec.decodeResponse('GetTaddressBalance', Uint8Array.of(8,127)), {value_zat:'127'});
});
test('facade rejects records with accessors without executing them', () => {
 let calls=0;
 assert.throws(()=>codec.encodeRequest('GetTreeState',{get height(){calls++;return '1'}}));
 assert.equal(calls,0);
 for(const v of [null,[],new Date(),{height:1n},{height:NaN},{height:Infinity},{height:undefined},{height:'01'},{hash:'AA'}]) assert.throws(()=>codec.encodeRequest('GetTreeState',v));
});
test('facade owns bytes and rejects shared or disguised input', () => {
 const input=Uint8Array.of(8,1); const result=codec.decodeResponse('GetLatestBlock',input); input.fill(0); assert.equal(result.height,'1');
 for(const buffer of [new SharedArrayBuffer(8),Object.setPrototypeOf(new SharedArrayBuffer(8),ArrayBuffer.prototype)]) assert.throws(()=>codec.decodeResponse('GetLatestBlock',new Uint8Array(buffer)));
 assert.throws(()=>codec.decodeResponse('GetLatestBlock',new Proxy(Uint8Array.of(8,1),{})));
 assert.throws(()=>codec.decodeItem('GetLatestBlock',new Uint8Array()));
 assert.throws(()=>codec.decodeResponse('GetMempoolStream',new Uint8Array()));
 assert.throws(()=>createLightwire(bytes));
});
test('independent protobuf vectors run through real WASM', async () => {
 const vectors=JSON.parse(await readFile(new URL('./golden.json',import.meta.url)));
 for(const f of vectors){
   const wire=Uint8Array.from(Buffer.from(f.hex,'hex'));
   if(f.direction==='request') assert.deepEqual(codec.encodeRequest(f.method,JSON.stringify(f.dto)),wire,f.method);
   else assert.deepEqual((f.direction==='item'?codec.decodeItem:codec.decodeResponse)(f.method,wire),f.dto,f.method);
 }
});
test('all malformed and nested amplification cases fail without poisoning WASM', () => {
 const bad = [[0],[15],[10,0],[8,128],[18,255,255,255,255,15],[8,255,255,255,255,255,255,255,255,255,2],[163,6,172,6]];
 for(const wire of bad) assert.throws(()=>codec.decodeResponse('GetLatestBlock',Uint8Array.from(wire)));
 assert.throws(()=>codec.decodeResponse('GetLightdInfo',Uint8Array.of(10,1,255)));
 assert.throws(()=>codec.decodeItem('GetBlockRange',Uint8Array.from(Array(8193).fill([58,0]).flat())));
 assert.throws(()=>codec.encodeRequest('GetTaddressBalance',JSON.stringify({addresses:Array(8193).fill('a')})));
 assert.throws(()=>codec.decodeResponse('GetLatestBlock',new Uint8Array(4*1024*1024+1)));
 assert.throws(()=>codec.encodeRequest('SendTransaction',JSON.stringify({data:'aa'.repeat(1024*1024+1)})));
 const cyclic={};cyclic.block=cyclic;assert.throws(()=>codec.encodeRequest('GetTransaction',cyclic));
 const sparse=Array(1);assert.throws(()=>codec.encodeRequest('GetTaddressBalance',{addresses:sparse}));
 const named=[];named.extra=1;assert.throws(()=>codec.encodeRequest('GetTaddressBalance',{addresses:named}));
 assert.throws(()=>codec.encodeRequest('GetTaddressBalance',JSON.stringify({addresses:['\ud800']})));
 assert.throws(()=>codec.encodeRequest('GetTreeState',{[Symbol('x')]:1}));
 assert.throws(()=>codec.encodeRequest('GetTreeState',Object.defineProperty({},'height',{value:'1'})));
 assert.deepEqual(codec.decodeResponse('GetTaddressBalance',Uint8Array.of(8,1)),{value_zat:'1'});
});
test('ordinary-page-compatible runtime suite',async()=>{
 const {runChecks}=await import('./runtime.mjs');
 const vectors=JSON.parse(await readFile(new URL('./golden.json',import.meta.url)));
 const malformed=JSON.parse(await readFile(new URL('./malformed.json',import.meta.url)));
 const receipt=runChecks(codec,vectors,malformed);assert.equal(receipt.ok,true);console.log(JSON.stringify(receipt));
});

test('TreeState encoder preserves the independent full-field vector and primitive boundary', async () => {
 const vectors=JSON.parse(await readFile(new URL('./golden.json',import.meta.url)));
 const vector=vectors.find(v=>v.method==='GetTreeState'&&v.direction==='response');
 assert.deepEqual(codec.encodeTreeState(JSON.stringify(vector.dto)),Uint8Array.from(Buffer.from(vector.hex,'hex')));
 let calls=0;
 assert.throws(()=>codec.encodeTreeState({toJSON(){calls++;return vector.dto;}}));
 assert.equal(calls,0);
 assert.throws(()=>codec.encodeTreeState('\ud800'));
 assert.throws(()=>codec.encodeTreeState(' '.repeat(8*1024*1024+1)));
});
