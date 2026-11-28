// Assemble packages/react-native (@zcashlabs/zcash.js-native) from a zakura-bindings
// `cargo xtask build-mobile` output: Android jniLibs, the iOS XCFramework, the C
// header and the build receipt. The native revision must equal the SDK's pin so the
// JS glue in dist/react-native and the native library come from one source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

assert.equal(process.argv.length, 3, 'usage: node scripts/build-react-native-package.js MOBILE_BUILD_OUTPUT');
const root = resolve(import.meta.dirname, '..');
const mobile = resolve(process.argv[2]);
const pkg = join(root, 'packages/react-native');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const receipt = JSON.parse(readFileSync(join(mobile, 'native-build.json'), 'utf8'));
assert.equal(receipt.format, 'zakura-native-build/1');
assert.equal(receipt.abiVersion, 1);
const pin = JSON.parse(readFileSync(join(root, 'scripts/native-source.json'), 'utf8'));
const sdk = JSON.parse(readFileSync(join(root, 'dist/react-native/build.json'), 'utf8'));
assert.equal(receipt.revision, sdk.nativeRevision, 'native build and dist/react-native come from different revisions');
if (pin.revision) assert.equal(receipt.revision, pin.revision, 'native build differs from scripts/native-source.json');
for (const [name, hash] of Object.entries(receipt.artifacts)) assert.equal(sha(join(mobile, name)), hash, `artifact ${name}`);
const files = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});

const android = join(mobile, 'android/jniLibs');
const ios = join(mobile, 'ios/ZakuraNative.xcframework');
assert.ok(existsSync(android) || existsSync(ios), 'mobile output has neither android nor ios artifacts');
if (existsSync(android)) {
  rmSync(join(pkg, 'android/src/main/jniLibs'), { recursive: true, force: true });
  cpSync(android, join(pkg, 'android/src/main/jniLibs'), { recursive: true });
  for (const abi of ['arm64-v8a', 'x86_64']) {
    assert.ok(existsSync(join(pkg, 'android/src/main/jniLibs', abi, 'libzakura_bindings_native.so')), `missing ${abi}`);
  }
}
if (existsSync(ios)) {
  rmSync(join(pkg, 'ios/ZakuraNative.xcframework'), { recursive: true, force: true });
  cpSync(ios, join(pkg, 'ios/ZakuraNative.xcframework'), { recursive: true });
}
cpSync(join(mobile, 'include/zakura_native.h'), join(pkg, 'include/zakura_native.h'));
cpSync(join(mobile, 'native-build.json'), join(pkg, 'native-build.json'));
cpSync(join(root, 'licenses'), join(pkg, 'licenses'), { recursive: true });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const companion = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
assert.equal(companion.version, version, 'packages/react-native version must match the SDK');
assert.equal(companion.peerDependencies['@zcashlabs/zcash.js'], version);
console.error(`@zcashlabs/zcash.js-native ${version}: ${files(pkg).filter(p => !p.includes('node_modules'))
  .map(p => relative(pkg, p)).filter(p => p.startsWith('android/src/main/jniLibs') || p.startsWith('ios/ZakuraNative')).length} native files from ${receipt.revision}`);
