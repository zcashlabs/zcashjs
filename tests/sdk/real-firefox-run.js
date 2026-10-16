// Packaged Firefox only; no installs, external providers or security overrides.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputRoot } from '../support/paths.js';
import { bundle } from './real-firefox-build.js';
import { firefoxOptions } from '../support/firefox-options.js';
import { verifiedPacket } from '../clients/public-transaction-reads-packet.js';
import { publicResponse } from './public-client-fixture.js';
import { fixtureResponses, methods } from './light-client-fixture.js';
import { frame, concat, trailer, base64, media, service } from '../clients/grpc-web-fixtures.js';
import { sha, verifyAssets, verifyResult } from './real-firefox-support.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const allowed = ['--logs', '--scratch', '--geckodriver', '--prepare-only'];
for (let i = 0; i < argv.length; i++) {
  assert.ok(allowed.includes(argv[i]), `unknown option ${argv[i]}`);
  if (argv[i] !== '--prepare-only') assert.ok(argv[++i] && !argv[i].startsWith('--'), 'option requires value');
}
const option = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const logs = resolve(option('--logs', join(outputRoot, 'sdk-firefox/logs')));
const scratch = resolve(option('--scratch', join(outputRoot, 'sdk-firefox/scratch')));
const geckodriver = option('--geckodriver', process.env.GECKODRIVER ?? 'geckodriver');
await mkdir(logs, { recursive: true }); await mkdir(scratch, { recursive: true });
const runRoot = await mkdtemp(join(scratch, 'real-firefox-'));
const resultPath = join(logs, `${runRoot.split('/').at(-1)}.json`);
const report = { started: new Date().toISOString(), argv, node: process.version, runRoot,
  status: 'failed', claims: [], limits: 'Accepted partial SDK only. Internal readRpc is test access. Public Network, full LightClient and PublicClient synthetic workflows; no live provider, wallet sync or release completion.' };
const stop = new AbortController();
const deadline = setTimeout(() => stop.abort(Error('suite deadline 120s')), 120000);
const onSignal = () => stop.abort(Error('interrupted'));
process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
const delay = ms => new Promise(done => setTimeout(done, ms));
let server, driver, endpoint, session, browserIdentity, driverIdentity;
let driverText = '', driverError;
const publicRequests = [], lightRequests = [], requests = [], unexpected = [], timers = new Set();
let abortStarted = false;
function command(executable, args, cwd = root) {
  const out = join(runRoot, 'command.stdout'), err = join(runRoot, 'command.stderr');
  const a = openSync(out, 'w'), b = openSync(err, 'w');
  let result;
  try { result = spawnSync(executable, args, { cwd, timeout: 30000, stdio: ['ignore', a, b] }); }
  finally { closeSync(a); closeSync(b); }
  assert.ok(!result.error && result.status === 0, `${executable}: ${result.error || readFileSync(err, 'utf8')}`);
  return readFileSync(out, 'utf8').trim();
}
async function identity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const fields = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ');
    return { pid, start: fields[19], state: fields[0] };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}
