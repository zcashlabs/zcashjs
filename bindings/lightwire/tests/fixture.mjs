import { createServer } from 'node:http';
export async function serve(assets, {signal,onCreate}) {
 signal.throwIfAborted();
 const served=[];
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const value=assets.get(path);
  if(req.method!=='GET'||!value){res.writeHead(404).end();return;}
  served.push(path);
  const type=path==='/'?'text/html':path.endsWith('.wasm')?'application/wasm':path.endsWith('.json')?'application/json':'text/javascript';
  res.writeHead(200,{'content-type':type,'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp'}).end(value);
 });
 let closing;
 const fixture={served,close(){return closing??=new Promise((resolve,reject)=>{server.closeAllConnections();server.close(e=>e&&e.code!=='ERR_SERVER_NOT_RUNNING'?reject(e):resolve());});}};
 onCreate(fixture);
 await new Promise((resolve,reject)=>{
  const cancel=()=>{server.close();reject(signal.reason);};
  signal.addEventListener('abort',cancel,{once:true});
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{signal.removeEventListener('abort',cancel);if(signal.aborted){cancel();return;}fixture.origin=`http://127.0.0.1:${server.address().port}`;resolve();});
 });
 return fixture;
}
