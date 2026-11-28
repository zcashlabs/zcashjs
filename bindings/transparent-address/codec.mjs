import {initSync, transparent_address_decode} from './wasm/zakura_transparent_address.js';
const apply=Reflect.apply, U8=Uint8Array, freeze=Object.freeze;
const typed=Object.getPrototypeOf(U8.prototype);
const get=(prototype,key)=>Object.getOwnPropertyDescriptor(prototype,key).get;
const tag=get(typed,Symbol.toStringTag), buffer=get(typed,'buffer'), length=get(typed,'byteLength'), offset=get(typed,'byteOffset');
const bufferLength=get(ArrayBuffer.prototype,'byteLength'), values=typed.values, slice=typed.slice;
const charCodeAt=String.prototype.charCodeAt;
const decoder=new TextDecoder('ascii',{fatal:true}), textDecode=TextDecoder.prototype.decode;
let initialized=false;
export function createTransparentAddressCodec(wasmBytes) {
 if(initialized)throw Error('transparent address module already initialized');
 if(apply(tag,wasmBytes,[])!=='Uint8Array')throw TypeError('expected Uint8Array');
 const backing=apply(buffer,wasmBytes,[]),size=apply(length,wasmBytes,[]),start=apply(offset,wasmBytes,[]);
 apply(bufferLength,backing,[]); // Reject SharedArrayBuffer, including disguised backing stores.
 apply(values,wasmBytes,[]); // Validate the original view: reject detached and out-of-bounds views.
 if(size>16*1024*1024)throw RangeError('WASM byte limit');
 const owned=new U8(new U8(backing,start,size));
 initSync({module:owned});initialized=true;
 return freeze({decode(token,family){
  if(typeof family!=='string'||(family!=='main'&&family!=='test'&&family!=='regtest'))throw TypeError('invalid encoding family');
  if(typeof token!=='string')throw TypeError('expected primitive address string');
  if(token.length===0||token.length>128)throw RangeError('address token length');
  for(let i=0;i<token.length;i++){const c=apply(charCodeAt,token,[i]);if(c<33||c>126)throw TypeError('invalid address token');}
  const result=transparent_address_decode(token,family);
  return {kind:result[0]===0?'p2pkh':'p2sh',payload:apply(slice,result,[1,21]),canonical:apply(textDecode,decoder,[apply(slice,result,[21])])};
 }});
}
