// Build dist/react-native: the SDK for React Native (Hermes), where the Zakura core is
// the native library from zakura-bindings-native instead of WebAssembly.
//
// One closed bundle from dist/src/react-native.js:
// - codec capsules are rebuilt from the pinned bindings JS glue, with every generated
//   wasm-bindgen import resolved to the native binding shim (crates/native/js);
// - native-glue.mjs provides the wallet glue (initializeNativeWalletRuntime, views);
// - bundled WASM/worker assets are not shipped (stub);
// - Node-only dynamic imports with computed specifiers become rejections (Metro
//   cannot bundle them, and those branches never run on React Native).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { rolldown } from 'rolldown';

assert.equal(process.argv.length, 4, 'usage: node scripts/build-react-native.js NATIVE_SOURCE REVISION');
const root = resolve(import.meta.dirname, '..');
const source = resolve(process.argv[2]);
const revision = process.argv[3];
assert.match(revision, /^[a-f0-9]{40}$/);
const dist = join(root, 'dist/src');
const output = join(root, 'dist/react-native');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const glue = name => join(source, name);
const nativeShim = glue('crates/native/js/bindings.mjs');

// Every function the codec and wallet glue import from generated bindings.
const statelessNames = ['transaction_id', 'consensus_branch', 'viewing_open', 'viewing_decode_address',
  'viewing_select_receiver', 'validate_birthday', 'parse_standalone_pczt', 'lightwire_encode', 'lightwire_decode',
  'lightwire_encode_tree_state', 'transparent_address_decode'];
