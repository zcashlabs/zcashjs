// Offline JS packaging only. The native producer and accepted WASM stay unchanged.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rolldown, VERSION } from '/home/jack/zcash.js/node_modules/rolldown/dist/index.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const acceptedBuilds = {
  'f0e4303aa6e033085f1cd12aefb5947f6ef61e424352d937e4c01ac41fc38a1b': { revision: 'ac9a46a0b499859bb18a6b116f533f91ee8105ee', mode: 'baseline', overlayRevision: '73f88973e72da7627dd6f47834a26d69a2c43cbf' },
  '7e9b335ab3572cdfa4180f51f5136028cdca3f30ae192838da54950d3049df05': { revision: 'ac9a46a0b499859bb18a6b116f533f91ee8105ee', mode: 'threaded', overlayRevision: '73f88973e72da7627dd6f47834a26d69a2c43cbf' },
};
const overlays = ['wallet.mjs', 'views.mjs', 'wallet-host/storage-host.mjs'];
// Version 7 adds the durable abandoned-proposal marker.
// The storage marker stays version 1; the Rust owner migrates legacy files.
export const profile = {
  contractRevision: 'zakura-private-wallet/1', abiVersion: 'checked-bindgen-0.2.128/1',
  schemas: { operations: { walletViews: '6', walletSigner: '2', walletProposals: '2', walletPczt: '4', walletPayments: '2', walletFused: '1', walletScan: '1', walletSync: '2', walletEnhancement: '2', walletQueries: '2', consensusContext: '1', decodeTransaction: '1' },
    protobuf: 'not-used', networkParameters: 'zcash-js-network/1', database: 'wallet-storage/7',
    hostServices: { nodeFilesystem: 'linux-flock/1', browserOpfs: 'sync-access-handle/1', storage: 'scalar-vfs/1' } },
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  : JSON.stringify(value);
function requireThat(ok, message) { if (!ok) throw Error(message); }
const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024 });

