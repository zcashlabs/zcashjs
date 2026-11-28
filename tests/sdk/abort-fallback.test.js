import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { anySignal, timeoutSignal } = await import('../../dist/src/abort.js');

test('fallback anySignal follows the first aborted source and its reason', () => {
  const a = new AbortController(), b = new AbortController();
  const result = anySignal([a.signal, b.signal], { fallback: true });
  assert.equal(result.aborted, false);
  const reason = new Error('second');
  b.abort(reason);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, reason);
  a.abort(new Error('late'));
  assert.equal(result.reason, reason);
});

test('fallback anySignal returns an aborted signal for an already aborted source', () => {
  const a = new AbortController();
  a.abort('done');
  const result = anySignal([new AbortController().signal, a.signal], { fallback: true });
  assert.equal(result.aborted, true);
  assert.equal(result.reason, 'done');
  assert.equal(anySignal([], { fallback: true }).aborted, false);
});

test('fallback anySignal composes and fires abort events once', () => {
  const root = new AbortController();
  const middle = anySignal([root.signal], { fallback: true });
  const leaf = anySignal([middle, new AbortController().signal], { fallback: true });
  let events = 0;
  leaf.addEventListener('abort', () => events++);
  root.abort('stop');
  assert.equal(leaf.aborted, true);
  assert.equal(leaf.reason, 'stop');
  assert.equal(events, 1);
});

test('fallback anySignal does not retain abandoned results on a long-lived source', { skip: typeof globalThis.gc !== 'function' && 'run with --expose-gc' }, async () => {
  const source = new AbortController();
  for (let i = 0; i < 2000; i++) anySignal([source.signal], { fallback: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  globalThis.gc();
  await new Promise(resolve => setTimeout(resolve, 0));
  const kept = anySignal([source.signal], { fallback: true });
  source.abort('x');
  assert.equal(kept.aborted, true);
});

test('timeoutSignal aborts with a TimeoutError', async () => {
  const signal = timeoutSignal(5);
  await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(signal.reason.name, 'TimeoutError');
});

test('SDK modules load and cancel without AbortSignal.any', () => {
  const script = `
    delete AbortSignal.any; delete AbortSignal.timeout;
    const { anySignal, timeoutSignal, bridgeSignal } = await import(${JSON.stringify(new URL('../../dist/src/abort.js', import.meta.url).href)});
    await import(${JSON.stringify(new URL('../../dist/src/index.js', import.meta.url).href)});
    const c = new AbortController();
    const s = anySignal([c.signal]);
    c.abort('r');
    if (!s.aborted || s.reason !== 'r') throw new Error('anySignal fallback failed');
    const t = timeoutSignal(1);
    await new Promise(r => t.addEventListener('abort', r));
    const outer = new AbortController();
    const bridged = await bridgeSignal(outer.signal);
    outer.abort();
    if (!bridged.signal.aborted) throw new Error('bridge failed');
    bridged.close();
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)) });
  assert.equal(run.status, 0, run.stderr);
});
