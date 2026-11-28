// Fresh coordinator-owned host run; never attaches to an existing browser/session.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const base = process.argv[2];
if (!base) throw Error('bundle path required');
const logs = '/home/jack/zakura-wallet-storage-logs';
const stamp = Date.now();
const output = fs.openSync(`${logs}/firefox-driver-${stamp}.log`, 'wx');
const port = Number(process.env.WALLET_DRIVER_PORT ?? 19485);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('invalid local driver port');
const endpoint = `http://127.0.0.1:${port}`;
let driver, session, browserPid, socket, finishing = false, sequence = 0;
let startup = Promise.resolve(), cleanup, driverError, outputClosed = false, finishCode = 0;
function checkStartup() {
  if (finishing) throw Error('Firefox startup cancelled');
  if (driverError) throw driverError;
}
const events = [], pending = new Map();
const server = http.createServer((req, res) => {
  if (req.url === '/result' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4000000) req.destroy(); });
    req.on('end', async () => {
      try {
        const result = JSON.parse(body); res.end('recorded');
        // Allow queued realm destruction notifications to reach the host runner.
        await new Promise(r => setTimeout(r, 500));
        const created = events.filter(e => e.method === 'script.realmCreated' && e.params.type === 'dedicated-worker').map(e => e.params.realm);
        const destroyed = new Set(events.filter(e => e.method === 'script.realmDestroyed').map(e => e.params.realm));
        const lifecycle = { created, destroyed: [...destroyed], allWorkersDestroyed: created.length > 0 && created.every(r => destroyed.has(r)) };
        result.lifecycle = lifecycle;
        result.pass = result.pass && lifecycle.allWorkersDestroyed;
        fs.writeFileSync(`${logs}/firefox-result-${stamp}.json`, JSON.stringify({ ...result, base, events }, null, 2));
        console.log(JSON.stringify({ pass: result.pass, tests: result.results?.length, error: result.error, lifecycle, base }));
        await finish(result.pass ? 0 : 1);
      } catch (e) { console.error(e); await finish(1); }
    }); return;
  }
  if (req.url === '/lifecycle' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', async () => {
      try {
        const request = JSON.parse(body);
        if (!/^\/wallet-host\/browser-worker\.mjs\?owner=[a-f0-9-]+$/.test(request.script) || !['created', 'destroyed'].includes(request.state)) throw Error('invalid lifecycle request');
        const origin = `http://127.0.0.1:${server.address().port}`;
        const deadline = Date.now() + 10000;
        for (;;) {
          const created = events.filter(e => e.method === 'script.realmCreated' && e.params.type === 'dedicated-worker' && e.params.origin === origin + request.script);
          if (created.length > 1) throw Error('duplicate worker realm');
          const realm = created[0]?.params;
          if (realm) {
            if (realm.owners?.length !== 1 || !events.some(e => e.method === 'script.realmCreated' && e.params.type === 'window' && e.params.realm === realm.owners[0] && e.params.origin === origin)) throw Error('wrong worker owner');
            if (request.state === 'created' || (request.realm === realm.realm && events.some(e => e.method === 'script.realmDestroyed' && e.params.realm === realm.realm))) {
              res.end(JSON.stringify({ realm: realm.realm, state: request.state, script: request.script })); return;
            }
          }
          if (Date.now() >= deadline) throw Error('lifecycle observation deadline');
          await new Promise(r => setTimeout(r, 20));
        }
      } catch (e) { res.writeHead(500).end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  const name = req.url === '/' ? 'tests/wallet-browser.html' : req.url.slice(1).split('?')[0];
  if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(p => ['', '.', '..'].includes(p))) { res.writeHead(404).end(); return; }
  let body;
  try { body = fs.readFileSync(`${base}/${name}`); } catch { res.writeHead(404).end(); return; }
  const type = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' }[path.extname(name)];
  res.writeHead(200, { 'Content-Type': type ?? 'text/plain', 'Cache-Control': 'no-store' }); res.end(body);
});
async function request(route, method = 'GET', body) {
  const response = await fetch(`${endpoint}${route}`, { method, body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data));
  return data.value;
}
function bidi(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`BiDi timeout ${method}`)); }, 10000);
    pending.set(id, value => { clearTimeout(timer); value.type === 'error' ? reject(Error(JSON.stringify(value))) : resolve(value.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const timer = setTimeout(() => { console.error('external Firefox suite timeout'); void finish(1); }, 180000);
function finish(code) {
  // Join one cleanup, but retain the first failure even if success started it.
  if (!finishCode) finishCode = code;
  if (finishing) return cleanup;
  finishing = true;
  cleanup = (async () => {
    // Every acquisition is bounded. Join it before inspecting resources so a
    // late session response is still deleted, and keep the run deadline active.
    await startup;
    const failed = e => { console.error(`cleanup: ${e.message}`); if (!finishCode) finishCode = 1; };
    try { socket?.close(); } catch (e) { failed(e); }
    if (session) {
      try { await request(`/session/${session}`, 'DELETE'); }
      catch (e) {
        failed(e);
        if (browserPid) { try { process.kill(browserPid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') failed(e); } }
      }
    }
    if (driver?.pid) { try { process.kill(-driver.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') failed(e); } }
    try { server.closeAllConnections(); server.close(); } catch (e) { failed(e); }
    outputClosed = true;
    try { fs.closeSync(output); } catch (e) { failed(e); }
    clearTimeout(timer);
    process.exitCode = finishCode;
  })();
  return cleanup;
}
process.on('uncaughtException', e => { console.error(e); void finish(1); });
process.on('unhandledRejection', e => { console.error(e); void finish(1); });
process.on('SIGTERM', () => void finish(143)); process.on('SIGINT', () => void finish(130));
server.on('error', e => { console.error(e); void finish(1); });
server.listen(0, '127.0.0.1', () => {
  startup = (async () => {
    checkStartup();
    driver = spawn('/snap/bin/geckodriver', ['--host', '127.0.0.1', '--port', String(port), '--websocket-port', '0'], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const readyTimer = setTimeout(() => reject(Error('owned driver startup timeout')), 10000);
      const fail = e => { driverError = e; clearTimeout(readyTimer); reject(e); };
      driver.on('error', fail);
      driver.on('exit', code => fail(Error(`driver exited ${code}`)));
      // Only the spawned child's bind announcement establishes ownership.
      // Never probe a fixed port that may belong to an unrelated driver.
      for (const stream of [driver.stdout, driver.stderr]) {
        let buffered = '';
        stream.on('data', chunk => {
          if (!outputClosed) fs.writeSync(output, chunk);
          buffered += chunk.toString();
          let newline;
          while ((newline = buffered.indexOf('\n')) !== -1) {
            const line = buffered.slice(0, newline).trimEnd();
            buffered = buffered.slice(newline + 1);
            if (line.endsWith(`\tgeckodriver\tINFO\tListening on 127.0.0.1:${port}`)) {
              clearTimeout(readyTimer); resolve();
            }
          }
        });
      }
    });
    checkStartup();
    const value = await request('/session', 'POST', { capabilities: { alwaysMatch: {
      browserName: 'firefox', webSocketUrl: true, acceptInsecureCerts: false, 'moz:firefoxOptions': { args: ['-headless'] },
    } } });
    session = value.sessionId; browserPid = value.capabilities['moz:processID'];
    checkStartup();
    socket = new WebSocket(value.capabilities.webSocketUrl);
    await new Promise((resolve, reject) => {
      const openTimer = setTimeout(() => reject(Error('WebSocket open timeout')), 10000);
      socket.addEventListener('open', () => { clearTimeout(openTimer); resolve(); }, { once: true });
      socket.addEventListener('error', e => { clearTimeout(openTimer); reject(e); }, { once: true });
    });
    checkStartup();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) { const done = pending.get(message.id); pending.delete(message.id); done?.(message); }
      else events.push(message);
    });
    await bidi('session.subscribe', { events: ['script.realmCreated', 'script.realmDestroyed'] });
    checkStartup();
    await request(`/session/${session}/url`, 'POST', { url: `http://127.0.0.1:${server.address().port}/` });
  })().catch(e => { console.error(e); void finish(1); });
  return startup;
});
