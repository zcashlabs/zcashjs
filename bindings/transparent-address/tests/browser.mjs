import {createTransparentAddressCodec} from '/build/codec.mjs';
import {runChecks} from '/runtime.mjs';
try {
 const bytes=new Uint8Array(await(await fetch('/build/wasm/zakura_transparent_address_bg.wasm')).arrayBuffer());
 const fixtures=await(await fetch('/fixtures.json')).json();
 postMessage({...runChecks(createTransparentAddressCodec,bytes,fixtures),worker:true});
 close();
} catch(error){postMessage({ok:false,error:String(error),stack:error.stack});close();}
