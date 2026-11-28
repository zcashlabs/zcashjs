// Actual targeted WASM, using the existing synthetic wallet fixture's canonical TreeState.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const bundle=process.argv[2],fixture=JSON.parse(await readFile(process.argv[3]));
const {initialize,validateBirthday}=await import(pathToFileURL(`${bundle}/network.mjs`));
initialize(new Uint8Array(await readFile(`${bundle}/bindings_bg.wasm`)));
const bytes=s=>Uint8Array.from(Buffer.from(s,'hex'));
const b=fixture.import.birthday;
const p=bytes(b.parameters),g=bytes(b.genesis),tree=bytes(b.priorTreeState);
validateBirthday(p,g,b.firstScanHeight,tree);
validateBirthday(p,g,b.firstScanHeight,tree,b.firstScanHeight);
for(const first of [0,-1,1.5,2**32,NaN,Infinity,'100'])assert.throws(()=>validateBirthday(p,g,first,tree));
for(const recover of [null,0,99,1.5,2**32,NaN,'100'])assert.throws(()=>validateBirthday(p,g,100,tree,recover));
assert.throws(()=>validateBirthday(p,g,100,new Uint8Array(65537)));
assert.throws(()=>validateBirthday(p,new Uint8Array(31),100,tree));
assert.throws(()=>validateBirthday(p,g,100,new Uint8Array([0])));
assert.throws(()=>validateBirthday(p,g,99,tree));
console.log('native birthday WASM validation and facade admission passed');
