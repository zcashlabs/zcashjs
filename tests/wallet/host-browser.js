// Existing client Firefox lifecycle with the real OPFS wallet worker fixture.
import { fixture } from '../clients/public-chain-reads-fixtures.js';
export async function runBrowser() {
  const { attachWalletWorker } = await import('/dist/src/wallet/host.js');
  const { stageWalletWorkers } = await import('/dist/src/runtime/worker-platform.js');
  const code = new TextEncoder().encode("self.onmessage = ({data}) => data.port.postMessage('ready');");
  const platform = await stageWalletWorkers(() => code, true, () => {});
  try {
    for (const name of ['worker.mjs', 'thread-bootstrap.mjs']) {
      const channel = platform.channels();
      let worker;
      try {
        const ready = new Promise((resolve, reject) => {
          channel.port1.onmessage = event => resolve(event.data);
          worker = platform.spawn(name, { message: resolve, error: reject, messageerror: reject });
          worker.postMessage({ port: channel.port2 }, [channel.port2]);
        });
        if (await ready !== 'ready') throw Error('platform worker transfer');
      } finally {
        worker?.removeEvents();
        await worker?.terminate();
        channel.port1.close();
        channel.port2.close();
      }
    }
  } finally {
    platform.dispose();
  }
  for (const url of Object.values(platform.urls)) {
    let revoked = false;
    try { await fetch(url); } catch { revoked = true; }
    if (!revoked) throw Error('platform asset was not revoked');
  }
  const scanTransfer = await (async () => {
    const worker = new Worker('/tests/wallet/scan-transfer-worker.js', { type: 'module' });
    const { port1, port2 } = new MessageChannel();
    const host = attachWalletWorker(port1, async () => worker.terminate(), { maxQueuedJobs: 4, maxQueuedBytes: 65536 });
    worker.onerror = host.crashed;
    try {
      await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data === 'ready' ? resolve() : reject(Error('scan transfer worker'));
        worker.postMessage({ port: port2 }, [port2]);
      });
      const backing = new Uint8Array([1, 2, 3, 4, 5, 6]), repeated = new Uint8Array([7]);
      const args = { target: { height: 100, hash: '03'.repeat(32) }, revision: 'old',
        blocks: [backing.subarray(2, 4), repeated, repeated], priorTreeState: backing.subarray(0, 1) };
      const first = host.scan.ingest(args);
      backing.fill(0); repeated.fill(0);
      if ((await first).revision !== '1,3,4,7,7') throw Error('browser scan transfer bytes');
      if (backing.buffer.byteLength !== 6 || repeated.byteLength !== 1) throw Error('browser caller buffer detached');
      return true;
    } finally { await host.close(); }
  })();
  const fixture = await (await fetch('/fixture.json')).json();
  const root = `sdk-host-${crypto.randomUUID()}`;
  const parameters = new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}');
  let workerDestructions = 0;
  const check = (ok, label) => { if (!ok) throw Error(label); };
  async function open(create) {
    const worker = new Worker('/tests/wallet/host-native-worker.js', { type: 'module' });
    const { port1, port2 } = new MessageChannel();
    const host = attachWalletWorker(port1, async () => { worker.terminate(); workerDestructions++; },
      { maxQueuedJobs: 8, maxQueuedBytes: 65536 });
    worker.onerror = host.crashed;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('OPFS startup deadline')), 15000);
        worker.onmessage = ({ data }) => { clearTimeout(timer); data.ready ? resolve() : reject(Error(data.error)); };
        worker.addEventListener('error', () => { clearTimeout(timer); reject(Error('OPFS worker failed')); }, { once: true });
        worker.postMessage({ port: port2, bundle: new URL('/packet/', location.href).href, root, create,
          format: 'zcash-js-network/1', parameters, genesis: new Uint8Array(32).fill(3) }, [port2]);
      });
    } catch (error) { host.crashed(); await host.close().catch(() => {}); throw error; }
    return host;
  }
  let host = await open(true), account, addresses;
  try {
    const controller = new AbortController(); controller.abort();
    try { await host.accounts.import({ ...fixture.import, birthday: 'fullScan', signal: controller.signal }); throw Error('expected cancellation'); }
    catch (error) { check(error.code === 'ABORTED', 'native pre-admission cancellation'); }
    check((await host.accounts.list()).length === 0, 'cancelled import wrote nothing');
    account = await host.accounts.import({ ...fixture.import, birthday: 'fullScan' });
    const next = await host.addresses.next({ accountId: account.id, request: { format: 'transparent' } });
    addresses = await host.addresses.list({ accountId: account.id });
    check(addresses.some(item => item.address === next.address), 'persisted address');
    const balance = await host.getBalance({ accountId: account.id,
      confirmations: { trusted: 1, untrusted: 1, allowZeroConfirmationShielding: true } });
    check(balance.accountId === account.id && balance.amounts === null && !('scan' in balance), 'native unsynced balance');
  } finally { await host.close(); }
  host = await open(false);
  const same = (a, b) => JSON.stringify(a, (_, v) => typeof v === 'bigint' ? String(v) : v) === JSON.stringify(b, (_, v) => typeof v === 'bigint' ? String(v) : v);
  try {
    check(same(await host.accounts.get({ accountId: account.id }), account), 'OPFS persisted account');
    check(same(await host.addresses.list({ accountId: account.id }), addresses), 'OPFS persisted addresses');
  } finally { await host.close(); }
  await (await navigator.storage.getDirectory()).removeEntry(root, { recursive: true });
  return { workerDestructions, addresses: addresses.length, persisted: true, scanTransfer, userAgent: navigator.userAgent };
}