/** workerPath contains the complete SDK bootstrap, supplied and reviewed by its owner. */
export async function buildWalletPackage({ nativeBuild, output, workerPath }) {
  const receiptBytes = readFileSync(resolve(nativeBuild, 'build.json'));
  const nativeReceipt = sha(receiptBytes), accepted = acceptedBuilds[nativeReceipt];
  requireThat(accepted, 'accepted native receipt mismatch');
  const receipt = JSON.parse(receiptBytes);
  const { mode, revision: nativeRevision } = accepted, overlayRevision = accepted.overlayRevision ?? nativeRevision;
  requireThat(receipt.complete && receipt.revision === nativeRevision && (receipt.mode ?? 'baseline') === mode, 'native build identity');
  const inputs = {};
  for (const [name, digest] of Object.entries(receipt.artifacts)) {
    const bytes = readFileSync(resolve(nativeBuild, 'bundle', name));
    requireThat(sha(bytes) === digest, `native artifact mismatch: ${name}`);
    inputs[name] = bytes;
  }
  for (const name of overlays) {
    requireThat(inputs[name].equals(git('show', `${nativeRevision}:${name}`)), `native source mismatch: ${name}`);
    inputs[name] = git('show', `${overlayRevision}:${name}`);
  }
  const entry = readFileSync(resolve(root, mode === 'threaded' ? 'runtime/entry.mjs' : 'runtime/entry-baseline.mjs'));
  const sourceNames = ['bindings.js', 'bytes.mjs', 'wallet.mjs', 'views.mjs', 'network.mjs', 'transaction.mjs', 'wallet-host/storage-host.mjs'];
  const virtual = Object.fromEntries(sourceNames.map(name => [name, inputs[name]]));
  virtual['runtime/entry.mjs'] = entry;
  const worker = readFileSync(workerPath);
  requireThat(worker.length > 0, 'empty SDK worker');
  const inspectionBytes = readFileSync(resolve(nativeBuild, 'test-wallet-inspect.log'));
  requireThat(sha(inspectionBytes) === receipt.commands.find(command => command.log === 'test-wallet-inspect.log').sha256, 'memory inspection identity');
  const inspection = JSON.parse(inspectionBytes);
  requireThat(inspection.pass && inspection.sha256 === sha(inputs['bindings_bg.wasm']), 'memory inspection artifact');
  requireThat(inspection.imports.some(item => item.kind === 'memory') === (mode === 'threaded'), 'memory import mode');
  const memory = { initialPages: inspection.memoryPages.initial, maximumPages: inspection.memoryPages.maximum, shared: mode === 'threaded' };
  const graph = { lockSha256: receipt.gitSources['Cargo.lock'], packages: receipt.packages,
    nativePolicy: receipt.nativePolicy, features: receipt.features, environment: receipt.environment,
    ...(mode === 'threaded' ? { threadedToolchain: receipt.threadedToolchain } : {}) };
  const graphBytes = Buffer.from(canonical(graph));
  const compilerFiles = {};
  for (const directory of ['rolldown', '@rolldown/binding-linux-x64-gnu']) {
    const base = `/home/jack/zcash.js/node_modules/${directory}`;
    for (const name of readdirSync(base, { recursive: true }).sort()) {
      if (name.endsWith('.mjs') || name.endsWith('.node') || name === 'package.json') {
        compilerFiles[`${directory}/${name}`] = sha(readFileSync(resolve(base, name)));
      }
    }
  }
  const metadata = Buffer.from(canonical({ format: 'zakura-private-wallet-build/1',
    scope: 'Internal account/address/balance/scan runtime packaging; full H1 runtime unfinished.',
    revision: git('rev-parse', 'HEAD').toString().trim(), overlayRevision: git('rev-parse', overlayRevision).toString().trim(),
    nativeBuildSha256: nativeReceipt, nativeRevision: receipt.revision, nativeTree: receipt.tree,
    sourceSha256: Object.fromEntries([...Object.entries(virtual), ['runtime/package.mjs', readFileSync(fileURLToPath(import.meta.url))]]
      .map(([name, bytes]) => [name, sha(bytes)])),
    workerSha256: sha(worker), compiler: { name: 'rolldown', version: VERSION, files: compilerFiles }, node: process.version,
    memory, dependencyGraphSha256: sha(graphBytes) }));
  const runtimeIdentity = { ...profile, buildSha256: sha(metadata), dependencyGraphSha256: sha(graphBytes), mode, memory };
  virtual['runtime/entry.mjs'] = Buffer.from(`${entry}\nexport const runtimeIdentity = ${canonical(runtimeIdentity)};\n`);
  const bundle = await rolldown({ input: 'runtime/entry.mjs', cwd: '/wallet', platform: 'neutral',
    plugins: [{ name: 'verified-wallet-inputs', resolveId(id, importer) {
      const name = importer ? posix.normalize(posix.join(posix.dirname(importer), id)) : id;
      requireThat(Object.hasOwn(virtual, name), `unlisted module import: ${id}`);
      return name;
    }, load(id) { return virtual[id].toString('utf8'); } }],
    onLog(level, log) { throw Error(`bundler ${level}: ${log.code}`); } });
  let chunk;
  try {
    const result = await bundle.generate({ format: 'es', comments: false });
    requireThat(result.output.length === 1, 'one wallet module required');
    chunk = result.output[0];
    requireThat(chunk.type === 'chunk' && !chunk.imports.length && !chunk.dynamicImports.length, 'closed wallet module required');
    requireThat(!/\b(fetch|import|eval|Function)\s*\(/.test(chunk.code), 'ambient executable loading in wallet module');
  } finally { await bundle.close(); }
  const assets = { 'wallet.mjs': Buffer.from(chunk.code), 'worker.mjs': worker,
    'bindings_bg.wasm': inputs['bindings_bg.wasm'],
    'node-fs.mjs': inputs['wallet-host/node-fs.mjs'], 'opfs.mjs': inputs['wallet-host/opfs.mjs'],
    ...(mode === 'threaded' ? { 'thread-bootstrap.mjs': worker } : {}) };
  const manifest = { format: 'zcash-artifact/1', ...profile, mode,
    buildSha256: sha(metadata), dependencyGraphSha256: sha(graphBytes),
    files: Object.entries(assets).map(([url, bytes]) => ({ url, byteLength: bytes.length, sha256: sha(bytes),
      kind: url === 'wallet.mjs' ? 'module' : url === 'worker.mjs' ? 'worker' : url === 'thread-bootstrap.mjs' ? 'thread-bootstrap' : url.endsWith('.wasm') ? 'wasm' : 'glue',
      mediaType: url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' })) };
  const manifestBytes = Buffer.from(canonical(manifest));
  mkdirSync(output);
  for (const [name, bytes] of Object.entries({ ...assets, 'build.json': metadata, 'dependency-graph.json': graphBytes, 'manifest.json': manifestBytes })) {
    writeFileSync(resolve(output, name), bytes, { flag: 'wx' });
  }
  cpSync(resolve(root, 'LICENSE'), resolve(output, 'LICENSE'));
  cpSync(resolve(root, 'licenses'), resolve(output, 'licenses'), { recursive: true });
  return { output, manifestSha256: sha(manifestBytes), manifest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildWalletPackage({ nativeBuild: process.argv[2], output: process.argv[3], workerPath: process.argv[4] })));
}
