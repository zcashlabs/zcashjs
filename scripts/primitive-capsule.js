// Build the three self-contained codecs from the pinned native build.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { nativeSource, verifyNativeBuild } from './build-native-wallet.js';

assert.equal(process.argv.length, 4, 'usage: node scripts/primitive-capsule.js NATIVE_BUILD REVISION');
const root = resolve(import.meta.dirname, '..');
const native = resolve(process.argv[2]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeReceipt = verifyNativeBuild(native, process.argv[3]);
const generatorSha256 = sha(await readFile(import.meta.filename));
const lockSha256 = sha(await readFile(join(root, 'package-lock.json')));
const profiles = [
  {
    name: 'primitive', wasm: 'bindings_bg.wasm',
    modules: ['bindings.js', 'bytes.mjs', 'network.mjs', 'transaction.mjs'],
  },
  {
    name: 'lightwire', wasm: 'wasm/zakura_lightwire_bg.wasm', factory: 'createLightwire',
    modules: ['codec.mjs', 'wasm/zakura_lightwire.js'],
  },
  {
    name: 'transparent-address', wasm: 'wasm/zakura_transparent_address_bg.wasm', factory: 'createTransparentAddressCodec',
    modules: ['codec.mjs', 'wasm/zakura_transparent_address.js'],
  },
];
const output = join(root, 'dist/src/runtime');
await mkdir(output, { recursive: true });
for (const profile of profiles) {
  const source = join(native, profile.name);
  const primitive = profile.name === 'primitive';
  const receiptBytes = await readFile(primitive ? join(native, 'build.json') : join(source, 'receipt.json'));
  const receipt = JSON.parse(receiptBytes);
  const inputs = receipt[primitive ? 'primitiveArtifacts' : 'artifacts'];
  const wasm = await readFile(join(source, profile.wasm));
  assert.ok(wasm.length > 0 && wasm.length <= (primitive ? 3 * 1048576 : 1048576));
  const entry = profile.factory
    ? `import {${profile.factory}} from ${JSON.stringify(join(source, 'codec.mjs'))};
let codec;
export function initialize(){return codec??=${profile.factory}(Uint8Array.from(atob('${wasm.toString('base64')}'),c=>c.charCodeAt(0)));}`
    : `import {initialize as initializeNative,consensusContext,openViewingAuthority,decodeViewingAddress,selectViewingReceiver,validateBirthday,parseStandalonePczt} from ${JSON.stringify(join(source, 'network.mjs'))};
import {decodeTransaction} from ${JSON.stringify(join(source, 'transaction.mjs'))};
let initialized=false;
export function initialize(){if(!initialized){initializeNative(Uint8Array.from(atob('${wasm.toString('base64')}'),c=>c.charCodeAt(0)));initialized=true;}}
export {consensusContext,decodeTransaction,openViewingAuthority,decodeViewingAddress,selectViewingReceiver,validateBirthday,parseStandalonePczt};`;
  const bundle = await rolldown({
    input: 'capsule-entry', platform: 'neutral',
    plugins: [{
      name: 'capsule-entry',
      resolveId(id) { if (id === 'capsule-entry') return '\0capsule-entry'; },
      load(id) { if (id === '\0capsule-entry') return entry; },
    }],
    onLog(level, log) { throw Error(`${level}: ${log.code}`); },
  });
  try {
    const result = await bundle.generate({ format: 'es', comments: false });
    assert.equal(result.output.length, 1);
    const chunk = result.output[0];
    assert.equal(chunk.type, 'chunk');
    assert.deepEqual(chunk.imports, []);
    assert.deepEqual(chunk.dynamicImports, []);
    const modules = Object.keys(chunk.modules).filter(name => name !== '\0capsule-entry').map(name => {
      assert.ok(name.startsWith(source + '/'));
      return name.slice(source.length + 1);
    }).sort();
    assert.deepEqual(modules, profile.modules);
    // Generated URL/fetch initialization must be removed from the closed codec.
    assert.ok(!/\bfetch\s*\(|import\.meta|\bimport\s*\(/.test(chunk.code));
    const code = chunk.code.replace(/^\/\/#(?:end)?region[^\n]*\n/gm, '');
    await writeFile(join(output, `${profile.name}-capsule.mjs`), code);
    await writeFile(join(output, `${profile.name}-capsule.json`), JSON.stringify({
      format: 'zcash-js-pure-codec-capsule/1', profile: profile.name,
      generatorSha256, lockSha256, nativeReceipt: sha(receiptBytes),
      nativeRelease: nativeSource.release ?? null, nativeRevision: nativeReceipt.revision,
      inputs, modules, sha256: sha(code),
    }, null, 2) + '\n');
    await copyFile(join(root, `src/runtime/${profile.name}-capsule.d.mts`),
      join(output, `${profile.name}-capsule.d.mts`));
  } finally { await bundle.close(); }
}
