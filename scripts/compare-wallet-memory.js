// Same installed SDK, engine, options and child-process probe; only asset transport differs.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

assert.equal(process.argv.length, 5, 'usage: node scripts/compare-wallet-memory.js CONSUMER CERT KEY');
const [consumer, cert, key] = process.argv.slice(2).map(value => resolve(value));
const directory = join(consumer, 'node_modules/@zcashlabs/zcash.js/dist/src/runtime/assets/wallet');
const manifestBytes = await readFile(join(directory, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = new Map([['/manifest.json', { bytes: manifestBytes, type: 'application/json' }]]);
for (const file of manifest.files) {
  assert.match(file.url, /^[a-zA-Z0-9_.-]+$/);
  const bytes = await readFile(join(directory, file.url));
  assert.equal(sha(bytes), file.sha256);
  files.set('/' + file.url, { bytes, type: file.mediaType });
}
let requests = 0;
const server = createServer({ cert: await readFile(cert), key: await readFile(key) }, (req, res) => {
  requests++;
  const file = files.get(req.url);
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': file.type, 'content-length': file.bytes.length });
  res.end(file.bytes);
});
const run = promisify(execFile);
const report = { manifestSha256: sha(manifestBytes), node: process.version, runs: [] };
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseline = { manifestUrl: `https://127.0.0.1:${server.address().port}/manifest.json`, manifestSha256: sha(manifestBytes) };
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const mode of ['bundled', 'external']) {
      const before = requests;
      const env = { ...process.env, NODE_EXTRA_CA_CERTS: cert };
      delete env.MEMORY_RUNTIME;
      if (mode === 'external') env.MEMORY_RUNTIME = JSON.stringify(baseline);
      const { stdout } = await run(process.execPath, ['--expose-gc', 'memory.mjs'], { cwd: consumer, env, timeout: 60000 });
      assert.equal(requests - before, mode === 'external' ? manifest.files.length + 1 : 0);
      report.runs.push({ mode, repetition, requests: requests - before, ...JSON.parse(stdout) });
    }
  }
  report.status = 'passed';
  await writeFile(join(consumer, 'memory-comparison.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
