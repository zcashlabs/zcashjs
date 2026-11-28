// Owned ordinary-page Firefox fixture lifecycle, adapted from the existing gRPC-Web runner.
import { serve } from './fixture.mjs';
async function runFirefox() {
  const { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } = await import('node:fs');
  const { spawn } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const assert = (await import('node:assert/strict')).default;
  const logs = process.argv[3];
  if (!logs || !process.argv[2] || !process.argv[4]) throw Error('usage: firefox.mjs BUILD LOGS SCRATCH');
  const scratch = process.argv[4];
  const report = { control: process.env.TRANSPARENT_ADDRESS_CONTROL ?? null, ok: false, started: new Date().toISOString(), runnerPid: process.pid,
    node: process.versions.node, cleanup: { errors: [] }, trace: [], identities: {} };
  let watcher, profile, sessionRequested = false;
  let receipt, run, fixture, driver, endpoint, session, leader, browser, driverError, driverLog = '';
  const stop = new AbortController();
  const onInt = () => { report.error ??= 'Error: SIGINT'; stop.abort(Error('SIGINT')); };
  const onTerm = () => { report.error ??= 'Error: SIGTERM'; stop.abort(Error('SIGTERM')); };
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  const deadline = setTimeout(() => stop.abort(Error('whole-run timeout')), 90000);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const save = () => { if (receipt) writeFileSync(receipt, JSON.stringify(report, null, 2) + '\n'); };
  const trace = event => { report.trace.push({ event, at: new Date().toISOString() }); save(); };
  // Race even dependencies that fail to settle on abort; no subsequent acquisition runs after this rejects.
  const bounded = async (action, signal = stop.signal) => {
    signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
    try { return await Promise.race([Promise.resolve().then(action), cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  };
  const identity = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ');
      return { pid, parent: Number(fields[1]), group: Number(fields[2]), start: fields[19], state: fields[0] }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const alive = owned => { const now = owned && identity(owned.pid); return !!now && now.start === owned.start && now.state !== 'Z'; };
  const members = new Map();
  const captureGroup = () => {
    if (!leader) return [];
    const current = identity(leader.pid);
    if (current && current.start !== leader.start) throw Error('owned driver PID was reused');
    const group = readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(name => identity(Number(name)))
      .filter(item => item && item.group === leader.pid && item.state !== 'Z');
    // The original leader or a previously captured member must still anchor ownership.
    if (group.length && !alive(leader) && ![...members.values()].some(alive)) throw Error('driver group ownership unavailable');
    for (const item of group) members.set(item.pid, item);
    report.identities.groupMembers = [...members.values()];
    return group;
  };
  const browserRoots = new Map();
  const browserMembers = new Map();
  const captureBrowsers = () => {
    if (!profile || !leader) return;
    const processes = readdirSync('/proc').filter(name => /^\d+$/.test(name))
      .map(name => identity(Number(name))).filter(item => item && item.state !== 'Z');
    for (const item of processes) {
      if (BigInt(item.start) < BigInt(leader.start)) continue;
      let args;
      try { args = readFileSync(`/proc/${item.pid}/cmdline`, 'utf8').split('\0'); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
      // Match exact unique profile argv on launch-chain roots, regardless of process group.
      if (args.some((arg, i) => ['-profile', '--profile'].includes(arg) && args[i + 1] === profile) && alive(item)) {
        const first = !browserRoots.size;
        browserRoots.set(item.pid, item); browserMembers.set(item.pid, item);
        if (first && !browser) report.trace.push({ event: 'browser-owned-before-capabilities', at: new Date().toISOString() });
      }
    }
    // Include children even when they change process group; never follow a reused parent PID.
    let added;
    do {
      added = false;
      for (const item of processes) {
        const parent = browserMembers.get(item.parent);
        if (!browserMembers.has(item.pid) && alive(parent) && BigInt(item.start) >= BigInt(parent.start)) {
          browserMembers.set(item.pid, item); added = true;
        }
      }
    } while (added);
    report.identities.browserRoots = [...browserRoots.values()];
    report.identities.browserMembers = [...browserMembers.values()];
    save();
  };
  const command = async (path, method = 'GET', body, cleanup = false) => {
    const signal = cleanup ? AbortSignal.timeout(5000) : AbortSignal.any([stop.signal, AbortSignal.timeout(45000)]);
    return bounded(async () => {
      const response = await fetch(endpoint + path, { method, headers: { 'content-type': 'application/json' }, signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json(); assert.ok(response.ok && !data.value?.error, JSON.stringify(data)); return data.value;
    }, signal);
  };
  const cleanup = async (name, action) => {
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(Error('cleanup timeout')), 5000);
    try { await bounded(action, limit.signal); report.cleanup[name] = true; }
    catch (error) { report.cleanup[name] = false; report.cleanup.errors.push(`${name}: ${String(error)}`); }
    finally { clearTimeout(timer); }
  };
  try {
    // Publish an incomplete, unique receipt before any asset, server, driver or session acquisition.
    mkdirSync(logs, { recursive: true });
    const receiptDir = mkdtempSync(logs + '/firefox-');
    receipt = receiptDir + '/receipt.json'; report.receipt = receipt;
    report.run = receiptDir; trace('started');
    mkdirSync(scratch, { recursive: true }); run = mkdtempSync(scratch + '/firefox-'); report.run = run;
    profile = run + '/profile'; mkdirSync(profile); report.profile = profile;
    const build = process.argv[2];
    if (!build) throw Error('TRANSPARENT_ADDRESS_BUILD required');
    const packet = JSON.parse(readFileSync(build + '/receipt.json','utf8'));
    if (packet.status !== 'built') throw Error('incomplete build packet');
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    for (const [path, expected] of Object.entries(packet.source)) {
      if (hash(readFileSync(new URL('../'+path,import.meta.url))) !== expected) throw Error('source hash mismatch: '+path);
    }
    const assets = new Map([
      ['/', readFileSync(new URL('./browser.html',import.meta.url))],
      ['/browser.mjs',readFileSync(new URL('./browser.mjs',import.meta.url))],
      ['/runtime.mjs',readFileSync(new URL('./runtime.mjs',import.meta.url))],
      ['/fixtures.json',readFileSync(new URL('./fixtures.json',import.meta.url))],
    ]);
    for (const path of ['codec.mjs','wasm/zakura_transparent_address.js','wasm/zakura_transparent_address_bg.wasm']) {
      const bytes=readFileSync(build+'/'+path);
      if (hash(bytes)!==packet.artifacts[path]) throw Error('artifact hash mismatch: '+path);
      assets.set('/build/'+path,bytes);
    }
    report.buildReceipt=hash(readFileSync(build+'/receipt.json'));
    report.assets=Object.fromEntries([...assets].map(([path,bytes])=>[path,hash(bytes)]));
    report.tools = Object.fromEntries(['/proc/self/exe','/snap/bin/geckodriver','/snap/firefox/current/usr/lib/firefox/firefox','/snap/firefox/current/usr/lib/firefox/geckodriver','/snap/firefox/current/usr/lib/firefox/libxul.so'].map(path => [path,hash(readFileSync(path))]));
    trace('assets-read');
    await bounded(() => serve(assets, { signal: stop.signal, onCreate: owned => { fixture = owned; trace('server-created'); } }));
    report.origin = fixture.origin; trace('server-listening');
    for (const path of ['/favicon.ico','/missing.mjs']) {
      const response = await fetch(fixture.origin + path, {signal:stop.signal});
      assert.equal(response.status,404); await response.arrayBuffer();
    }
    report.missingAssets = true;
    stop.signal.throwIfAborted();
    driver = spawn('/snap/bin/geckodriver', ['--host', '127.0.0.1', '--port', '0', '--websocket-port', '0', '--profile-root', run],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    driver.on('error', error => { driverError = error; stop.abort(error); });
    driver.on('exit', (code, signal) => { driverError = Error(`driver exit ${code}/${signal}`); stop.abort(driverError); });
    for (const stream of [driver.stdout, driver.stderr]) stream.on('data', bytes => { driverLog += bytes; });
    leader = identity(driver.pid); report.identities.driver = leader;
    if (driver.pid) assert.ok(leader && leader.group === driver.pid, 'detached driver identity');
    captureGroup(); trace('driver-spawned');
    if (process.env.TRANSPARENT_ADDRESS_CONTROL === 'acquisition') { trace('control-ready'); await bounded(() => delay(30000)); throw Error('signal control was not interrupted'); }
    const until = Date.now() + 15000;
    while (!endpoint) {
      stop.signal.throwIfAborted(); if (driverError) throw driverError;
      captureGroup();
      const match = driverLog.match(/Listening on (127\.0\.0\.1:\d+)/);
      if (match) endpoint = 'http://' + match[1];
      else { assert.ok(Date.now() < until, 'driver readiness timeout'); await bounded(() => delay(40)); }
    }
    watcher = setInterval(() => { try { captureBrowsers(); } catch (error) { stop.abort(error); } }, 20);
    sessionRequested = true; trace('session-creating');
    const created = await command('/session', 'POST', { capabilities: { alwaysMatch: {
      browserName: 'firefox', acceptInsecureCerts: false, 'moz:firefoxOptions': { args: ['-headless', '-profile', profile] },
    } } });
    session = created.sessionId; report.session = session;
    browser = identity(created.capabilities['moz:processID']); report.identities.browser = browser;
    report.capabilities = created.capabilities;
    report.versions = { browser: created.capabilities.browserVersion, driver: created.capabilities['moz:geckodriverVersion'] };
    assert.ok(session && browser && report.versions.browser && report.versions.driver, 'session identities and versions');
    assert.equal(created.capabilities.acceptInsecureCerts, false);
    captureGroup(); trace('session-created');
    if (process.env.TRANSPARENT_ADDRESS_CONTROL === 'session') { trace('control-ready'); await bounded(() => delay(30000)); throw Error('signal control was not interrupted'); }
    await command(`/session/${session}/timeouts`, 'POST', { script: 30000, pageLoad: 15000 });
    await command(`/session/${session}/url`, 'POST', { url: fixture.origin });
    trace('page-loaded');
    do {
      report.result = await command(`/session/${session}/execute/sync`, 'POST', { script: 'return window.transparentAddressResult || null;', args: [] });
      if (!report.result) await bounded(() => delay(40));
    } while (!report.result);
    assert.equal(report.result.ok, true, JSON.stringify(report.result));
    await bounded(() => delay(100));
    assert.equal(report.result.crossOriginIsolated,true);
    assert.deepEqual([...new Set(fixture.served)].sort(), [...assets.keys()].sort());
    trace('checks-passed');
  } catch (error) { report.error = String(error); }
  finally {
    // Preserve the primary error; independently bound every teardown, even if another fails.
    stop.abort(Error('run finished')); clearTimeout(deadline);
    await cleanup('groupCaptured', () => captureGroup());
    await cleanup('browsersCaptured', captureBrowsers);
    // Start session/server cleanup together; driver teardown does not depend on either succeeding.
    const closing = [cleanup('serverClosed', () => fixture?.close())];
    if (session) closing.push(cleanup('sessionDeleted', () => command(`/session/${session}`, 'DELETE', undefined, true)));
    else report.cleanup.sessionDeleted = null;
    await Promise.all(closing);
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      await cleanup(signal, () => {
        const group = captureGroup();
        if (group.length) try { process.kill(-leader.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      });
      // Firefox can be launched outside the driver's group by a packaged launcher.
      await cleanup('browsersCaptured' + signal, captureBrowsers);
      await cleanup('browser' + signal, () => {
        const errors = [];
        for (const owned of [...browserMembers.values(), browser]) {
          try { if (alive(owned)) process.kill(owned.pid, signal); } catch (error) { if (error.code !== 'ESRCH') errors.push(error); }
        }
        if (errors.length) throw Error(errors.map(String).join('; '));
      });
      await delay(300);
    }
    await cleanup('driverGroupGone', () => assert.equal(captureGroup().length, 0));
    clearInterval(watcher);
    await cleanup('browserGone', () => {
      captureBrowsers();
      assert.ok(!sessionRequested || browser || browserRoots.size, 'browser ownership unobserved during session acquisition');
      assert.equal([...browserMembers.values(), browser].some(alive), false);
    });
    report.served = fixture?.served ?? [];
    report.finished = new Date().toISOString();
    report.ok = !report.error && !report.cleanup.errors.length && report.trace.some(item => item.event === 'checks-passed');
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
    try { if (receipt) writeFileSync(receipt.replace('receipt.json', 'driver.log'), driverLog); }
    catch (error) { report.cleanup.errors.push(String(error)); report.ok = false; }
    try { trace('finished'); } catch (error) { report.ok = false; console.error('receipt write failed:', error); }
    console.log(JSON.stringify(report, null, 2));
    // The receipt is written synchronously before abandoning retained handles.
    if (!report.ok) process.exit(1);
  }
}
if (typeof window === 'undefined') await runFirefox();