// Named imports the glue takes from generated bindings; owner-bound wallet calls reach
// native runtimes through storage.api, so those module-level names must never be used.
const imported = new Set();
for (const file of ['network.mjs', 'transaction.mjs', 'wallet.mjs', 'views.mjs', 'lightwire/codec.mjs',
  'transparent-address/codec.mjs']) {
  for (const [, names] of readFileSync(glue(file), 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/(?:wasm\/zakura_\w+|bindings)\.js'/g)) {
    for (const name of names.split(',').map(value => value.trim()).filter(Boolean)) imported.add(name);
  }
}
// wallet.mjs also reads members of `import * as binding from './bindings.js'`.
for (const [, name] of readFileSync(glue('wallet.mjs'), 'utf8').matchAll(/\bbinding\.(\w+)/g)) imported.add(name);
imported.delete('initSync');
const ownerBound = [...imported].filter(name => !statelessNames.includes(name)).sort();
const virtual = {
  '\0native-bindings': `import { createStatelessBindings } from ${JSON.stringify(nativeShim)};
let bindings;
const transport = () => {
  const native = globalThis.__zakuraNative;
  if (!native) throw new Error('RUNTIME_UNAVAILABLE');
  return native;
};
const get = () => bindings ??= createStatelessBindings(transport());
export function initSync() {}
${statelessNames.map(name => `export function ${name}(...args) { return get().${name}(...args); }`).join('\n')}
${ownerBound.map(name => `export function ${name}() { throw new Error('RUNTIME_UNAVAILABLE'); }`).join('\n')}
`,
  '\0primitive-capsule': `import { consensusContext, openViewingAuthority, decodeViewingAddress, selectViewingReceiver,
  validateBirthday, parseStandalonePczt } from ${JSON.stringify(glue('network.mjs'))};
import { decodeTransaction } from ${JSON.stringify(glue('transaction.mjs'))};
export function initialize() {}
export { consensusContext, decodeTransaction, openViewingAuthority, decodeViewingAddress, selectViewingReceiver,
  validateBirthday, parseStandalonePczt };
`,
  // The factories validate a byte buffer before calling initSync, which is a no-op natively.
  '\0lightwire-capsule': `import { createLightwire } from ${JSON.stringify(glue('lightwire/codec.mjs'))};
let codec;
export function initialize() { return codec ??= createLightwire(new Uint8Array(1)); }
`,
  '\0transparent-address-capsule': `import { createTransparentAddressCodec } from ${JSON.stringify(glue('transparent-address/codec.mjs'))};
let codec;
export function initialize() { return codec ??= createTransparentAddressCodec(new Uint8Array(1)); }
`,
  '\0native-glue': `export { initializeNativeWalletRuntime } from ${JSON.stringify(glue('wallet.mjs'))};
export { viewsForStorage } from ${JSON.stringify(glue('views.mjs'))};
export { consensusContext } from ${JSON.stringify(glue('network.mjs'))};
export { createRuntimeBindings, createStatelessBindings } from ${JSON.stringify(nativeShim)};
export const expectedNativeRevision = ${JSON.stringify(revision)};
`,
  // React Native ships no WASM/worker/proving assets inside the JS bundle.
  '\0bundled-assets': `export const bundledArtifact = Object.freeze({
  manifestUrl: 'https://react-native.invalid/zakura/manifest.json',
  manifestSha256: '${'0'.repeat(64)}',
});
export const bundledUrls = Object.freeze({});
export const bundledProving = Object.freeze({});
`,
};
const replaced = {
  'runtime/primitive-capsule.mjs': '\0primitive-capsule',
  'runtime/lightwire-capsule.mjs': '\0lightwire-capsule',
  'runtime/transparent-address-capsule.mjs': '\0transparent-address-capsule',
  'runtime/native-glue.mjs': '\0native-glue',
  'runtime/bundled-assets.mjs': '\0bundled-assets',
};

// Check the stub covers every export the real asset index provides.
const realAssets = readFileSync(join(dist, 'runtime/bundled-assets.mjs'), 'utf8');
for (const [, name] of realAssets.matchAll(/export (?:const|function|let) (\w+)/g)) {
  assert.ok(virtual['\0bundled-assets'].includes(`export const ${name} `), `react-native asset stub lacks ${name}`);
}

const { parseSync } = await import('rolldown/experimental');
// Dynamic import() expressions in `code`, found with a parser (method names such as
// `async import(args)` are not imports).
function importExpressions(id, code) {
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'ImportExpression') found.push(node);
    for (const key of Object.keys(node)) if (key !== 'type') walk(node[key]);
  };
  walk(parseSync(id, code, { sourceType: 'module' }).program);
  return found;
}
const inputs = {};
const bundle = await rolldown({
  input: join(dist, 'react-native.js'),
  platform: 'neutral',
  // Hermes has no async generators (or async iteration syntax); ship them lowered
  // rather than relying on the app's Babel preset.
  transform: { target: 'es2017' },
  // package.json declares sideEffects:false; the environment setup is a side effect.
  treeshake: { moduleSideEffects: id => /[\\/]runtime[\\/]react-native-(globals|setup)\.js$/.test(id) },
  plugins: [{
    name: 'react-native',
    resolveId(id, importer) {
      if (Object.hasOwn(virtual, id)) return id;
      if (/(^|\/)bindings\.js$/.test(id) || /wasm\/zakura_(lightwire|transparent_address)\.js$/.test(id)) {
        return '\0native-bindings';
      }
      if (importer && !importer.startsWith('\0') && id.startsWith('.')) {
        const path = resolve(importer, '..', id);
        if (path.startsWith(dist + sep)) {
          const relative = path.slice(dist.length + 1).split(sep).join('/');
          if (Object.hasOwn(replaced, relative)) return replaced[relative];
        }
      }
      return undefined;
    },
    load(id) {
      if (Object.hasOwn(virtual, id)) return virtual[id];
      return undefined;
    },
    transform(code, id) {
      if (id.startsWith('\0')) return undefined;
      inputs[id.startsWith(root) ? id.slice(root.length + 1) : id] = sha(code);
      // Computed dynamic imports only load Node built-ins or staged WASM workers.
      const computed = importExpressions(id, code)
        .filter(node => !(node.source.type === 'Literal' && typeof node.source.value === 'string'));
      if (!computed.length) return undefined;
      let output = code;
      for (const node of computed.sort((a, b) => b.start - a.start)) {
        assert.equal(output.slice(node.start, node.start + 6), 'import', `import expression in ${id}`);
        output = output.slice(0, node.start) + '__zcashUnavailableImport' + output.slice(node.start + 6);
      }
      return { code: output };
    },
  }],
  onLog(level, log) {
    if (log.code === 'CIRCULAR_DEPENDENCY') return;
    // BigInt literals stay as written: Hermes supports BigInt.
    if (log.code === 'TOLERATED_TRANSFORM' && /Big integer literals/.test(log.message)) return;
    throw Error(`${level}: ${log.code} ${log.message}`);
  },
});
try {
  const result = await bundle.generate({
    format: 'es',
    comments: false,
    inlineDynamicImports: true,
    // The companion package installs the JSI transport (globalThis.__zakuraNative) on import.
    banner: [
      "import '@zcashlabs/zcash.js-native';",
      'const __zcashUnavailableImport = () => Promise.reject(new Error(\'RUNTIME_UNAVAILABLE\'));',
    ].join('\n'),
  });
  assert.equal(result.output.length, 1);
  const [chunk] = result.output;
  assert.deepEqual(chunk.imports, [], `react-native bundle imports ${chunk.imports}`);
  const code = chunk.code;
  assert.deepEqual(importExpressions('index.js', code), [], 'react-native bundle keeps a dynamic import');
  assert.ok(!/import\.meta/.test(code), 'react-native bundle uses import.meta');
  assert.ok(code.includes('The encoded data was not valid for encoding utf-8'), 'react-native setup was tree-shaken');
  assert.ok(!/\bWebAssembly\.(instantiate|compile|Module)\b|\bnew WebAssembly\./.test(code)
    || !/atob\('AGFzbQ/.test(code), 'react-native bundle embeds WebAssembly');
  // Top-level await is unsupported by Metro/Hermes.
  {
    const program = parseSync('index.js', code, { sourceType: 'module' }).program;
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(child => walk(child, depth));
      if (/Function|ArrowFunction/.test(node.type ?? '')) return walk(node.body, depth + 1);
      if (node.type === 'AwaitExpression' && depth === 0) throw Error('react-native bundle uses top-level await');
      for (const key of Object.keys(node)) if (key !== 'type') walk(node[key], depth);
    };
    walk(program.body, 0);
  }
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'index.js'), code);
  writeFileSync(join(output, 'index.d.ts'), "export * from '../src/index.js';\n");
  writeFileSync(join(output, 'build.json'), JSON.stringify({
    format: 'zcash-js-react-native/1', nativeRevision: revision, sha256: sha(code),
    generatorSha256: sha(readFileSync(import.meta.filename)), inputs,
  }, null, 2) + '\n');
  console.error(`React Native bundle: dist/react-native/index.js (${(code.length / 1024).toFixed(0)} KiB)`);
} finally {
  await bundle.close();
}
