import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url), { workerData: {
    adapter: process.argv[2], scratch: process.env.WALLET_TEST_ROOT }, trackUnmanagedFds: true });
  await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', code => code ? reject(Error(`exit ${code}`)) : resolve()); });
} else {
  const { acquire } = await import(pathToFileURL(workerData.adapter));
  const root = fs.mkdtempSync(`${workerData.scratch}/descriptor-`);
  const held = () => fs.readdirSync('/proc/self/fd').filter(fd => {
    try { return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(root); } catch { return false; }
  }).length;
  fs.writeFileSync(`${root}/wallet.db`, '', { mode: 0o600 });
  fs.linkSync(`${root}/wallet.db`, `${root}/alias`);
  for (let i = 0; i < 20; i++) assert.throws(() => acquire(root), /STORAGE_OPEN_FAILED/);
  assert.equal(held(), 0);
  fs.unlinkSync(`${root}/alias`);
  const host = acquire(root);
  fs.writeFileSync(`${root}/wallet.db-journal`, '', { mode: 0o600 });
  fs.linkSync(`${root}/wallet.db-journal`, `${root}/alias`);
  const baseline = held();
  for (let i = 0; i < 20; i++) assert.throws(() => host.open('wallet.db-journal', true, false));
  assert.equal(held(), baseline);
  fs.unlinkSync(`${root}/alias`);
  const sync = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw Error('synthetic fsync failure'); };
    assert.throws(() => host.open('wallet.db', false, false), /synthetic/);
    assert.equal(held(), baseline);
  } finally { fs.fsyncSync = sync; host.release(); }
  assert.equal(held(), 0);
  acquire(root).release();
  console.log('PASS descriptor cleanup: 20 failed acquisitions, 20 failed opens, fsync failure, release/reacquire');
}
