import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { start, initialize } from './wallet-support.mjs';
const bundle = process.argv[2], root = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/crash-`);
const child = fork(new URL('./wallet-process.mjs', import.meta.url), [bundle, root], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let checkpoint;
try {
  checkpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('process checkpoint deadline')); }, 30000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`process exited before checkpoint: ${code}`)); });
    child.once('error', reject);
  });
  assert.equal(checkpoint.checkpoint, 'migration-real-write');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    let timer;
    const exited = once(child, 'exit'); child.kill('SIGKILL');
    try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('process destruction deadline')), 5000); })]); }
    finally { clearTimeout(timer); }
  }
}
const header = new Uint8Array(8), fd = fs.openSync(`${root}/wallet.db-journal`, 'r');
fs.readSync(fd, header, 0, 8, 0); fs.closeSync(fd);
assert.deepEqual(Array.from(header), [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7], 'hot rollback journal after process death');
const owner = start(bundle, root);
try {
  const opened = await owner.call(initialize()); assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal((await owner.call({ op: 'close', generation: opened.generation })).ok, true);
} finally { await owner.destroy(); }
assert.equal(fs.statSync(`${root}/wallet.db-journal`).size, 0);
console.log(JSON.stringify({ pass: true, case: 'SIGKILL during actual migration; hot-journal rollback/reopen', checkpoint, root }));
