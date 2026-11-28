// Test driver only: production APIs and real FS/OPFS backend, synthetic fixtures.
const node = typeof process !== 'undefined' && process.versions?.node;
function diagnose(phase, error) {
  if (!node) self.postMessage({diagnostic:{phase,atMs:performance.now(),source:import.meta.url,...(error?{error:{name:error.name,message:error.message??String(error),stack:error.stack}}:{})}});
}
if (!node) {
  self.addEventListener('error',e=>diagnose('worker-error',e.error??e));
  self.addEventListener('unhandledrejection',e=>diagnose('unhandled-rejection',e.reason));
  self.addEventListener('message',()=>diagnose('message-arrived'));
}
let port, backend, wasm, options;
if (node) {
  const { parentPort, workerData } = await import('node:worker_threads'); port=parentPort; options=workerData;
} else { port={postMessage:v=>self.postMessage(v)}; }
let owner, attempted=false, initializing=false, stopped=false, initializationDone, cancelInitialization;
async function receive(request) {
  diagnose(`receive:${request.op}`);
  let settled=false, finishInitialization,writes=0,reads=0;
  const reply=value=>{if(!settled){settled=true;port.postMessage({id:request.id,...value,writes,reads});}};
  const ensureRunning=()=>{if(stopped)throw Error('ABORTED');};
  try {
    if (request.op==='initialize') {
      if (attempted) throw Error('DOMAIN_USED'); attempted=true;
      ensureRunning();
      if(request.abort==='before')throw Error('ABORTED');
      initializing=true;
      initializationDone=new Promise(resolve=>{finishInitialization=resolve;});
      cancelInitialization=()=>reply({ok:false,error:'ABORTED',commit:'none'});
      diagnose('module-import-start');
      const {initializeViews}=await import('../views.mjs').catch(e=>{diagnose('module-error',e);throw e;});
      diagnose('module-import-complete');
      ensureRunning();
      const {acquire}=await import(node?'../wallet-host/node-fs.mjs':'../wallet-host/opfs.mjs');
      ensureRunning();
      diagnose('backend-acquire-start');
      backend=await acquire(node?options.root:request.root,{create:node?options.create:request.create});
      diagnose('backend-acquire-complete');
      ensureRunning();
      // Synthetic native fixture, seeded under the same exclusive OPFS lease.
      if (!node && request.database) {
        if (!request.create || !(request.database instanceof Uint8Array)) throw Error('INVALID_ARGUMENT');
        const file=backend.open('wallet.db',true);
        if(backend.size(file)!==0)throw Error('FIXTURE_ROOT_NOT_EMPTY');
        if(backend.write(file,request.database,0)!==request.database.length)throw Error('FIXTURE_SHORT_WRITE');
        backend.sync(file);
      }
      diagnose('wasm-read-start');
      if(node){const fs=await import('node:fs');ensureRunning();wasm=new Uint8Array(fs.readFileSync(new URL('../bindings_bg.wasm',import.meta.url)));}
      else {const r=await fetch(new URL('../bindings_bg.wasm',import.meta.url)); if(!r.ok)throw Error('WASM_UNAVAILABLE'); wasm=new Uint8Array(await r.arrayBuffer());}
      diagnose('wasm-read-complete');
      ensureRunning();
      diagnose('initialize-views-start');
      owner=await initializeViews(wasm,backend,request.format,request.parameters,request.genesis);
      diagnose('initialize-views-complete');
      ensureRunning();
      reply({ok:true,generation:owner.generation,instance:owner.instance,secure:!node&&isSecureContext});
    } else if (request.op==='fixture_snapshot') {
      ensureRunning();
      if(!owner)throw Error('DOMAIN_NOT_READY');
      const file=backend.open('wallet.db',false), bytes=new Uint8Array(backend.size(file));
      if(backend.read(file,bytes,0)!==bytes.length)throw Error('FIXTURE_SHORT_READ');
      reply({ok:true,result:bytes});
    } else if (request.op==='close') {
      if(initializing){if(stopped)throw Error('ABORTED');stopped=true;cancelInitialization();const error=await initializationDone;if(error)throw error;}
      else if(!owner){stopped=true;}
      else owner.close(request.generation,request.instance);
      reply({ok:true});
    } else {
      ensureRunning();
      if(!owner)throw Error('DOMAIN_NOT_READY');
      const args=request.args??{}, controller=new AbortController();
      if(request.abort){args.signal=controller.signal;if(request.abort==='before')controller.abort();}
      const sync=backend.sync,write=backend.write,read=backend.read,truncate=backend.truncate,remove=backend.delete;
      backend.read=(...args)=>{reads++;return read(...args);};
      backend.write=(...args)=>{writes++;return write(...args);};
      backend.truncate=(...args)=>{writes++;return truncate(...args);};
      backend.delete=(...args)=>{writes++;return remove(...args);};
      if(request.abort==='duringSync')backend.sync=(...a)=>{const result=sync(...a);controller.abort();return result;};
      if(request.fault==='commit'){let calls=0;backend.sync=(...a)=>{if(++calls===2)throw Object.assign(Error('synthetic commit sync fault'),{code:'EIO'});return sync(...a);};}
      const cryptoObject=globalThis.crypto,random=cryptoObject.getRandomValues;
      if(request.fault==='entropy')cryptoObject.getRandomValues=()=>{throw Error('synthetic entropy unavailable');};
      if(request.fault==='quota')backend.write=()=>{throw Object.assign(Error('synthetic quota fault'),{code:'ENOSPC'});};
      try {const result=owner.call(request.generation,request.instance,request.op,args,request.seed,request.mnemonic,request.passphrase);reply({ok:true,result});}
      finally {request.seed?.fill(0);backend.sync=sync;backend.write=write;backend.read=read;backend.truncate=truncate;backend.delete=remove;cryptoObject.getRandomValues=random;}
    }
  } catch (e) { diagnose(`operation-error:${request.op}`,e); reply({ok:false,error:typeof e==='string'?e:e.code==='EBUSY'||e.name==='NoModificationAllowedError'?'STORAGE_BUSY':e.message,commit:e.commit}); }
  finally {
    for(const secret of [request.mnemonic,request.passphrase])if(secret instanceof Uint8Array && secret.buffer instanceof ArrayBuffer)Uint8Array.prototype.fill.call(secret,0);
    if(finishInitialization){
      let cleanupError;
      if(stopped){try{if(owner)owner.close(owner.generation,owner.instance);else if(backend?.owned)backend.release();}catch(e){cleanupError=e;diagnose('startup-cleanup-error',e);}}
      initializing=false;cancelInitialization=undefined;finishInitialization(cleanupError);
    }
  }
}
if(node)port.on('message',receive); else self.onmessage=e=>receive(e.data);
diagnose('handler-installed');
