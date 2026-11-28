// Developer/package build: native compilation is cached; SDK output is always fresh.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildNative } from './build-native-wallet.js';

const root = resolve(import.meta.dirname, '..');
// Keep npm pack --json stdout machine-readable during its prepack hook.
const node = (script, ...args) => execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: ['inherit', 2, 2] });

try {
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  node('node_modules/typescript/bin/tsc', '-p', 'tsconfig.json');
  const native = buildNative();
  const proving = join(root, '.cache/proving');
  mkdirSync(proving, { recursive: true });
  const { saplingAssets } = await import('../dist/src/wallet/proving-assets.js');
  for (const asset of saplingAssets) {
    const path = join(proving, asset.assetId), partial = `${path}.part`;
    const verify = file => {
      const bytes = readFileSync(file);
      assert.equal(bytes.length, asset.byteLength, `proving asset size: ${file}`);
      for (const algorithm of ['sha256', 'blake2b512']) {
        assert.equal(createHash(algorithm).update(bytes).digest('hex'), asset[algorithm], `proving asset ${algorithm}: ${file}`);
      }
    };
    if (!existsSync(path)) {
      try {
        execFileSync('curl', ['--fail', '--location', '--retry', '3', '--output', partial,
          `https://download.z.cash/downloads/${asset.assetId}`], { stdio: 'inherit' });
        verify(partial);
        renameSync(partial, path);
      } finally { rmSync(partial, { force: true }); }
    }
    verify(path);
  }
  const build = join(root, 'build');
  mkdirSync(build, { recursive: true });
  const staging = mkdtempSync(join(build, 'package-'));
  try {
    const worker = join(staging, 'worker.mjs'), runtime = join(staging, 'runtime');
    node('scripts/build-wallet-worker.js', worker);
    node('scripts/package-native-wallet.js', native.output, native.source, worker, runtime);
    node('scripts/primitive-capsule.js', native.output, native.revision);
    // Web/Node builds never load the native glue (React Native replaces this stub), but
    // bundlers resolve the lazy native worker's imports, so export every declared name.
    const declared = readFileSync(join(root, 'src/runtime/native-glue.d.mts'), 'utf8');
    const stub = [...declared.matchAll(/^export (function|const) (\w+)/gm)].map(([, kind, name]) => kind === 'const'
      ? `export const ${name} = 'unversioned';`
      : `export function ${name}() { throw new Error('RUNTIME_UNAVAILABLE'); }`);
    writeFileSync(join(root, 'dist/src/runtime/native-glue.mjs'),
      `// The Zakura native glue exists only in React Native builds.\n${stub.join('\n')}\n`);
    copyFileSync(join(root, 'src/runtime/native-glue.d.mts'), join(root, 'dist/src/runtime/native-glue.d.mts'));
    node('scripts/bundled-assets.js', '--generate', runtime, proving);
    node('scripts/bundled-assets.js');
    node('scripts/build-react-native.js', native.source, native.revision);
  } finally { rmSync(staging, { recursive: true, force: true }); }
  console.error('SDK build complete: dist/');
} catch (error) {
  // Never leave an earlier or partially assembled distribution after a failed build.
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  console.error(`SDK build failed: ${error.message}\nSee docs/api/building-locally.md for prerequisites and cache recovery.`);
  process.exitCode = 1;
}
