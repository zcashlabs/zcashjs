import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Run after a /zcashjs/ build. Every mutation is restored, including on failure.
test('built-site validator rejects broken output and preserves external source links', async () => {
  const root = new URL('../', import.meta.url);
  const dist = new URL('docs/.vitepress/dist/', root);
  const run = () => spawnSync(process.execPath,
    ['scripts/check-docs-site.js', '--base', '/zcashjs/'], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const page = new URL('index.html', dist);
  const original = await readFile(page, 'utf8');
  try {
    await writeFile(page, original + '<a href="https://github.com/zcashlabs/zcashjs/blob/main/docs/planning/decision-log.md">Source</a>');
    assert.equal(run().status, 0);
    for (const reference of [
      '<a href="/zcashjs/missing.html">Missing page</a>',
      '<img src="/zcashjs/missing.svg">',
      '<a href="/zcashjs/index.html#missing-anchor">Missing anchor</a>',
      '<a href="/zcashjs/api/host-contract.html">Excluded</a>',
      '<a href="/api/README.html">Wrong base</a>',
    ]) {
      await writeFile(page, original + reference);
      assert.notEqual(run().status, 0, reference);
    }
  } finally {
    await writeFile(page, original);
  }
  const excluded = new URL('api/host-contract.html', dist);
  await writeFile(excluded, '<h1>Historical specification</h1>', { flag: 'wx' });
  try {
    assert.match(run().stderr, /Excluded output/);
  } finally {
    await unlink(excluded);
  }
  const chunks = new URL('assets/chunks/', dist);
  const index = new URL((await readdir(chunks)).find(name => name.startsWith('@localSearchIndex')), chunks);
  const search = await readFile(index, 'utf8');
  try {
    await writeFile(index, 'export default ' + JSON.stringify(JSON.stringify({
      documentIds: { 0: '/planning/decision-log.html#historical' },
    })));
    assert.match(run().stderr, /excluded page/);
  } finally {
    await writeFile(index, search);
  }
  assert.equal(run().status, 0);
});
