// Same genuine-engine cases run in Node and the ordinary Firefox page.
export function boundaryChecks(codec) {
  let checks=0;
  const equal=(a,b)=>{checks++;if(JSON.stringify(a)!==JSON.stringify(b))throw Error('boundary mismatch');};
  const rejects=f=>{checks++;try{f();}catch{return;}throw Error('expected boundary rejection');};
  const decode=v=>codec.decodeResponse('GetLatestBlock',v);
  equal(decode(new Uint8Array()),{height:'0',hash:''});
  const buffer=new ArrayBuffer(8,{maxByteLength:16});
  if(!buffer.resizable)throw Error('real resizable ArrayBuffer required');
  const view=new Uint8Array(buffer,4,2);view.set([8,42]);
  Object.defineProperty(view,'constructor',{get(){throw Error('caller species hook');}});
  equal(decode(view).height,'42');buffer.resize(2);
  rejects(()=>decode(view));rejects(()=>codec.decodeItem('GetMempoolStream',view));
  buffer.resize(8);view.set([8,43]);equal(decode(view).height,'43');
  const empty=new Uint8Array(buffer,8,0);equal(decode(empty).height,'0');
  buffer.resize(4);rejects(()=>decode(empty));buffer.resize(8);equal(decode(empty).height,'0');
  const tracking=new Uint8Array(buffer,4);buffer.resize(4);equal(decode(tracking).height,'0');
  buffer.resize(2);rejects(()=>decode(tracking));
  const detached=new Uint8Array(0);structuredClone(detached.buffer,{transfer:[detached.buffer]});rejects(()=>decode(detached));
  equal(decode(Uint8Array.of(99,8,42,99).subarray(1,3)).height,'42');
  let hooks=0;const trap=()=>{hooks++;throw Error('caller hook');};
  const proxy=new Proxy({height:'1'},{ownKeys:trap,get:trap,getPrototypeOf:trap});
  const revoked=Proxy.revocable({},{});revoked.revoke();
  for(const v of [proxy,revoked.proxy,new String('{}'),{},[],null,undefined,1,1n,Symbol(),()=>{}, {toString:trap,toJSON:trap,[Symbol.toPrimitive]:trap}])rejects(()=>codec.encodeRequest('GetTreeState',v));
  equal(hooks,0);
  equal([...codec.encodeRequest('GetTreeState','{"height":"42","hash":"00ff"}')],[8,42,18,2,0,255]);
  equal([...codec.encodeRequest('GetLatestBlock','{}')],[]);
  for(const text of ['', 'null','[]','{"height":1}','{"height":"01"}','{"height":"1","height":"2"}','{"bad":0}','{"hash":"AA"}','{"height":-0}', '{"height":NaN}'])rejects(()=>codec.encodeRequest('GetTreeState',text));
  for(const text of ['{"addresses":["\ud800"]}','{"addresses":["\udc00"]}','{"addresses":["\\ud800"]}','{"addresses":["\\udc00"]}'])rejects(()=>codec.encodeRequest('GetTaddressBalance',text));
  equal([...codec.encodeRequest('GetTaddressBalance','{"addresses":["😀"]}')],[10,4,240,159,152,128]);
  const max=8*1024*1024;
  equal([...codec.encodeRequest('GetLatestBlock',' '.repeat(max-2)+'{}')],[]);
  rejects(()=>codec.encodeRequest('GetLatestBlock',' '.repeat(max-1)+'{}'));
  // Code-unit length fits, but UTF-8 exceeds the cap; no encoding allocation needed.
  rejects(()=>codec.encodeRequest('GetTaddressBalance','{"addresses":["'+'€'.repeat(Math.floor(max/3))+'"]}'));
  return checks;
}
