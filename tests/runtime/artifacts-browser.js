// Synthetic acquisition fixtures only: these bytes are never executed as runtime code.
export const encode = value => new TextEncoder().encode(value);
export async function sha(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export function canonical(value) {
  if (typeof value === 'string') return JSON.stringify(value).replace(/\\[bfnrt]/g, s => ({ '\\b': '\\u0008', '\\f': '\\u000c', '\\n': '\\u000a', '\\r': '\\u000d', '\\t': '\\u0009' })[s]);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    // UTF-8 lexicographic order equals Unicode scalar order for valid scalar strings.
    const compare = (a, b) => {
      const x = encode(a), y = encode(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
      return x.length - y.length;
    };
    return `{${Object.keys(value).sort(compare).map(k => `${canonical(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export async function fixture(mode = 'baseline') {
  const assets = new Map([
    ['entry.mjs', encode('throw Error("synthetic asset must never execute");')],
    ['worker.mjs', encode('throw Error("synthetic worker must never start");')],
    ['runtime.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])],
    ['deps/雪.mjs', encode('// synthetic glue €雪😀\n')],
  ]);
  if (mode === 'threaded') assets.set('bootstrap.mjs', encode('// synthetic thread bootstrap'));
  const kinds = ['module', 'worker', 'wasm', 'glue', 'thread-bootstrap'];
  const manifest = { format: 'zcash-artifact/1', contractRevision: 'synthetic-contract', abiVersion: 'synthetic-abi',
    schemas: { operations: { runtime_init: 'synthetic-init' }, protobuf: 'synthetic-protobuf', networkParameters: 'synthetic-network-format', database: 'synthetic-db', hostServices: { entropy: 'synthetic-entropy' } },
    buildSha256: await sha(encode('synthetic build identity')), dependencyGraphSha256: await sha(encode('synthetic locked graph')), mode,
    files: await Promise.all([...assets].map(async ([url, bytes], i) => ({ url, sha256: await sha(bytes), byteLength: bytes.length, kind: kinds[i], mediaType: kinds[i] === 'wasm' ? 'application/wasm' : 'text/javascript' }))) };
  const policy = { contractRevision: manifest.contractRevision, abiVersion: manifest.abiVersion, mode,
    schemas: structuredClone(manifest.schemas), maxManifestBytes: 8192, maxAssetBytes: 1024, maxTotalAssetBytes: 4096, maxFiles: 8, timeoutMs: 2000 };
  const bytes = encode(canonical(manifest));
  return { manifest, policy, assets, bytes, artifact: { manifestUrl: 'https://fixture.invalid/release/manifest.json', manifestSha256: await sha(bytes) } };
}

export function assertSanitized(error, targetUrl) {
  const serialized = JSON.stringify([error, error.message, error.stack, error.cause]);
  if ([targetUrl, new URL('.', targetUrl).pathname, 'private-fixture'].some(marker => serialized.includes(marker))) throw Error('URL or foreign error detail leaked');
}

// Shared real-network checks. Node uses its native fetch; Firefox uses browser fetch.
export async function networkChecks(acquireArtifacts, origin) {
  const check = (value, label) => { if (!value) throw Error(label); };
  const observed = [];
  for (const mode of ['good', 'threaded']) {
    const f = await fixture(mode === 'threaded' ? 'threaded' : 'baseline');
    const result = await acquireArtifacts({ ...f.artifact, manifestUrl: `${origin}/release/${mode}/manifest.json` }, f.policy);
    for (const [url, expected] of f.assets) check(await sha(result.copyFile(url)) === await sha(expected), `${mode} bytes`);
    result.dispose(); observed.push(mode);
  }
  for (const [scenario, code] of [['tamper', 'RUNTIME_UNAVAILABLE'], ['glue-tamper', 'RUNTIME_UNAVAILABLE'],
    ['media', 'INVALID_ARGUMENT'], ['short', 'RUNTIME_UNAVAILABLE'], ['long', 'RUNTIME_UNAVAILABLE'],
    ['redirect', 'RUNTIME_UNAVAILABLE'], ['manifest-pin', 'RUNTIME_UNAVAILABLE'], ['oversize', 'RESOURCE_LIMIT'], ['stall', 'TIMEOUT'], ['abort', 'ABORTED']]) {
    const f = await fixture(); const controller = new AbortController();
    let timer;
    if (scenario === 'abort') timer = setTimeout(() => controller.abort(), 150);
    const start = performance.now();
    try {
      await acquireArtifacts({ ...f.artifact, manifestUrl: `${origin}/release/${scenario}/manifest.json` }, { ...f.policy, timeoutMs: scenario === 'stall' ? 150 : 2000 }, controller.signal);
      throw Error(`${scenario} unexpectedly accepted`);
    } catch (error) {
      check(error.code === code && error.stage === (code === 'INVALID_ARGUMENT' ? 'validation' : 'runtime'), `${scenario}: ${error.code}`);
      assertSanitized(error, `${origin}/release/${scenario}/manifest.json`);
      check(performance.now() - start < 4000, 'deadline exceeded');
      observed.push(scenario);
    } finally { clearTimeout(timer); }
  }
  const crossOrigin = new URL(origin);
  crossOrigin.hostname = crossOrigin.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  for (const [scenario, code] of [['cors-gzip', undefined], ['cors-gzip-short', 'RUNTIME_UNAVAILABLE'],
    ['cors-gzip-tamper', 'RUNTIME_UNAVAILABLE'], ['cors-gzip-overflow', 'RESOURCE_LIMIT']]) {
    const f = await fixture();
    const target = `${crossOrigin.origin}/release/${scenario}/manifest.json`;
    if (scenario === 'cors-gzip' && typeof window !== 'undefined') {
      const response = await fetch(target, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      check(response.type === 'cors' && response.headers.get('content-encoding') === null
        && response.headers.get('content-length') !== null, 'compressed CORS header filtering');
      await response.body.cancel();
    }
    let result;
    try {
      result = await acquireArtifacts({ ...f.artifact, manifestUrl: target }, f.policy);
      check(code === undefined, `${scenario} unexpectedly accepted`);
      check(await sha(result.copyManifest()) === await sha(f.bytes), 'compressed manifest bytes');
      for (const [url, expected] of f.assets) check(await sha(result.copyFile(url)) === await sha(expected), `${scenario} bytes`);
    } catch (error) {
      check(code !== undefined && error.code === code && error.stage === 'runtime', `${scenario}: ${error.code}`);
      assertSanitized(error, target);
    } finally { result?.dispose(); }
    observed.push(scenario);
  }
  return observed;
}

export async function run(origin = location.origin) {
  if (!navigator.userAgent.includes('Firefox/')) throw Error('Actual Firefox required');
  if (!isSecureContext) throw Error('Secure browser context required');
  const { acquireArtifacts } = await import('../../dist/src/runtime/artifacts.js');
  // The HTTPS page sets a cookie; credential-free asset requests must omit it.
  document.cookie = 'artifact_synthetic_cookie=1; Secure; SameSite=Strict; Path=/';
  if (!document.cookie.includes('artifact_synthetic_cookie=1')) throw Error('Cookie control failed');
  const checks = await networkChecks(acquireArtifacts, origin);
  return { checks, userAgent: navigator.userAgent, secureContext: isSecureContext, acquisitionOnly: true };
}

// Scoped TLS fixture, reused by Node and the Firefox entrypoint. No test HTTP
// exception, trust bypass, generated runtime, or arbitrary filesystem server.
export async function serveFixture({ cert, key, hostname = 'localhost' }) {
  const { createServer } = await import('node:https');
  const { gzipSync } = await import('node:zlib');
  const { readFile } = await import('node:fs/promises');
  const baseline = await fixture(), threaded = await fixture('threaded');
  const routes = new Map(await Promise.all([
    ['/tests/runtime/artifacts-browser.js', new URL(import.meta.url)],
    ['/dist/src/runtime/artifacts.js', new URL('../../dist/src/runtime/artifacts.js', import.meta.url)],
    ['/dist/src/runtime/bundled-assets.mjs', new URL('../../dist/src/runtime/bundled-assets.mjs', import.meta.url)],
    ['/dist/src/runtime/package-assets.js', new URL('../../dist/src/runtime/package-assets.js', import.meta.url)],
    ['/dist/src/abort.js', new URL('../../dist/src/abort.js', import.meta.url)],
    ['/dist/src/errors.js', new URL('../../dist/src/errors.js', import.meta.url)],
  ].map(async ([path, file]) => [path, await readFile(file)])));
  // The ordinary page module owns imports, fixtures and structuredClone's realm.
  // Dynamic import reports dependency/module evaluation failures in the receipt.
  routes.set('/artifact-page-entry.mjs', `
    window.artifactPageResult = import('/tests/runtime/artifacts-browser.js')
      .then(m => m.run()).then(value => ({ value }), e => ({
        error: String(e).slice(0, 1024), name: String(e?.name ?? '').slice(0, 256),
        message: String(e?.message ?? '').slice(0, 1024), stack: String(e?.stack ?? '').slice(0, 4096)
      }));
  `);
  const requests = [], unexpected = [];
  const server = createServer({ cert: await readFile(cert), key: await readFile(key) }, (req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': `default-src 'none'; script-src 'self'; connect-src 'self' https://${hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${server.address().port}; worker-src 'none'; object-src 'none'; img-src data:` });
      res.end('<!doctype html><meta charset="utf-8"><title>Artifact acquisition</title><link rel="icon" href="data:,"><script type="module" src="/artifact-page-entry.mjs"></script>'); return;
    }
    if (routes.has(req.url)) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(routes.get(req.url)); return; }
    const match = /^\/release\/([a-z-]+)\/(.+)$/.exec(req.url);
    if (!match) { unexpected.push(req.url); res.writeHead(404).end(); return; }
    const [, scenario, encoded] = match;
    const path = decodeURIComponent(encoded);
    const f = scenario === 'threaded' ? threaded : baseline;
    const bytes = path === 'manifest.json' ? f.bytes : f.assets.get(path);
    if (!bytes) { unexpected.push(req.url); res.writeHead(404).end(); return; }
    requests.push({ scenario, path, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null, referer: req.headers.referer ?? null });
    if (scenario.startsWith('cors-gzip')) {
      let decoded = bytes;
      if (path === 'entry.mjs') {
        if (scenario === 'cors-gzip-short') decoded = bytes.subarray(1);
        if (scenario === 'cors-gzip-tamper') { decoded = bytes.slice(); decoded[0] ^= 1; }
        if (scenario === 'cors-gzip-overflow') decoded = new Uint8Array(f.policy.maxAssetBytes + 1);
      }
      const body = gzipSync(decoded);
      res.writeHead(200, { 'access-control-allow-origin': '*', 'content-encoding': 'gzip',
        'content-length': body.length, 'cache-control': 'no-store',
        'content-type': path === 'manifest.json' ? 'application/json' : path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
      res.end(body); return;
    }
    if (scenario === 'redirect' && path === 'manifest.json') { res.writeHead(302, { location: '/forbidden-redirect' }).end(); return; }
    const media = path === 'manifest.json' ? 'application/json' : path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    if (scenario === 'oversize' && path === 'manifest.json') {
      res.writeHead(200, { 'content-type': media }); res.end(new Uint8Array(f.policy.maxManifestBytes + 1)); return;
    }
    if (['stall', 'abort'].includes(scenario) && path === 'manifest.json') {
      res.writeHead(200, { 'content-type': media }); res.write(bytes.subarray(0, 10)); return;
    }
    let body = bytes;
    if ((scenario === 'tamper' && path === 'entry.mjs') || (scenario === 'glue-tamper' && path === 'deps/雪.mjs') || (scenario === 'manifest-pin' && path === 'manifest.json')) { body = bytes.slice(); body[0] ^= 1; }
    if (scenario === 'short' && path === 'entry.mjs') body = bytes.subarray(1);
    if (scenario === 'long' && path === 'entry.mjs') body = new Uint8Array(bytes.length + 1);
    res.writeHead(200, { 'content-type': scenario === 'media' && path === 'entry.mjs' ? 'text/html' : media, 'cache-control': 'no-store' });
    // Exercise real streamed multi-byte UTF-8 and binary response bodies.
    res.write(body.subarray(0, Math.min(7, body.length))); res.end(body.subarray(Math.min(7, body.length)));
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: `https://${hostname}:${server.address().port}`, requests, unexpected,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

// Host entrypoint: use an existing owned WebDriver endpoint and its trusted TLS
// certificate/profile. acceptInsecureCerts is explicitly false. No global trust
// changes, process launcher, dependency install, or browser security preferences.
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { writeFile } = await import('node:fs/promises');
  const { firefoxOptions } = await import('../support/firefox-options.js');
  let server, session;
  const endpoint = process.env.ARTIFACT_WEBDRIVER;
  const result = { status: 'failed', acquisitionOnly: true };
  const request = async (route, method, body) => {
    const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const value = await response.json();
    if (!response.ok || value.value?.error) throw Error(`WebDriver failure: ${JSON.stringify(value)}`);
    return value.value;
  };
  try {
    if (!endpoint || !process.env.ARTIFACT_TLS_CERT || !process.env.ARTIFACT_TLS_KEY) throw Error('Set ARTIFACT_WEBDRIVER, ARTIFACT_TLS_CERT and ARTIFACT_TLS_KEY; Firefox must trust this certificate.');
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw Error('WebDriver must be a credential-free owned loopback endpoint');
    server = await serveFixture({ cert: process.env.ARTIFACT_TLS_CERT, key: process.env.ARTIFACT_TLS_KEY, hostname: process.env.ARTIFACT_TLS_HOSTNAME ?? 'localhost' });
    const options = firefoxOptions();
    if (process.env.ARTIFACT_FIREFOX_PROFILE) options.args.push('-profile', process.env.ARTIFACT_FIREFOX_PROFILE);
    const created = await request('/session', 'POST', { capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: false, 'moz:firefoxOptions': options } } });
    session = created.sessionId;
    result.capabilities = created.capabilities;
    if (created.capabilities.browserName !== 'firefox' || created.capabilities.acceptInsecureCerts !== false) throw Error('Firefox TLS verification required');
    await request(`/session/${session}/timeouts`, 'POST', { script: 20000, pageLoad: 15000 });
    await request(`/session/${session}/url`, 'POST', { url: server.origin });
    const probe = await request(`/session/${session}/execute/async`, 'POST', { script: "const done=arguments[arguments.length-1]; const receipt=window.artifactPageResult; if (!receipt || typeof receipt.then !== 'function') done({error:'Page module entry failed to initialize'}); else receipt.then(done, e=>done({error:String(e).slice(0,1024)}));", args: [] });
    result.pageReceipt = probe;
    if (probe.error) throw Error(probe.error);
    result.probe = probe.value;
    if (server.unexpected.length || server.requests.some(r => r.cookie || r.authorization || r.referer)) throw Error('Unexpected or credential-bearing acquisition request');
    result.status = 'passed';
  } catch (error) { result.error = String(error); }
  finally {
    try { if (session) await request(`/session/${session}`, 'DELETE'); }
    catch (error) { result.status = 'failed'; result.cleanupError = String(error); }
    if (server) { result.requests = server.requests; result.unexpected = server.unexpected; await server.close(); }
    if (process.env.ARTIFACT_BROWSER_RESULT) await writeFile(process.env.ARTIFACT_BROWSER_RESULT, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed' ? 0 : 1;
  }
}
