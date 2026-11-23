// Owner-lease check for wallet-host/node-fs.mjs under the current runtime (Node or Bun)
// and platform (Linux, macOS or Windows): a second owner is refused until the first releases.
// Usage: node tests/node-fs-lock.mjs   |   bun tests/node-fs-lock.mjs
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

if (!isMainThread) {
  const { acquire } = await import(new URL('../wallet-host/node-fs.mjs', import.meta.url));
  let host;
  parentPort.on('message', (op) => {
    try {
      if (op === 'acquire') host = acquire(workerData.root, { create: true });
      if (op === 'release') host.release();
      if (op === 'operations') {
        // The SQLite VFS sequence: create, write, sync, close; reopen read-only and
        // read-write; truncate; delete a journal; probe access.
        const enc = new TextEncoder();
        let fd = host.open('wallet.db', true, false);
        host.write(fd, enc.encode('hello world'), 0); host.sync(fd); host.close(fd);
        fd = host.open('wallet.db', false, true);
        const buf = new Uint8Array(5); host.read(fd, buf, 6); host.close(fd);
        if (new TextDecoder().decode(buf) !== 'world') throw Error('read mismatch');
        fd = host.open('wallet.db', false, false);
        host.truncate(fd, 5); if (host.size(fd) !== 5) throw Error('truncate mismatch'); host.close(fd);
        const journal = host.open('wallet.db-journal', true, false);
        host.write(journal, enc.encode('j'), 0); host.sync(journal); host.close(journal);
        host.delete('wallet.db-journal', true);
        if (host.access('wallet.db-journal', 0) || !host.access('wallet.db', 1)) throw Error('access mismatch');
      }
      parentPort.postMessage({ ok: true });
    } catch (error) {
      parentPort.postMessage({ ok: false, code: error.code, message: error.message });
    }
  });
} else {
  const root = mkdtempSync(join(tmpdir(), 'node-fs-lock-'));
  const spawn = () => new Worker(new URL(import.meta.url), { workerData: { root } });
  const ask = (worker, op) => new Promise((resolve) => { worker.once('message', resolve); worker.postMessage(op); });
  const a = spawn(), b = spawn();
  assert.deepEqual(await ask(a, 'acquire'), { ok: true });
  assert.deepEqual(await ask(a, 'operations'), { ok: true });
  const busy = await ask(b, 'acquire');
  assert.equal(busy.ok, false);
  assert.equal(busy.code, 'EBUSY');
  assert.deepEqual(await ask(a, 'release'), { ok: true });
  assert.deepEqual(await ask(b, 'acquire'), { ok: true });
  // A worker that dies without releasing must not leave the lease held. Node closes
  // the worker's descriptors (trackUnmanagedFds); Bun currently does not, so there
  // the lease persists until the process exits (zcashlabs/zcashjs#34).
  await b.terminate();
  const c = spawn();
  const after = await ask(c, 'acquire');
  if (process.versions.bun) assert.equal(after.code, 'EBUSY');
  else assert.deepEqual(after, { ok: true });
  await Promise.all([a.terminate(), c.terminate()]);
  console.log(`node-fs owner lease ok on ${process.platform} (${process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`})`);
}