async function alive(owned) {
  const current = owned && await identity(owned.pid);
  return !!current && current.start === owned.start && current.state !== 'Z';
}
async function request(route, method = 'GET', body, cleanup = false) {
  const signal = cleanup ? AbortSignal.timeout(5000) : AbortSignal.any([stop.signal, AbortSignal.timeout(45000)]);
  const response = await fetch(endpoint + route, { method, signal, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok && !data.value?.error, `WebDriver ${route}: ${JSON.stringify(data)}`);
  return data.value;
}
try {
  const sourceCommit = command('git', ['rev-parse', 'HEAD']);
  command('npm', ['run', 'build']);
  const [pack] = JSON.parse(command('npm', ['pack', '--offline', '--cache', join(runRoot, 'npm-cache'), '--ignore-scripts', '--json', '--pack-destination', runRoot]));
  assert.ok(pack.files.every(file => !file.path.startsWith('qualification/') && !file.path.startsWith('tests/')));
  const consumer = join(runRoot, 'consumer');
  await mkdir(join(consumer, 'node_modules/@zcashlabs/zcash.js'), { recursive: true });
  // Give the consumer its own package scope, so zcash.js cannot self-resolve to this repo.
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'zcash-browser-test-consumer', private: true, type: 'module' }));
  // Extract the locally packed archive directly; no package install or registry access.
  command('tar', ['-xzf', join(runRoot, pack.filename), '--strip-components=1', '-C', join(consumer, 'node_modules/@zcashlabs/zcash.js')]);
  const packageRoot = join(consumer, 'node_modules/@zcashlabs/zcash.js');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json')));
  assert.deepEqual(Object.keys(manifest.exports), ['.', './grpc-node']);
  assert.equal(manifest.exports['.'].import, './dist/src/index.js');
  assert.deepEqual(manifest.dependencies, { '@grpc/grpc-js': '1.14.4' });
  const entry = join(consumer, 'entry.mjs');
  await writeFile(entry, "import * as sdk from '@zcashlabs/zcash.js';\nimport { readRpc } from './node_modules/@zcashlabs/zcash.js/dist/src/http.js';\nexport { sdk, readRpc };\n");
  const code = await bundle(consumer, stop.signal);
  const packet=await verifiedPacket();
  const vector=packet.vectors.find(value=>value.branch===0x76b809bb);
  assert.ok(vector);
  const light=fixtureResponses(vector);
  const assets = new Map([
    ['/', Buffer.from('<!doctype html><meta charset="utf-8"><title>SDK Firefox qualification</title><link rel="icon" href="data:,">')],
    ['/bundle.mjs', Buffer.from(code)],
    ['/light-vector.json', Buffer.from(JSON.stringify(vector))],
    ...await Promise.all(['sdk/pczt-checks.js','sdk/pczt-fixture.js','sdk/signer-checks.js','sdk/birthday-checks.js','sdk/birthday-fixture.js','sdk/viewing-checks.js','sdk/viewing-fixture.js','sdk/public-client-fixture.js','clients/public-chain-reads-fixtures.js','sdk/light-client-fixture.js','clients/light-chain-reads-fixtures.js','clients/grpc-web-fixtures.js'].map(async name=>['/'+name.replace(/^sdk\//,''),await readFile(new URL('../'+name,import.meta.url))])),
    ['/probe.mjs', await readFile(new URL('./real-firefox-browser.js', import.meta.url))],
    ['/negative-eager.mjs', Buffer.from("new Worker('/forbidden-worker.mjs');")],
    ['/negative-unsupported.mjs', Buffer.from("import { nonexistentTestExport } from '/package/dist/src/index.js'; export { nonexistentTestExport };")],
  ]);
  async function collect(folder, prefix) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (item.isDirectory()) await collect(join(folder, item.name), `${prefix}/${item.name}`);
      else if (/\.m?js$/.test(item.name)) assets.set(`${prefix}/${item.name}`, await readFile(join(folder, item.name)));
    }
  }
  await collect(join(packageRoot, 'dist'), '/package/dist');
  report.inputs = { sourceCommit, tarballSha256: sha(await readFile(join(runRoot, pack.filename))),
    transactionPacket: Object.fromEntries([...packet.files].map(([name,bytes])=>[name,sha(bytes)])),
    manifest, files: Object.fromEntries([...assets].map(([name, bytes]) => [name, { sha256: sha(bytes), bytes: bytes.length }])),
    harness: Object.fromEntries(await Promise.all(['run', 'browser', 'support', 'build'].map(async name => [name,
      sha(await readFile(new URL(`./real-firefox-${name}.js`, import.meta.url)))]))),
    optionsSha256: sha(await readFile(new URL('../support/firefox-options.js', import.meta.url))) };
  verifyAssets(report.inputs, assets);
  // Retain exactly served bytes for coordinator/reviewer inspection.
  for (const [name, bytes] of assets) {
    const path = join(runRoot, 'assets', name === '/' ? 'index.html' : name.slice(1));
    await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes);
  }
  stop.signal.throwIfAborted();
  if (argv.includes('--prepare-only')) {
    report.status = 'prepared-only';
  } else {
    server = createServer(async (req, res) => {
      try {
        if (req.url === '/fixture-state' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ abortStarted, lightRequests, publicRequests })); return;
        }
        if(req.method==='POST' && req.url.startsWith(service)) {
          const method=req.url.slice(service.length),mode=req.headers['x-fixture-mode']??'good';
          assert.ok(methods.includes(method));
          let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<=4*1024*1024);}
          const requestBytes=Buffer.from(body,'base64');
          assert.equal(requestBytes[0],0);assert.equal(requestBytes.readUInt32BE(1),requestBytes.length-5);
          assert.equal(req.headers['content-type'],media);
          if(method==='GetTreeState')assert.equal(requestBytes.subarray(5).toString('hex'),'1220'+'03'.repeat(32),'genesis uses explicit hash selector');
          const observed={method,mode,request:requestBytes.subarray(5).toString('hex'),closed:false};
          lightRequests.push(observed);res.once('close',()=>{observed.closed=true;});
          res.writeHead(200,{'Content-Type':media,'Cache-Control':'no-store'});
          if((mode==='read-stall'&&method==='GetLatestBlock')||(mode==='stream-stall'&&method==='GetBlockRange'&&requestBytes.subarray(5).toString('hex')!=='0a02080112020801')||(mode==='send-stall'&&method==='SendTransaction')) {res.flushHeaders();return;}
          res.end(base64(concat(frame(light.response(method,requestBytes.subarray(5))),trailer())));return;
        }
        if(req.url==='/public-rpc'&&req.method==='POST') {
          let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<=4*1024*1024);}
          const parsed=JSON.parse(body),mode=req.headers['x-fixture-mode']??'good';
          const observed={method:parsed.method,mode,closed:false};publicRequests.push(observed);res.once('close',()=>{observed.closed=true;});
          res.writeHead(200,{'Content-Type':'application/json'});
          if((mode==='read-stall'&&parsed.method==='getrawtransaction')||(mode==='send-stall'&&parsed.method==='sendrawtransaction')){res.write('{');return;}
          res.end(JSON.stringify({jsonrpc:'2.0',id:parsed.id,...publicResponse(parsed,vector,mode)}));return;
        }
        if (req.url === '/rpc' && req.method === 'POST') {
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Error('fixture request too large'); }
          const parsed = JSON.parse(body);
          requests.push({ ...parsed, contentType: req.headers['content-type'], methodHTTP: req.method });
          const mode = parsed.params[0];
          res.writeHead(mode === 'rpc-error' ? 500 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          if (mode === 'deadline' || mode === 'abort') { res.write('{'); if (mode === 'abort') abortStarted = true; return; }
          if (mode === 'invalid') { res.end(Buffer.from([0xff])); return; }
          if (mode === 'rpc-error') { res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id,
            error: { code: -32601, message: 'private-fixture', data: 'private-fixture' } })); return; }
          assert.equal(mode, 'good');
          const bytes = Buffer.from(`{"jsonrpc":"2.0","id":${JSON.stringify(parsed.id)},"result":{"value":9007199254740993,"text":"€雪😀"}}`);
          const split = bytes.indexOf(Buffer.from('€')) + 1;
          res.write(bytes.subarray(0, split));
          const timer = setTimeout(() => { timers.delete(timer); res.end(bytes.subarray(split)); }, 30);
          timers.add(timer); return;
        }
        const bytes = req.method === 'GET' && assets.get(req.url);
        if (!bytes) { unexpected.push({ method: req.method, url: req.url }); res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html' : req.url.endsWith('.json')?'application/json':'text/javascript',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; img-src data:; frame-src 'none'; object-src 'none'" });
        res.end(bytes);
      } catch (error) { unexpected.push({ error: String(error) }); res.destroy(); }
    });
    server.requestTimeout = 5000; server.headersTimeout = 5000;
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const driverArgs = ['--host', '127.0.0.1', '--port', '0', '--websocket-port', '0', '--profile-root', runRoot];
    report.launch = { origin, geckodriver, driverArgs, options: firefoxOptions(), sandbox: 'unchanged' };
    driver = spawn(geckodriver, driverArgs, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    driver.on('error', error => { driverError = error; });
    driver.on('exit', (code, signal) => { driverError = Error(`driver exited ${code}/${signal}`); });
    driverIdentity = await identity(driver.pid);
    for (const stream of [driver.stdout, driver.stderr]) stream.on('data', bytes => { driverText += bytes; });
    const until = Date.now() + 15000;
    while (!endpoint) {
      stop.signal.throwIfAborted(); if (driverError) throw driverError;
      const match = driverText.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (match) endpoint = `http://127.0.0.1:${match[1]}`;
      else { assert.ok(Date.now() < until, 'geckodriver startup deadline'); await delay(30); }
    }
    const value = await request('/session', 'POST', { capabilities: { alwaysMatch: {
      browserName: 'firefox', 'moz:firefoxOptions': firefoxOptions() } } });
    session = value.sessionId; report.capabilities = value.capabilities;
    browserIdentity = await identity(value.capabilities['moz:processID']);
    assert.ok(session && browserIdentity && driverIdentity, 'owned session/process identities');
    assert.equal(value.capabilities.browserName, 'firefox');
    await request(`/session/${session}/timeouts`, 'POST', { script: 20000, pageLoad: 15000, implicit: 0 });
    await request(`/session/${session}/url`, 'POST', { url: origin });
    const result = await request(`/session/${session}/execute/async`, 'POST', {
      script: "const done=arguments[arguments.length-1]; import('/probe.mjs').then(m=>m.run()).then(value=>done({value}),e=>done({error:String(e),stack:e.stack}));", args: [] });
    assert.ok(!result.error, JSON.stringify(result));
    verifyResult(result.value);
    assert.deepEqual(requests.map(r => r.params[0]), ['good', 'deadline', 'abort', 'invalid', 'rpc-error']);
    for (const r of requests) {
      assert.equal(r.jsonrpc, '2.0'); assert.equal(r.method, 'getblockhash');
      assert.equal(typeof r.id, 'string'); assert.ok(r.id.length);
      assert.deepEqual(r.params.slice(1), [7, true, '€']);
      assert.equal(r.contentType, 'application/json'); assert.equal(r.methodHTTP, 'POST');
    }
    // IDs are unique on the same transport; separate transports have independent sequences.
    assert.notEqual(requests[0].id, requests[2].id); assert.notEqual(requests[2].id, requests[3].id);
    assert.deepEqual([...new Set(lightRequests.map(r=>r.method))].sort(),[...methods].sort());
    for(const mode of ['good','send-stall'])assert.equal(lightRequests.filter(r=>r.method==='SendTransaction'&&r.mode===mode).length,2);
    const closeUntil=Date.now()+3000;
    while([...lightRequests,...publicRequests].some(r=>!r.closed)&&Date.now()<closeUntil)await delay(10);
    assert.ok(lightRequests.every(r=>r.closed),'all gRPC-Web responses closed after reads/cancellation');
    assert.ok(publicRequests.every(r=>r.closed),'all public HTTP responses closed after reads/cancellation');
    for(const mode of ['good','send-stall'])assert.equal(publicRequests.filter(r=>r.method==='sendrawtransaction'&&r.mode===mode).length,2);
    report.publicRequests=publicRequests;
    report.lightRequests=lightRequests;
    assert.deepEqual(unexpected, []);
    report.processIdentities = { driver: driverIdentity, browser: browserIdentity };
    report.browserResult = result.value; report.claims = result.value.claims; report.status = 'passed';
  }
} catch (error) {
  report.error = { message: String(error), code: error.code, stack: error.stack };
  if (['EPERM', 'EACCES'].includes(error.code)) report.hostCommand = 'npm run test:sdk:real-firefox';
} finally {
  clearTimeout(deadline);
  const cleanupErrors = [];
  let sessionDeleted = !session;
  if (session) try { await request(`/session/${session}`, 'DELETE', undefined, true); sessionDeleted = true; }
  catch (error) { cleanupErrors.push(String(error)); }
  // Same measured process-group + PID/start-time approach as browser-runtime.
  // Signal only our still-identifiable group leader; never scan/kill by process name.
  if (driverIdentity) {
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const current = await identity(driverIdentity.pid);
      if (!current || current.start === driverIdentity.start) {
        try { process.kill(-driverIdentity.pid, signal); }
        catch (error) { if (error.code !== 'ESRCH') cleanupErrors.push(String(error)); }
      } else cleanupErrors.push('driver PID reused; refusing to signal unrelated group');
      await delay(300);
    }
  }
  if (browserIdentity) for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (await alive(browserIdentity)) try { process.kill(browserIdentity.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') cleanupErrors.push(String(error)); }
    await delay(300);
  }
  let processGroupGone = !driverIdentity;
  const cleanupUntil = Date.now() + 3000;
  while (driverIdentity && !processGroupGone && Date.now() < cleanupUntil) {
    try { process.kill(-driverIdentity.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') processGroupGone = true; else { cleanupErrors.push(String(error)); break; } }
    if (!processGroupGone) await delay(30);
  }
  const browserProcessGone = !await alive(browserIdentity);
  for (const timer of timers) clearTimeout(timer);
  if (server?.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (!sessionDeleted || !processGroupGone || !browserProcessGone || cleanupErrors.length) report.status = 'failed';
  // Finish fallible consumer removal before publishing the final status.
  if (report.status === 'passed') try { await rm(join(runRoot, 'consumer'), { recursive: true, force: true }); }
  catch (error) { cleanupErrors.push(String(error)); report.status = 'failed'; }
  report.cleanup = { sessionDeleted, processGroupGone, browserProcessGone, serverClosed: !server?.listening, cleanupErrors };
  report.requests = requests; report.unexpected = unexpected;
  report.finished = new Date().toISOString();
  await writeFile(resultPath.replace(/\.json$/, '.driver.log'), driverText);
  await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
  process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  console.log(JSON.stringify({ status: report.status, resultPath, error: report.error, hostCommand: report.hostCommand }));
  process.exitCode = ['passed', 'prepared-only'].includes(report.status) ? 0 : 1;
}
