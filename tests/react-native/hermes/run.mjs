// Run dist/react-native on the Hermes engine React Native pins, through the real JSI
// module over the native library. Inputs (built separately, see README):
//   HERMES_SRC, HERMES_BUILD   Hermes source and CMake build (targets hermes, libhermes)
//   RN_ROOT                    the react-native package (CallInvoker headers)
//   POLYFILLS                  node_modules with abort-controller and react-native-url-polyfill
//   NATIVE                     a `cargo xtask build-mobile --targets host` output
//   BABEL                      node_modules with @babel/core and @react-native/babel-preset
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rolldown } from 'rolldown';

const here = import.meta.dirname, root = resolve(here, '../../..');
const env = name => { const value = process.env[name]; assert.ok(value, `${name} is required`); return resolve(value); };
const [hermesSrc, hermesBuild, rnRoot, polyfills, native, babelModules] =
  ['HERMES_SRC', 'HERMES_BUILD', 'RN_ROOT', 'POLYFILLS', 'NATIVE', 'BABEL'].map(env);
const out = join(root, 'build/hermes-run');
mkdirSync(out, { recursive: true });

// 1. The bundle Hermes evaluates (one script, as Metro produces).
const bundle = await rolldown({
  input: join(here, 'entry.mjs'),
  // Resolve the polyfills' CommonJS dependencies as Metro does.
  platform: 'browser',
  // Metro evaluates every imported module; package.json sideEffects:false must not
  // drop the environment setup (Metro does not tree-shake).
  treeshake: { moduleSideEffects: true },
  transform: { target: 'es2017' },
  // Metro's resolution: react-native, browser, then main (never `module`).
  resolve: { modules: [polyfills, join(root, 'node_modules')], mainFields: ['react-native', 'browser', 'main'] },
  plugins: [{
    // package.json sideEffects:false would otherwise drop the import-only setup modules.
    name: 'keep-side-effects',
    async resolveId(id, importer, options) {
      if (id.startsWith('\0') || options?.custom?.keep) return undefined;
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true, custom: { keep: true } });
      return resolved && !resolved.external ? { ...resolved, moduleSideEffects: true } : resolved;
    },
  }, {
    name: 'companion',
    // The host installs the JSI transport exactly as the TurboModule's install() does.
    resolveId: id => id === '@zcashlabs/zcash.js-native' ? '\0companion'
      : id === 'react-native' ? '\0react-native' : undefined,
    load: id => id === '\0companion' ? 'export {};'
      // What react-native-url-polyfill reads from React Native (Android values).
      : id === '\0react-native' ? "export const Platform = { OS: 'android', Version: 34 }; export const NativeModules = {};"
        : undefined,
  }],
  onLog(level, log) { if (log.code !== 'CIRCULAR_DEPENDENCY' && log.code !== 'EVAL') console.error(`${level}: ${log.message}`); },
});
await bundle.write({ file: join(out, 'bundle.raw.js'), format: 'iife', inlineDynamicImports: true });
await bundle.close();
// Metro runs every module, node_modules included, through React Native's Babel preset
// with the Hermes profile before Hermes compiles it.
const { createRequire } = await import('node:module');
const babelRequire = createRequire(join(babelModules, 'noop.js'));
const babel = babelRequire('@babel/core');
const transformed = babel.transformFileSync(join(out, 'bundle.raw.js'), {
  babelrc: false, configFile: false, sourceType: 'script', compact: false,
  presets: [[babelRequire.resolve('@react-native/babel-preset'),
    { unstable_transformProfile: 'hermes-stable', enableBabelRuntime: false, dev: false }]],
});
writeFileSync(join(out, 'bundle.js'), transformed.code);

// 2. The host: Hermes + JSI module + native library.
const host = join(out, 'zakura-hermes-host');
execFileSync('g++', ['-std=c++20', '-O1', join(here, 'host.cpp'), join(root, 'packages/react-native/cpp/ZakuraJsi.cpp'),
  '-I', join(hermesSrc, 'API'), '-I', join(hermesSrc, 'API/jsi'), '-I', join(hermesSrc, 'public'),
  '-I', join(rnRoot, 'ReactCommon/callinvoker'), '-I', join(root, 'packages/react-native/cpp'),
  '-I', join(root, 'packages/react-native/include'),
  '-L', join(hermesBuild, 'API/hermes'), '-lhermes', '-L', join(hermesBuild, 'jsi'), '-ljsi',
  '-L', join(native, 'host'), '-lzakura_bindings_native',
  `-Wl,-rpath,${join(hermesBuild, 'API/hermes')}:${join(hermesBuild, 'jsi')}:${join(native, 'host')}`, '-pthread', '-o', host], { stdio: 'inherit' });

// 3. Run.
const scratch = mkdtempSync(join(tmpdir(), 'zcash-hermes-'));
try {
  const output = execFileSync(host, [join(out, 'bundle.js'), scratch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 600000 });
  const results = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(results.engine, 'hermes');
  assert.equal(results.wasm, 'undefined');
  assert.deepEqual(results.viewing, { operations: 7, independentAuthorities: 3, cancelled: 2, unknownReceivers: true });
  assert.ok(results.birthday && results.pczt && results.signer);
  assert.equal(results.example.length, 4);
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
