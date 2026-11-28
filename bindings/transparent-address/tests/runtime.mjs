export function runChecks(createCodec, bytes, fixtures) {
 let checks=0;
 const assert=(value,message)=>{checks++;if(!value)throw Error(message);};
 const rejects=(fn)=>{let failed=false;try{fn();}catch{failed=true;}assert(failed,'expected rejection');};
 let touched=0;
 const hostile=new Proxy({}, {get(){touched++;throw Error('get');},ownKeys(){touched++;throw Error('keys');},getPrototypeOf(){touched++;throw Error('prototype');}});
 for(const bad of [undefined,null,1,1n,true,Symbol(),{},[],hostile,new ArrayBuffer(8),new Uint16Array(4),new Proxy(new Uint8Array(4),{}),new Uint8Array(new SharedArrayBuffer(8)),new Uint8Array(16*1024*1024+1)]) rejects(()=>createCodec(bad));
 for(const invalid of [new Uint8Array(),new Uint8Array([0,1,2,3])])rejects(()=>createCodec(invalid));
 const detached=new Uint8Array(8);structuredClone(detached.buffer,{transfer:[detached.buffer]});rejects(()=>createCodec(detached));
 const rab=new ArrayBuffer(8,{maxByteLength:16}),oob=new Uint8Array(rab,4,4);rab.resize(2);rejects(()=>createCodec(oob));
 const padded=new Uint8Array(bytes.length+8);padded.set(bytes,4);
 const input=padded.subarray(4,4+bytes.length);
 for(const key of ['buffer','byteLength','byteOffset','constructor'])Object.defineProperty(input,key,{get(){touched++;throw Error(key);}});
 const codec=createCodec(input);padded.fill(0);
 rejects(()=>createCodec(bytes));
 const address=fixtures.positive[0].address;
 for(const bad of [undefined,null,1,1n,true,Symbol(),{},[],new String(address),hostile]) {
  rejects(()=>codec.decode(bad,'main'));rejects(()=>codec.decode(address,bad));
 }
 assert(touched===0,'arbitrary objects and shadowed properties untouched');
 for(const v of fixtures.positive)for(const family of ['main','test','regtest']) {
  if((family==='main')!==(v.family==='main')){rejects(()=>codec.decode(v.address,family));continue;}
  const result=codec.decode(v.address,family);
  assert(result.canonical===v.address,'canonical');assert(result.kind===v.kind,'kind');
  assert(result.payload instanceof Uint8Array&&result.payload.length===20,'owned 20 byte payload');
  assert(Array.from(result.payload,b=>b.toString(16).padStart(2,'0')).join('')===v.hex,'independent bytes');
  result.payload.fill(255);result.canonical='changed';
  assert(codec.decode(v.address,family).canonical===v.address,'canonical isolation');
  assert(Array.from(codec.decode(v.address,family).payload,b=>b.toString(16).padStart(2,'0')).join('')===v.hex,'payload isolation');
 }
 for(const v of fixtures.unsupported)for(const family of ['main','test','regtest'])rejects(()=>codec.decode(v,family));
 for(const bad of ['', 't'.repeat(128),'t'.repeat(129),'t'.repeat(1000000),address.slice(0,-1),'1'+address,address.slice(0,-1)+'1',' '+address,address+'\n','\u2003'+address,address+'\0',address+'é',address+'\ud800',address.toUpperCase()]) rejects(()=>codec.decode(bad,'main'));
 rejects(()=>codec.decode(address,'Main'));
 // Captured intrinsics must not consult caller-overridable .call properties.
 const char=String.prototype.charCodeAt;const descriptor=Object.getOwnPropertyDescriptor(char,'call');
 Object.defineProperty(char,'call',{configurable:true,get(){throw Error('overridden call');}});
 try{assert(codec.decode(address,'main').canonical===address,'intrinsic invocation');}finally{if(descriptor)Object.defineProperty(char,'call',descriptor);else delete char.call;}
 return {ok:true,checks};
}