if (typeof process !== 'undefined' && process.versions?.node) {
  const { default: assert } = await import('node:assert/strict');
  const { spawn } = await import('node:child_process');
  const { readFile, writeFile, mkdir, mkdtemp, readdir } = await import('node:fs/promises');
  const { firefoxOptions } = await import('../support/firefox-options.js');
  const { createHash } = await import('node:crypto');
  const { buildRoot, outputRoot, fixturesRoot } = await import('../support/paths.js');
  const build = buildRoot;
  const logs = process.env.WALLET_HOST_LOGS ?? `${outputRoot}/wallet-host/logs`;
  const scratch = process.env.WALLET_HOST_SCRATCH ?? `${outputRoot}/wallet-host/scratch`;
  await mkdir(logs, { recursive: true }); await mkdir(scratch, { recursive: true });
  const runRoot = await mkdtemp(`${scratch}/firefox-`);
  const reportPath = `${logs}/${runRoot.split('/').at(-1)}.json`;
  const report = { status: 'failed', runRoot, build, sandbox: 'unchanged', started: new Date().toISOString() };
  const stop = new AbortController();
  const deadline = setTimeout(() => stop.abort(), process.env.WALLET_PROVING_PARAMETERS ? 450000 : process.env.WALLET_LOADER ? 150000 : 90000);
  const onSignal = signal => { report.interruptedBy = signal; stop.abort(); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let server, driver, driverIdentity, browserIdentity, session, endpoint, driverError, text = '';
  async function identity(pid) {
    try { const stat = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ');
      return { pid, start: stat[19], state: stat[0] }; }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
  }
  async function request(route, method = 'GET', body, cleanup = false) {
    const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json' },
      signal: cleanup ? AbortSignal.timeout(5000) : AbortSignal.any([stop.signal, AbortSignal.timeout(30000)]),
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.ok(response.ok && !data.value?.error, JSON.stringify(data));
    return data.value;
  }
  try {
    report.sourceCommit = process.env.WALLET_HOST_COMMIT ?? null;
    const packet = process.env.WALLET_NATIVE_BUILD ?? `${fixturesRoot}/wallet`;
    const packetBuild = JSON.parse(await readFile(`${packet}/build.json`));
    const fixtureBytes = await readFile(`${packet}/bundle/tests/views-fixture.json`);
    assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), packetBuild.artifacts['tests/views-fixture.json']);
    const nativeFixture = JSON.parse(fixtureBytes);
    let storageLegacy;
    if(process.env.WALLET_STORAGE_LEGACY){
      const bytes=await readFile(process.env.WALLET_STORAGE_LEGACY);
      report.storageLegacySha256=createHash('sha256').update(bytes).digest('hex');
      storageLegacy=JSON.parse(bytes).find(item=>item.viewOnly===true);
      assert.ok(storageLegacy?.legacyDatabase&&storageLegacy.queries.length,'native legacy fixture');
      assert.ok(process.env.WALLET_THREADED_PACKAGE&&process.env.WALLET_LOADER,'storage faults exercise both packages');
    }
    const {publicWalletFixture}=await import('./public-wallet-fixture.js');
    report.supplementalFixture=await publicWalletFixture(nativeFixture,process.env.WALLET_PUBLIC_FIXTURE);
    const {provingFixture}=await import('./proving-fixture.js');
    const provingAssets=await provingFixture(process.env.WALLET_PROVING_PARAMETERS);
    let signerFixture;
    if(process.env.WALLET_LOADER) {
      const signerBytes=await readFile(process.env.WALLET_SIGNER_FIXTURE ?? `${packet}/bundle/tests/signer-fixture.json`);
      assert.equal(createHash('sha256').update(signerBytes).digest('hex'),packetBuild.sources['tests/signer-fixture.json']);
      signerFixture=JSON.parse(signerBytes);
    }
    const runtimePacket = process.env.WALLET_RUNTIME_PACKAGE;
    const threadedPacket=process.env.WALLET_THREADED_PACKAGE;if(threadedPacket){assert.ok(process.env.WALLET_LOADER);assert.equal(provingAssets.size,0,'threaded lane has no proving workload');}
    const crash=process.env.WALLET_CRASH_DATABASE?{name:`sdk-crash-${runRoot.split('/').at(-1)}`}:undefined;
    if(crash){assert.ok(process.env.WALLET_LOADER);assert.ok(!provingAssets.size&&!process.env.WALLET_WEBPACK_OUTPUT,'crash mode has no proving or Webpack workload');}
    const browserTest = process.env.WALLET_LOADER ? 'loader-browser' : runtimePacket ? 'runtime-browser' : 'host-browser';
    const assets = new Map([
      ['/', '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Wallet bridge fixture</title><script type="module" src="/entry.mjs"></script>'],
      ['/entry.mjs', `import { runBrowser } from '/tests/wallet/${browserTest}.js'; runBrowser().then(value => { window.walletResult = { value }; }, error => { window.walletResult = { error: String(error), stack: error.stack }; });`],
      ['/tests/wallet/host-browser.js', await readFile(new URL(import.meta.url))],
      ['/tests/clients/public-chain-reads-fixtures.js', await readFile(new URL('../clients/public-chain-reads-fixtures.js', import.meta.url))],
    ]);
    assets.set('/tests/wallet/host-native-worker.js', await readFile(new URL('./host-native-worker.js', import.meta.url)));
    assets.set('/tests/wallet/scan-transfer-worker.js', await readFile(new URL('./scan-transfer-worker.js', import.meta.url)));
    const { addBuildAssets } = await import('../support/build-assets.js');
    await addBuildAssets(assets, '/dist');
    for (const name of ['bindings.js', 'bindings_bg.wasm', 'views.mjs', 'wallet.mjs', 'bytes.mjs',
      'wallet-host/storage-host.mjs', 'wallet-host/opfs.mjs']) {
      const bytes = await readFile(`${packet}/bundle/${name}`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), packetBuild.artifacts[name], name);
      assets.set(`/packet/${name}`, bytes);
    }
    if (runtimePacket) {
      assets.set('/tests/wallet/runtime-browser.js', await readFile(new URL('./runtime-browser.js', import.meta.url)));
      const manifestBytes = await readFile(`${runtimePacket}/manifest.json`);
      const manifest = JSON.parse(manifestBytes);
      const metadataBytes = await readFile(`${runtimePacket}/build.json`);
      assert.equal(createHash('sha256').update(metadataBytes).digest('hex'), manifest.buildSha256);
      if(!threadedPacket) assert.equal(createHash('sha256').update(await readFile(`${packet}/build.json`)).digest('hex'), JSON.parse(metadataBytes).nativeBuildSha256);
      report.manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
      assets.set('/runtime/manifest.json', manifestBytes);
      for (const file of manifest.files) {
        const bytes = await readFile(`${runtimePacket}/${file.url}`);
        assert.equal(bytes.length, file.byteLength);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
        assets.set(`/runtime/${file.url}`, bytes);
      }
    }
    if(threadedPacket){
      const bytes=await readFile(threadedPacket+'/manifest.json'),manifest=JSON.parse(bytes),metadata=await readFile(threadedPacket+'/build.json');assert.equal(manifest.mode,'threaded');report.threadedManifestSha256=createHash('sha256').update(bytes).digest('hex');assert.equal(createHash('sha256').update(metadata).digest('hex'),manifest.buildSha256);assert.equal(createHash('sha256').update(await readFile(`${packet}/build.json`)).digest('hex'),JSON.parse(metadata).nativeBuildSha256);assets.set('/threaded/manifest.json',bytes);
      for(const file of manifest.files){const bytes=await readFile(threadedPacket+'/'+file.url);assert.equal(bytes.length,file.byteLength);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);assets.set('/threaded/'+file.url,bytes);}
    }
    if (process.env.WALLET_LOADER) {
      if(storageLegacy){
        for(const name of ['opfs-browser','opfs-faults'])assets.set(`/tests/wallet/${name}.js`,await readFile(new URL(`./${name}.js`,import.meta.url)));
        assets.set('/tests/support/quota-pressure.js',await readFile(new URL('../support/quota-pressure.js',import.meta.url)));
      }
      assets.set('/tests/wallet/threaded-checks.js',await readFile(new URL('./threaded-checks.js',import.meta.url)));
      assets.set('/tests/wallet/public-wallet-checks.js', await readFile(new URL('./public-wallet-checks.js', import.meta.url)));
      assets.set('/tests/wallet/accounts-checks.js', await readFile(new URL('./accounts-checks.js', import.meta.url)));
      assets.set('/tests/wallet/pczt-build-checks.js', await readFile(new URL('./pczt-build-checks.js', import.meta.url)));
      assets.set('/tests/wallet/shielding-checks.js', await readFile(new URL('./shielding-checks.js', import.meta.url)));
      assets.set('/tests/wallet/scan-checks.js', await readFile(new URL('./scan-checks.js', import.meta.url)));
      assets.set('/tests/wallet/loader-browser.js', await readFile(new URL('./loader-browser.js', import.meta.url)));
      for (const name of ['runtime/wallet', 'runtime/artifacts', 'runtime/wallet-profile', 'network-parameters', 'primitives']) {
        assets.set(`/dist/src/${name}.js`, await readFile(`${build}/src/${name}.js`));
      }
      for(const name of ['light-chain-reads-fixtures','grpc-web-fixtures'])assets.set(`/tests/clients/${name}.js`,await readFile(new URL(`../clients/${name}.js`,import.meta.url)));
      assets.set('/runtime-pin.json', JSON.stringify({ manifestSha256: report.manifestSha256,threadedManifestSha256:report.threadedManifestSha256 }));
    }
    if(process.env.WALLET_WEBPACK_OUTPUT){
      assert.ok(process.env.WALLET_LOADER,'Webpack wallet entry uses the existing loader harness');
      const folder=process.env.WALLET_WEBPACK_OUTPUT,receipt=JSON.parse(await readFile(`${folder}/receipt.json`));
      const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),bundle=await readFile(`${folder}/wallet.mjs`);
      assert.equal(receipt.webpack,'5.110.3');assert.equal(digest(bundle),receipt.bundleSha256);
      assert.equal(digest(await readFile(`${folder}/package.tgz`)),receipt.tarballSha256);
      assert.equal(digest(await readFile(new URL('../sdk/consumer.test.js',import.meta.url))),receipt.consumerSha256);
      assert.equal(digest(await readFile(new URL('../../package-lock.json',import.meta.url))),receipt.lockSha256);
      report.webpack=receipt;assets.set('/webpack-wallet.mjs',bundle);
    }
    if(crash){const bytes=await readFile(process.env.WALLET_CRASH_DATABASE);report.crashDatabaseSha256=createHash('sha256').update(bytes).digest('hex');assets.set('/crash-wallet.db',bytes);}
    for(const [name,bytes] of provingAssets)assets.set(name,bytes);
    assets.set('/fixture.json', JSON.stringify({ storageLegacy,crash,webpack:Boolean(process.env.WALLET_WEBPACK_OUTPUT),proving:provingAssets.size>0, shielding:nativeFixture.shielding, pczt:nativeFixture.pczt, signer:signerFixture, import: nativeFixture.import, scan: nativeFixture.scan, enhancement:nativeFixture.enhancement,history:nativeFixture.history }));
    report.assets = Object.fromEntries([...assets].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
    for (const [name, bytes] of assets) {
      const path = `${runRoot}/assets${name === '/' ? '/index.html' : name}`;
      await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true }); await writeFile(path, bytes);
    }
    const tls = process.env.WALLET_TLS_CERT ? { cert: await readFile(process.env.WALLET_TLS_CERT), key: await readFile(process.env.WALLET_TLS_KEY) } : undefined;
    if(process.env.WALLET_LOADER&&(provingAssets.size||crash||threadedPacket)){
      assert.ok(nativeFixture.pczt.publicWallet,'native public wallet fixture');
      const {publicWalletResponses}=await import('./public-wallet-checks.js');
      const {frame,concat,trailer,base64,media,service}=await import('../clients/grpc-web-fixtures.js');
      const definition={identity:'synthetic-regtest',genesisHash:'03'.repeat(32),parametersFormat:'zcash-js-network/1',
        parameters:new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}')};
      const responses=await publicWalletResponses(nativeFixture.pczt,definition),calls=[],unexpected=[];let held,holdTimer;
      report.crash=crash?{before:null,terminated:false}:undefined;
      const {createServer}=await import(tls?'node:https':'node:http');
      const transport=createServer(tls??{},async(req,res)=>{try{
        if(threadedPacket){res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');}
        if(crash&&req.method==='GET'&&req.url==='/crash-evidence'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(report.crash));return;}
        if(req.method==='GET'&&req.url==='/public-wallet-submitted'){
          res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(responses.submitted()));return;
        }
        if(req.method==='POST'&&req.url.startsWith(service)){
          assert.equal(req.headers['content-type'],media);
          let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<=4*1024*1024);}
          const bytes=Buffer.from(body,'base64');assert.ok(bytes.length>=5);assert.equal(bytes[0],0);assert.equal(bytes.readUInt32BE(1),bytes.length-5);
          const method=req.url.slice(service.length),record={method,byteLength:bytes.length,closed:false};calls.push(record);res.once('close',()=>{record.closed=true;});
          const reply=responses.response(method,bytes.subarray(5));
          if(crash&&method==='SendTransaction'&&responses.submitted().length===1){held=res;holdTimer=setTimeout(()=>res.destroy(),60000);return;}
          res.writeHead(200,{'content-type':media,'cache-control':'no-store'});
          res.end(base64(concat(...(reply.payload?[frame(reply.payload)]:[]),trailer(`grpc-status: ${reply.status??0}\r\n`))));return;
        }
        const assetPath=crash?new URL(req.url,'http://fixture.invalid').pathname:req.url;
        if(req.method==='GET'&&assets.has(assetPath)){
          res.writeHead(200,{'content-type':assetPath==='/'?'text/html':req.url.endsWith('.wasm')?'application/wasm':req.url.endsWith('.json')?'application/json':(req.url.startsWith('/proving/')||assetPath.endsWith('.db'))?'application/octet-stream':'text/javascript'});res.end(assets.get(assetPath));return;
        }
        unexpected.push(req.url);res.writeHead(404).end();
      }catch(error){unexpected.push(String(error));res.destroy();}});
      await new Promise((resolve,reject)=>{transport.once('error',reject);transport.listen(0,'127.0.0.1',resolve);});
      server={origin:`${tls?'https':'http'}://127.0.0.1:${transport.address().port}`,calls,unexpected,
        crashReceived:()=>Boolean(held),crashOutstanding:()=>Boolean(held&&!held.destroyed&&!held.writableEnded),destroyHeld(){clearTimeout(holdTimer);held?.destroy();},
        async close(){clearTimeout(holdTimer);held?.destroy();transport.closeAllConnections();await new Promise(resolve=>transport.close(resolve));}};
    }else server = await fixture(() => { throw Error('No RPC in local wallet test'); }, assets, tls);
    report.origin = server.origin;
    const args = ['--host', '127.0.0.1', '--port', '0', '--websocket-port', '0', '--profile-root', runRoot];
    driver = spawn(process.env.GECKODRIVER ?? 'geckodriver', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    driver.on('error', error => { driverError = error; });
    driver.on('exit', (code, signal) => { driverError = Error(`driver exit ${code}/${signal}`); });
    driverIdentity = await identity(driver.pid);
    for (const stream of [driver.stdout, driver.stderr]) stream.on('data', chunk => { text += chunk; });
    const until = Date.now() + 15000;
    while (!endpoint) {
      stop.signal.throwIfAborted(); if (driverError) throw driverError;
      const match = text.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (match) endpoint = `http://127.0.0.1:${match[1]}`;
      else { assert.ok(Date.now() < until, 'driver startup deadline'); await pause(30); }
    }
    const options = firefoxOptions();
    if(storageLegacy)options.prefs={...options.prefs,'dom.quotaManager.temporaryStorage.fixedLimit':32768};
    if(storageLegacy){
      const profile=`${runRoot}/profile`;await mkdir(profile);
      for(const name of ['cert9.db','key4.db','pkcs11.txt'])await writeFile(`${profile}/${name}`,await readFile(`${process.env.WALLET_FIREFOX_PROFILE}/${name}`));
      options.args.push('-profile',profile);
    } else if (process.env.WALLET_FIREFOX_PROFILE) options.args.push('-profile', process.env.WALLET_FIREFOX_PROFILE);
    const value = await request('/session', 'POST', { capabilities: { alwaysMatch: {
      browserName: 'firefox', acceptInsecureCerts: false, 'moz:firefoxOptions': options } } });
    session = value.sessionId; report.capabilities = value.capabilities;
    assert.equal(value.capabilities.browserName, 'firefox');
    assert.equal(value.capabilities.acceptInsecureCerts, false);
    browserIdentity = await identity(value.capabilities['moz:processID']);
    assert.ok(session && driverIdentity && browserIdentity);
    report.processIdentities = { driver: driverIdentity, browser: browserIdentity };
    report.endpoint = endpoint;
    stop.signal.throwIfAborted();
    await request(`/session/${session}/timeouts`, 'POST', { script: 20000, pageLoad: 15000, implicit: 0 });
    await request(`/session/${session}/url`, 'POST', { url: server.origin });
    if(crash){
      const until=Date.now()+60000;
      while(!server.crashReceived()){stop.signal.throwIfAborted();assert.ok(Date.now()<until,'submission receipt deadline');const failure=await request(`/session/${session}/execute/sync`,'POST',{script:'return window.walletResult?.error || window.walletCrashFailure || null;',args:[]});assert.equal(failure,null);await pause(50);}
      assert.equal(server.crashOutstanding(),true,'submission response remains open before native termination');
      report.crash.before=await request(`/session/${session}/execute/sync`,'POST',{script:'if (!window.walletCrashReady || window.walletCrashReady.initializations !== 1 || window.walletCrashSettled || window.walletCrashFailure || window.walletCrashFinish !== 0) throw Error("dispatch no longer outstanding before termination"); if (!(window.walletCrashWorker instanceof Worker)) throw Error("missing captured worker"); window.walletCrashWorker.terminate(); window.walletCrashRestore(); return {...window.walletCrashReady,finishCommands:window.walletCrashFinish,settled:false};',args:[]});
      assert.equal(report.crash.before.initializations,1);assert.equal(report.crash.before.finishCommands,0);assert.equal(report.crash.before.settled,false);report.crash.terminated=true;
      server.destroyHeld();await request(`/session/${session}/url`,'POST',{url:server.origin+'/?reopen=1'});
    }
    let answer;
    // Account, PCZT and shielding workflows add seven owners to the original suite.
    // Allow their actual native work, leaving 30s for startup and cleanup.
    const resultDeadline = Date.now() + (process.env.WALLET_PROVING_PARAMETERS ? 420000 : process.env.WALLET_LOADER ? 120000 : 45000);
    while (!answer) {
      stop.signal.throwIfAborted(); assert.ok(Date.now() < resultDeadline, 'page result deadline');
      answer = await request(`/session/${session}/execute/sync`, 'POST', { script: 'return window.walletResult || null;', args: [] });
      if (!answer) await pause(50);
    }
    assert.ok(!answer.error, JSON.stringify(answer));
    report.browserResult = answer.value;
    assert.deepEqual(server.unexpected, []);
    if(process.env.WALLET_WEBPACK_OUTPUT)assert.equal(answer.value.webpackWallet,true);
    if(process.env.WALLET_LOADER&&provingAssets.size){for(const key of ['publicWallet','publicAbandon','localTransfer','localShield','localTex','startupRecovery','allOperationsRecovery','twoFinalizedRecovery','publicForkReplay','retryBudget',...(report.supplementalFixture?['localIronwood']:[])])assert.equal(answer.value[key],true);assert.ok(server.calls.length>0&&server.calls.every(call=>call.closed),'all native gRPC-Web responses closed');}
    if(crash){assert.equal(createHash('sha256').update(await readFile(process.env.WALLET_CRASH_DATABASE)).digest('hex'),report.crashDatabaseSha256,'source database snapshot unchanged');for(const flag of ['browserDispatchCrash','unknownAttempt','exactRetry','draftUntouched'])assert.equal(answer.value[flag],true);assert.ok(server.calls.every(call=>call.closed));}
    if(process.env.WALLET_LOADER&&!crash&&!threadedPacket){assert.equal(answer.value.offlineSync,true);assert.equal(answer.value.memoryStorage,true);assert.equal(answer.value.publicSync,true);assert.equal(answer.value.emptyCompleted,true);assert.equal(answer.value.queries,true);assert.equal(answer.value.inventory,true);assert.equal(answer.value.pagination,true);assert.equal(answer.value.watchShared,true);assert.equal(answer.value.enhancementPending,true);assert.equal(answer.value.rewoundTo,99);assert.equal(answer.value.enhanced,true);}
    if(storageLegacy){assert.equal(answer.value.storageFaults,true);assert.deepEqual(answer.value.results.map(r=>r.mode),['runtime','threaded']);for(const result of answer.value.results){assert.equal(result.quota.nativeQuota,true);assert.equal(result.write.paused,true);assert.equal(result.migration.paused,true);}}
    else if(threadedPacket){for(const key of ['threadedWallet','threadedScanParity','threadedSignerLifetime','threadedBootstrapCleanup'])assert.equal(answer.value[key],true);assert.ok(answer.value.workerDestructions>answer.value.computeWorkers&&answer.value.computeWorkers>=4);}else assert.equal(answer.value.workerDestructions, crash?1:process.env.WALLET_LOADER ? (provingAssets.size?43+Number(Boolean(report.supplementalFixture))*5:24)+Number(Boolean(process.env.WALLET_WEBPACK_OUTPUT)) : 2);
    report.status = 'passed';
  } catch (error) {
    if (report.interruptedBy) report.status = 'interrupted';
    report.error = { code: error.code, message: String(error), stack: error.stack };
    if(session) try { report.pageDiagnostic=await request(`/session/${session}/execute/sync`,'POST',{script:'return {url:location.href,title:document.title,text:document.body?.innerText?.slice(0,2000),phase:window.walletPhase,phases:window.walletPhases,result:window.walletResult};',args:[]},true); }
    catch(diagnosticError){report.pageDiagnostic={error:String(diagnosticError)};}
  }
  finally {
    clearTimeout(deadline);
    const errors = []; let sessionDeleted = !session, groupGone = !driverIdentity;
    if (session) try { await request(`/session/${session}`, 'DELETE', undefined, true); sessionDeleted = true; }
    catch (error) { errors.push(String(error)); }
    if (driverIdentity) {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        const current = await identity(driverIdentity.pid);
        if (!current || current.start === driverIdentity.start) {
          try { process.kill(-driverIdentity.pid, signal); }
          catch (error) { if (error.code !== 'ESRCH') errors.push(String(error)); }
        } else { errors.push('driver PID reused; refusing group cleanup'); break; }
        await pause(200);
      }
      const cleanupUntil = Date.now() + 3000;
      while (!groupGone && Date.now() < cleanupUntil) {
        try { process.kill(-driverIdentity.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') groupGone = true; else { errors.push(String(error)); break; } }
        if (!groupGone) await pause(30);
      }
    }
    if (server) { report.requests = server.calls; report.unexpected = server.unexpected; await server.close(); }
    const browser = browserIdentity && await identity(browserIdentity.pid);
    const browserGone = !browser || browser.start !== browserIdentity.start || browser.state === 'Z';
    report.cleanup = { sessionDeleted, groupGone, browserGone, serverClosed: true, errors };
    if (!sessionDeleted || !groupGone || !browserGone || errors.length) report.status = 'failed';
    report.finished = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    await writeFile(reportPath + '.driver.log', text);
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    console.log(JSON.stringify({ status: report.status, reportPath, error: report.error }));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
