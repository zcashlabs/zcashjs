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
      if (op === 'acquire') host = acquire(workerData.root, { create: true, ledger: workerData.ledger });
      if (op === 'release') host.release();
      if (op === 'hold') host.open('wallet.db', true, false); // left open when the worker dies
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
  const { reclaim, LEDGER_SLOTS } = await import(new URL('../wallet-host/node-fs.mjs', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'node-fs-lock-'));
  const newLedger = () => new Int32Array(new SharedArrayBuffer(LEDGER_SLOTS * 16));
  const spawn = (ledger) => new Worker(new URL(import.meta.url), { workerData: { root, ledger } });
  const ask = (worker, op) => new Promise((resolve) => { worker.once('message', resolve); worker.postMessage(op); });
  const a = spawn(newLedger()), ledgerB = newLedger(), b = spawn(ledgerB);
  assert.deepEqual(await ask(a, 'acquire'), { ok: true });
  assert.deepEqual(await ask(a, 'operations'), { ok: true });
  const busy = await ask(b, 'acquire');
  assert.equal(busy.ok, false);
  assert.equal(busy.code, 'EBUSY');
  assert.deepEqual(await ask(a, 'release'), { ok: true });
  assert.deepEqual(await ask(b, 'acquire'), { ok: true });
  assert.deepEqual(await ask(b, 'operations'), { ok: true });
  assert.deepEqual(await ask(b, 'hold'), { ok: true });
  // A worker that dies without releasing must not leave the lease held. Node closes
  // the worker's descriptors (trackUnmanagedFds); Bun does not (zcashlabs/zcashjs#34),
  // so the parent reclaims what the worker's ledger still lists.
  const held = [...Array(LEDGER_SLOTS).keys()].filter(slot => ledgerB[slot * 4] !== 0).length;
  assert.equal(held, process.platform === 'win32' ? 2 : 3, 'directory, owner lease and the open data file; closed files released');
  await b.terminate();
  const c = spawn(newLedger());
  if (process.versions.bun) {
    assert.equal((await ask(c, 'acquire')).code, 'EBUSY', 'Bun keeps a terminated worker\'s descriptors open');
    assert.equal(reclaim(ledgerB), held);
  } else assert.equal(reclaim(ledgerB), 0);
  assert.deepEqual(await ask(c, 'acquire'), { ok: true });
  assert.equal(reclaim(ledgerB), 0, 'reclaim is idempotent');
  assert.throws(() => reclaim(new Int32Array(4)), /invalid descriptor ledger/);
  await Promise.all([a.terminate(), c.terminate()]);
  console.log(`node-fs owner lease ok on ${process.platform} (${process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`})`);
}
