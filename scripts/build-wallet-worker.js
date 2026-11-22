// Bundle the compiled production bootstrap; no test RPC or native asset substitution.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

const root = resolve(import.meta.dirname, '..');
const output = process.argv[2];
assert.ok(output, 'exclusive worker output path required');
const bundle = await rolldown({ input: resolve(root, 'dist/src/runtime/wallet-worker.js'), platform: 'neutral',
  external: ['node:worker_threads', 'node:fs', 'node:crypto'],
  onLog(level, log) { throw Error(`${level}: ${log.code}`); },
});
try {
  const result = await bundle.generate({ format: 'es', comments: false });
  assert.equal(result.output.length, 1);
  const chunk = result.output[0];
  assert.equal(chunk.type, 'chunk');
  assert.equal(chunk.imports.length, 0);
  assert.ok(chunk.dynamicImports.every(name => ['node:worker_threads', 'node:fs', 'node:crypto'].includes(name)));
  const inputs = Object.fromEntries(Object.keys(chunk.modules).map(name => {
    const path = relative(root, name);
    assert.ok(path.startsWith('dist/src/'), `unexpected worker input ${path}`);
    return [path, createHash('sha256').update(readFileSync(name)).digest('hex')];
  }));
  writeFileSync(output, chunk.code, { flag: 'wx' });
  writeFileSync(`${output}.inputs.json`, JSON.stringify(inputs, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, sha256: createHash('sha256').update(chunk.code).digest('hex'), inputs }));
} finally { await bundle.close(); }
