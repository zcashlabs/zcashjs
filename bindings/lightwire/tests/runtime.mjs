import { boundaryChecks } from './boundary.mjs';
// Shared ordinary-page/Node checks, with independent Python protobuf fixtures.
export function runChecks(codec, vectors, malformed) {
  let checks=boundaryChecks(codec);
  const stable=v=>v && typeof v==='object' ? Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  const equal=(a,b)=>{checks++;if(JSON.stringify(stable(a))!==JSON.stringify(stable(b)))throw Error('fixture mismatch');};
  const rejects=action=>{checks++;try{action();}catch{return;}throw Error('expected rejection');};
  const hex=s=>Uint8Array.from(s.match(/../g)||[],b=>parseInt(b,16));
  for(const f of vectors){
    const wire=hex(f.hex);
    if(f.direction==='request')equal([...codec.encodeRequest(f.method,JSON.stringify(f.dto))],[...wire]);
    else equal((f.direction==='item'?codec.decodeItem:codec.decodeResponse)(f.method,wire),f.dto);
  }
  for(const f of malformed)for(const end of f.cuts)rejects(()=>(f.direction==='item'?codec.decodeItem:codec.decodeResponse)(f.method,hex(f.hex).subarray(0,end)));
  for(const method of ['GetTaddressBalanceStream','GetBlock','Ping','getLatestBlock','',null,{},1])rejects(()=>codec.encodeRequest(method,{}));
  let getters=0;rejects(()=>codec.encodeRequest('GetTreeState',{get height(){getters++;return '1'}}));equal(getters,0);
  for(const dto of [null,[],{height:1},{height:'01'},{height:'18446744073709551616'},{hash:'a'},{hash:'AA'},{height:null},{height:'1',bad:true}])rejects(()=>codec.encodeRequest('GetTreeState',JSON.stringify(dto)));
  rejects(()=>codec.encodeRequest('GetTaddressBalance',JSON.stringify({addresses:['\ud800']})));
  rejects(()=>codec.encodeRequest('GetBlockRange',JSON.stringify({start:[]})));
  rejects(()=>codec.encodeRequest('SendTransaction',JSON.stringify({data:'aa'.repeat(1024*1024+1)})));
  rejects(()=>codec.decodeResponse('GetLatestBlock',new Uint8Array(4*1024*1024+1)));
  rejects(()=>codec.decodeItem('GetBlockRange',Uint8Array.from(Array(8193).fill([58,0]).flat())));
  rejects(()=>codec.encodeRequest('GetTaddressBalance',JSON.stringify({addresses:Array(8193).fill('a')})));
  for(const bad of [[0],[15],[10,0],[8,128],[18,255,255,255,255,15],[8,255,255,255,255,255,255,255,255,255,2],[163,6,172,6]])rejects(()=>codec.decodeResponse('GetLatestBlock',Uint8Array.from(bad)));
  rejects(()=>codec.decodeResponse('GetLightdInfo',Uint8Array.of(10,1,255)));
  const detached=Uint8Array.of(8,1);structuredClone(detached.buffer,{transfer:[detached.buffer]});rejects(()=>codec.decodeResponse('GetLatestBlock',detached));
  if(typeof SharedArrayBuffer!=='function')throw Error('SharedArrayBuffer control unavailable');
  for(const buffer of [new SharedArrayBuffer(8),Object.setPrototypeOf(new SharedArrayBuffer(8),ArrayBuffer.prototype)])rejects(()=>codec.decodeResponse('GetLatestBlock',new Uint8Array(buffer)));
  const payload=Uint8Array.of(8,1),result=codec.decodeResponse('GetLatestBlock',payload);payload.fill(99);equal(result.height,'1');
  rejects(()=>codec.decodeItem('GetLatestBlock',new Uint8Array()));rejects(()=>codec.decodeResponse('GetMempoolStream',new Uint8Array()));
  // Source-correct unknown fields and known duplicates retain normal protobuf behavior.
  equal(codec.decodeResponse('GetLatestBlock',Uint8Array.of(8,1,8,2,160,6,1)),{height:'2',hash:''});
  equal(codec.decodeResponse('GetTaddressBalance',Uint8Array.of(8,1)),{value_zat:'1'});
  return {ok:true,checks,vectors:vectors.length,malformed:malformed.reduce((n,f)=>n+f.cuts.length,0)};
}
