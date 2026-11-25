import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./bun-lease-reopen.mjs', import.meta.url));
const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });

test('Bun: a wallet reopens in-process after its worker dies without closing (#34)', t => {
  if (bun.status !== 0) return t.skip('bun is not installed');
  if (!['linux', 'darwin', 'win32'].includes(process.platform)) return t.skip('no filesystem storage host');
  const run = spawnSync('bun', [script], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /reopened/);
});
