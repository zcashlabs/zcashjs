import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as builder from '../../scripts/build-native-wallet.js';

test('native source pins fetch an exact commit or release and reject a changed checkout', t => {
  const root = mkdtempSync(join(tmpdir(), 'native-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, 'repository'), cache = join(root, 'cache');
  execFileSync('git', ['init', '--quiet', repository]);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
  git('config', 'user.name', 'Synthetic native source test');
  git('config', 'user.email', 'native-source@example.invalid');
  writeFileSync(join(repository, 'source.txt'), 'original');
  git('add', 'source.txt'); git('commit', '--quiet', '-m', 'original');
  const revision = git('rev-parse', 'HEAD');
  git('tag', 'v1.2.3');
  writeFileSync(join(repository, 'source.txt'), 'later commit');
  git('commit', '--quiet', '-am', 'later');

  for (const pin of [{ revision }, { release: 'v1.2.3' }]) {
    let result;
    assert.doesNotThrow(() => { result = builder.checkoutNativeSource({ repository, ...pin }, cache); });
    assert.equal(result.revision, revision);
    assert.equal(readFileSync(join(result.source, 'source.txt'), 'utf8'), 'original');
    assert.deepEqual(builder.checkoutNativeSource({ repository, ...pin }, cache), result);
    writeFileSync(join(result.source, 'source.txt'), 'unreviewed edit');
    assert.throws(() => builder.checkoutNativeSource({ repository, ...pin }, cache), /modified native checkout/);
  }
});

test('ambiguous or mutable native pins fail before fetching or creating a cache', t => {
  const root = mkdtempSync(join(tmpdir(), 'invalid-native-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cache = join(root, 'cache');
  for (const pin of [{}, { revision: 'main' }, { revision: 'a'.repeat(12) },
    { release: 'main' }, { release: 'v1.2.3', revision: 'a'.repeat(40) }]) {
    assert.throws(() => builder.checkoutNativeSource({ repository: root, ...pin }, cache), /native.*pin/);
    assert.equal(existsSync(cache), false);
  }
});
