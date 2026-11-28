import assert from 'node:assert/strict';
import fs from 'node:fs';
import { start, initialize } from './wallet-support.mjs';
const bundle = process.argv[2];
const scratch = process.env.WALLET_TEST_ROOT;
const root = fs.mkdtempSync(`${scratch}/inode-`);
async function open(path, create = false) {
  const owner = start(bundle, path, create);
  try {
    const result = await owner.call(initialize());
    if (result.ok) assert.equal((await owner.call({ op: 'close', generation: result.generation })).ok, true);
    return result;
  } finally { await owner.destroy(); }
}
assert.equal((await open(root, true)).ok, true);
const alias = fs.mkdtempSync(`${scratch}/alias-`);
fs.linkSync(`${root}/wallet.db`, `${alias}/wallet.db`);
const before = fs.readFileSync(`${root}/wallet.db`);
const first = start(bundle, root), second = start(bundle, alias);
try {
  const a = await first.call(initialize()), b = await second.call(initialize());
  console.log(JSON.stringify({ case: 'hardlink_same_inode_two_owners', first: a, second: b,
    inode1: fs.statSync(`${root}/wallet.db`).ino, inode2: fs.statSync(`${alias}/wallet.db`).ino }));
  assert.equal(a.ok, false); assert.equal(b.ok, false);
  assert.deepEqual(fs.readFileSync(`${root}/wallet.db`), before);
} finally { await first.destroy(); await second.destroy(); }
console.log('PASS two owned roots reject same inode before mutation');
fs.unlinkSync(`${alias}/wallet.db`);
assert.equal((await open(root)).ok, true);
const { spawnSync } = await import('node:child_process');
let cases = 1;
for (const name of ['wallet.db', 'wallet.db-journal', 'owner.lock']) {
  for (const kind of ['hardlink', 'symlink', 'directory', 'fifo', 'permissions']) {
    const dir = fs.mkdtempSync(`${scratch}/negative-`);
    fs.copyFileSync(`${root}/wallet.db`, `${dir}/wallet.db`);
    const target = `${dir}/${name}`, foreign = `${dir}/synthetic-foreign`;
    fs.writeFileSync(foreign, 'synthetic private bytes', { mode: 0o600 });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    if (kind === 'hardlink') fs.linkSync(foreign, target);
    if (kind === 'symlink') fs.symlinkSync(foreign, target);
    if (kind === 'directory') fs.mkdirSync(target, { mode: 0o700 });
    if (kind === 'fifo') assert.equal(spawnSync('mkfifo', ['-m', '600', target]).status, 0);
    if (kind === 'permissions') fs.writeFileSync(target, '', { mode: 0o666 });
    if (kind === 'permissions') fs.chmodSync(target, 0o666);
    const db = name === 'wallet.db' ? null : fs.readFileSync(`${dir}/wallet.db`);
    const failed = start(bundle, dir);
    try {
      const began = Date.now();
      assert.deepEqual(await failed.call(initialize()), { ok: false, error: 'STORAGE_OPEN_FAILED' });
      assert.ok(Date.now() - began < 5000, 'nonblocking rejection');
      assert.equal(fs.readFileSync(foreign, 'utf8'), 'synthetic private bytes');
      if (db) assert.deepEqual(fs.readFileSync(`${dir}/wallet.db`), db);
      fs.rmSync(target, { recursive: true });
      if (name === 'wallet.db') fs.copyFileSync(`${root}/wallet.db`, target);
      // Failed worker remains alive: admission must already have released its lease.
      assert.equal((await open(dir)).ok, true);
    } finally { await failed.destroy(); }
    console.log(`PASS ${name} ${kind}: private failure, preserved bytes, live-worker handoff`); cases++;
  }
}
const unsafe = fs.mkdtempSync(`${scratch}/permissions-`);
fs.chmodSync(unsafe, 0o777);
assert.deepEqual(await open(unsafe, true), { ok: false, error: 'STORAGE_OPEN_FAILED' });
assert.equal(fs.existsSync(`${unsafe}/owner.lock`), false);
fs.chmodSync(unsafe, 0o700);
assert.equal((await open(unsafe, true)).ok, true);
const rootLink = `${scratch}/root-link-${process.pid}`;
fs.symlinkSync(root, rootLink);
const owner = start(bundle, root);
try {
  assert.equal((await owner.call(initialize())).ok, true);
  assert.equal((await open(rootLink)).error, 'STORAGE_BUSY');
} finally { await owner.destroy(); }
assert.equal((await open(rootLink)).ok, true);
console.log(JSON.stringify({ pass: true, cases: cases + 2, label: 'JS-only uncommitted mix of build04 and patched node-fs; not canonical build' }));
