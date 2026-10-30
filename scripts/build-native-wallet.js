// Fetch and cache the pinned native SDK build. Rust owns native compilation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export const nativeSource = JSON.parse(readFileSync(join(import.meta.dirname, 'native-source.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyNativeBuild(output, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const receipt = JSON.parse(readFileSync(join(output, 'build.json')));
  assert.equal(receipt.format, 'zcash-js-native-build/1');
  assert.equal(receipt.complete, true, 'incomplete native build');
  assert.equal(receipt.revision, revision, 'stale native revision');
  const verify = (directory, artifacts) => {
    assert.ok(artifacts && Object.keys(artifacts).length, 'missing native artifact inventory');
    for (const [name, hash] of Object.entries(artifacts)) {
      assert.ok(!name.includes('..') && !name.startsWith('/'), 'invalid native artifact path');
      assert.equal(sha(readFileSync(join(directory, name))), hash, `native artifact checksum: ${name}`);
    }
  };
  verify(join(output, 'bundle'), receipt.artifacts);
  verify(join(output, 'primitive'), receipt.primitiveArtifacts);
  for (const name of ['lightwire', 'transparent-address']) {
    const bytes = readFileSync(join(output, name, 'receipt.json'));
    assert.equal(sha(bytes), receipt.codecs[name], `native codec receipt: ${name}`);
    const codec = JSON.parse(bytes);
    assert.equal(codec.status, 'built', `incomplete codec: ${name}`);
    verify(join(output, name), codec.artifacts);
  }
  return receipt;
}

export function checkoutNativeSource(input, cache) {
  const commit = Object.hasOwn(input, 'revision');
  assert.notEqual(commit, Object.hasOwn(input, 'release'), 'native source requires exactly one pin');
  const pin = commit ? input.revision : input.release;
  assert.equal(typeof pin, 'string', 'invalid native source pin');
  assert.match(pin, commit ? /^[a-f0-9]{40}$/ : /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/, 'invalid native source pin');
  const directory = join(cache, pin);
  const ref = commit ? pin : `refs/tags/${pin}`;
  const source = join(directory, 'source');
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  if (!existsSync(source)) {
    mkdirSync(source, { recursive: true });
    git('init', '--quiet');
    git('remote', 'add', 'origin', input.repository);
    git('fetch', '--depth', '1', 'origin', commit ? ref : `${ref}:${ref}`);
    git('checkout', '--detach', ref);
  }
  const revision = git('rev-parse', `${ref}^{commit}`);
  assert.equal(git('rev-parse', 'HEAD'), revision, `remove stale native checkout: ${source}`);
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', `modified native checkout: ${source}`);
  return { source, revision };
}

export function buildNative() {
  const cache = join(root, '.cache/native');
  const { source, revision } = checkoutNativeSource(nativeSource, cache);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  const output = join(cache, revision, 'sdk');
  if (!existsSync(join(output, 'build.json'))) {
    // This directory is owned by the build; an interrupted attempt has no receipt.
    rmSync(output, { recursive: true, force: true });
    console.error('Building native components; the first build takes several minutes.');
    execFileSync('cargo', ['xtask', 'build', '--output', output, '--cache', join(cache, 'cache')],
      { cwd: source, stdio: ['inherit', 2, 2] });
  } else {
    console.error('Verifying cached native build.');
  }
  const receipt = verifyNativeBuild(output, revision);
  assert.equal(receipt.tree, git('rev-parse', 'HEAD^{tree}'), 'native source tree');
  assert.equal(receipt.lockSha256, sha(readFileSync(join(source, 'Cargo.lock'))), 'native dependency lock');
  return { source, output, revision };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { buildNative(); }
  catch (error) {
    console.error(`Native build failed: ${error.message}\nSee docs/api/building-locally.md for prerequisites and cache recovery.`);
    process.exitCode = 1;
  }
}
