// A packed, independent Vite application exercising the public SDK in real Firefox.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { firefoxOptions } from '../tests/support/firefox-options.js';

const root = resolve(import.meta.dirname, '..');
const example = process.argv.includes('--example');
const consumer = await mkdtemp(resolve(root, '../zcash-package-consumer-'));
const run = (command, args, cwd = consumer) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', consumer], root));
await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'zcash-installed-browser-acceptance', private: true, type: 'module' }, null, 2));
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(consumer, packed.filename)]);
await writeFile(join(consumer, 'memory.mjs'), `
const samples = {};
const sample = name => { globalThis.gc?.(); samples[name] = process.memoryUsage(); };
sample('beforeImport');
const { createWalletClient, defineNetwork } = await import('@zcashlabs/zcash.js');
sample('afterImport');
const network = await defineNetwork({identity:'memory-probe',genesisHash:'03'.repeat(32),parametersFormat:'zcash-js-network/1',parameters:new TextEncoder().encode(JSON.stringify({encoding:'regtest',Overwinter:10,Sapling:20,Blossom:30,Heartwood:40,Canopy:50,Nu5:60,Nu6:70,Nu6_1:80,Nu6_2:90,Nu6_3:100}))});
const runtime = process.env.MEMORY_RUNTIME ? {baseline:JSON.parse(process.env.MEMORY_RUNTIME)} : undefined;
const wallet = await createWalletClient('http://127.0.0.1:1', {network,storage:{kind:'memory'},...(runtime?{runtime}:{})});
try { await wallet.accounts.list(); sample('walletOpen'); } finally { await wallet.close(); }
sample('walletClosed');
console.log(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,samples}));
`);
const nodeMemory = JSON.parse(run(process.execPath, ['--expose-gc', 'memory.mjs']));
if (process.argv.includes('--node-only')) {
  const report = { consumer, status: 'passed', scope: 'installed Node wallet; no browser run',
    tarballSha256: createHash('sha256').update(await readFile(join(consumer, packed.filename))).digest('hex'),
    packedBytes: packed.size, unpackedBytes: packed.unpackedSize, nodeMemory };
  await writeFile(join(consumer, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  process.exit(0);
}
const fixture = JSON.parse(await readFile(join(root, 'tests/fixtures/wallet/bundle/tests/views-fixture.json')));
await writeFile(join(consumer, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Installed wallet acceptance</title><script type="module" src="/app.js"></script>');
await writeFile(join(consumer, 'app.js'), `
import {createWalletClient, defineNetwork, encodeNetworkParameters} from '@zcashlabs/zcash.js';
window.runWallet = async () => {
  const schedules = [];
  for (const nu7 of [false, true]) {
  const schedule={encoding:'regtest',Overwinter:10,Sapling:20,Blossom:30,Heartwood:40,Canopy:50,Nu5:60,Nu6:70,Nu6_1:80,Nu6_2:90,Nu6_3:100,...(nu7?{Nu7:110}:{})};
  const network = await defineNetwork({identity:'browser-bundled-'+nu7,genesisHash:'03'.repeat(32),...encodeNetworkParameters(schedule)});
  const name='bundled-'+crypto.randomUUID();
  const options={network,storage:{kind:'browser-opfs',name},confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},observation:{pollIntervalMs:1000,maxBufferedUpdates:16},recovery:{mode:'offline'}};
  let account,address;
  try {
    for(const reopened of [false,true]) {
      const wallet=reopened ? await createWalletClient(options)
        : await createWalletClient('https://offline.invalid', {network,storage:options.storage});
      try {
        if(!reopened){account=await wallet.accounts.import({...${JSON.stringify(fixture.import)},birthday:'fullScan'});address=await wallet.addresses.next({accountId:account.id,request:{format:'transparent'}});}
        else {if((await wallet.accounts.get({accountId:account.id})).id!==account.id)throw Error('account persistence');if(!(await wallet.addresses.list({accountId:account.id})).some(item=>item.address===address.address))throw Error('address persistence');}
        if((await wallet.getBalance({accountId:account.id})).amounts!==null)throw Error('unsynced balance');
      } finally { await wallet.close(); }
    }
    schedules.push({format:encodeNetworkParameters(schedule).parametersFormat,persisted:true});
  } finally {await (await navigator.storage.getDirectory()).removeEntry(name,{recursive:true});}
  }
  return {persisted:true,schedules,engine:'bundled',storage:'opfs',userAgent:navigator.userAgent};
};
`);
if (example) {
  for (const name of ['index.html', 'app.js']) {
    await copyFile(join(root, 'examples/browser', name), join(consumer, name));
  }
}
const exampleConfig = example ? (await import('../examples/browser/vite.config.js')).default : {};
await build({ ...exampleConfig, root: consumer, configFile: false, logLevel: 'warn', base: '/nested/',
  build: { target: 'es2022', assetsInlineLimit: 0, ...exampleConfig.build, minify: false } });
const dist = join(consumer, 'dist');
const emitted = {};
for (const name of await readdir(dist, { recursive: true })) {
  const file = join(dist, name);
  if ((await stat(file)).isFile()) emitted[name] = (await stat(file)).size;
}
const requests = [];
const server = createServer(async (req, res) => {
  requests.push(req.url);
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    assert.ok(path.startsWith('/nested/') && !path.includes('..'));
    const name = path.slice('/nested/'.length) || 'index.html';
    const bytes = await readFile(join(dist, name));
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' }[extname(name)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
let driver, session, endpoint;
const report = { consumer, tarballSha256: createHash('sha256').update(await readFile(join(consumer, packed.filename))).digest('hex'), packedBytes: packed.size, unpackedBytes: packed.unpackedSize, emitted, nodeMemory, status: 'failed' };
async function command(route, method = 'GET', body) {
  const response = await fetch(endpoint + route, { method, signal: AbortSignal.timeout(130000), headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  assert.ok(response.ok && !data.value?.error, JSON.stringify(data));
  return data.value;
}
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const profileRoot = join(consumer, 'profiles'); await mkdir(profileRoot);
  driver = spawn(process.env.GECKODRIVER ?? 'geckodriver', ['--host', '127.0.0.1', '--port', '0', '--websocket-port', '0', '--profile-root', profileRoot], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('WebDriver startup timeout')), 15000);
    const capture = chunk => { log += chunk; const match = log.match(/Listening on (127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve('http://' + match[1]); } };
    driver.stdout.on('data', capture); driver.stderr.on('data', capture);
    driver.once('error', error => { clearTimeout(timer); reject(error); });
    driver.once('exit', code => { clearTimeout(timer); reject(Error(`WebDriver exited ${code}: ${log}`)); });
  });
  const created = await command('/session', 'POST', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': firefoxOptions() } } });
  session = created.sessionId;
  await command(`/session/${session}/timeouts`, 'POST', { script: 120000, pageLoad: 30000 });
  await command(`/session/${session}/url`, 'POST', { url: `http://127.0.0.1:${server.address().port}/nested/` });
  report.beforeWallet = [...requests];
  assert.ok(!requests.some(path => /\.wasm|\.params/.test(path)), 'import must not download wallet/proving assets');
  report.wallet = await command(`/session/${session}/execute/async`, 'POST', { script: example ? `
    const done = arguments[arguments.length - 1];
    const form = document.querySelector('#client');
    const result = document.querySelector('#result');
    const name = 'example-' + crypto.randomUUID();
    form.elements.endpoint.value = '';
    form.querySelector('[value=tip]').click();
    if (form.elements.endpoint.validity.valid || result.dataset.state === 'pending') {
      done({ error: 'A chain-tip read must require an endpoint.' }); return;
    }
    form.elements.walletName.value = name;
    const observer = new MutationObserver(async () => {
      if (!['complete', 'error'].includes(result.dataset.state)) return;
      observer.disconnect();
      try {
        const opened = result.dataset.state === 'complete' && result.textContent === '[]';
        await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true });
        done({ opened, storage: 'opfs', error: opened ? null : result.textContent });
      } catch (error) { done({ error: String(error) }); }
    });
    observer.observe(result, { attributes: true });
    form.querySelector('[value=accounts]').click();
  ` : 'const done=arguments[arguments.length-1]; window.runWallet().then(done,error=>done({error:String(error),stack:error.stack}));', args: [] });
  assert.equal(example ? report.wallet.opened : report.wallet.persisted, true, JSON.stringify(report.wallet));
  if (!example) assert.deepEqual(report.wallet.schedules, [
    { format: 'zcash-js-network/1', persisted: true }, { format: 'zcash-js-network/2', persisted: true },
  ]);
  assert.ok(requests.some(path => /\.wasm/.test(path)), 'wallet engine was loaded');
  assert.ok(!requests.some(path => /\.params/.test(path)), 'read-only wallet must not download proving files');
  report.status = 'passed';
} finally {
  try { if (session) await command(`/session/${session}`, 'DELETE'); }
  finally {
    if (driver?.pid) { try { process.kill(-driver.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    report.requests = requests;
    await writeFile(join(consumer, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ consumer, status: report.status, packedBytes: report.packedBytes, wallet: report.wallet }));
  }
}
