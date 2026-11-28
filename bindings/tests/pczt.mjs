// Actual native PCZT facade qualification; fixtures emitted by upstream Rust types.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const bundle=process.argv[2];assert.ok(bundle,'native primitive bundle required');
const fixture=JSON.parse(await readFile(new URL('./pczt-fixture.json',import.meta.url)));
const api=await import(pathToFileURL(`${bundle}/network.mjs`));
api.initialize(new Uint8Array(await readFile(`${bundle}/bindings_bg.wasm`)));
const bytes=value=>Uint8Array.from(value.match(/../g),byte=>parseInt(byte,16));
const parameters=new TextEncoder().encode(fixture.parameters),genesis=bytes(fixture.genesis);
const parse=(value,height=fixture.height,branch=fixture.branch)=>api.parseStandalonePczt(parameters,genesis,height,branch,bytes(value),65536);
const first=parse(fixture.pczt),second=parse(fixture.v2),ironwood=parse(fixture.ironwood,fixture.ironwoodHeight,fixture.ironwoodBranch);
let combined,redacted;
try {
  assert.deepEqual(first.inspect(),{pcztVersion:1,transactionVersion:5,targetHeight:70,branchId:fixture.branch,pools:[],proofsComplete:true,authorizationComplete:true});
  const v6=ironwood.inspect();assert.equal(v6.transactionVersion,6);assert.deepEqual(v6.pools,['ironwood']);assert.equal(v6.proofsComplete,false);assert.equal(v6.authorizationComplete,false);
  const owned=first.serialize();owned.fill(0);assert.deepEqual(first.serialize(),bytes(fixture.pczt));
  combined=first.combine(second);redacted=first.redact('zakura-signer-full/1');
  assert.deepEqual(redacted.serialize(),bytes(fixture.redacted));
  assert.throws(()=>parse(fixture.v4),/UNSUPPORTED_VERSION/);
  assert.throws(()=>parse(fixture.pczt+'00'),/INVALID_PCZT/);
  assert.throws(()=>parse(fixture.ironwoodEarly,60,fixture.ironwoodEarlyBranch),/NETWORK_MISMATCH/);
  assert.throws(()=>first.redact('unknown'),/UNSUPPORTED_VERSION/);
  const wrong=parse(fixture.pczt,71);try{assert.throws(()=>first.combine(wrong),/NETWORK_MISMATCH/);}finally{wrong.dispose();}
  first.dispose();first.dispose();assert.throws(()=>first.serialize(),/CLOSED/);
  assert.ok(combined.serialize().length);assert.ok(redacted.serialize().length);
  console.log(JSON.stringify({pass:true,methods:5,v5:true,v6:true,structuralOnly:true,independentHandles:true}));
} finally {first.dispose();second.dispose();ironwood.dispose();combined?.dispose();redacted?.dispose();}
