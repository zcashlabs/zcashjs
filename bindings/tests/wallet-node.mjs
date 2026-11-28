import assert from 'node:assert/strict';
import fs from 'node:fs';
import { start, initialize, parameters } from './wallet-support.mjs';
const bundle = process.argv[2];
const root = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/node-`);
let owner = start(bundle, root, true);
let previous;
try {
  const opened = await owner.call(initialize());
  previous = opened;
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const contender = start(bundle, root);
  try { assert.equal((await contender.call(initialize())).error, 'STORAGE_BUSY'); }
  finally { await contender.destroy(); }
  for (const generation of [-1, 0, 1.1, 2 ** 32, NaN, '1', 1n]) {
    assert.equal((await owner.call({ op: 'binding', generation })).ok, false);
  }
  assert.deepEqual((await owner.call({ op: 'binding', generation: opened.generation })).bytes, parameters);
  assert.equal((await owner.call({ op: 'close', generation: opened.generation })).ok, true);
  assert.equal((await owner.call({ op: 'binding', generation: opened.generation })).error, 'STALE_HANDLE');
  assert.equal((await owner.call({ op: 'close', generation: opened.generation })).ok, true);
} finally { await owner.destroy(); }
assert.ok(fs.statSync(`${root}/wallet.db`).size > 100000);
const wrong = start(bundle, root);
try {
  const request = initialize(); request.genesis[0]++;
  assert.equal((await wrong.call(request)).error, 'NETWORK_MISMATCH');
} finally { await wrong.destroy(); }
owner = start(bundle, root);
try {
  const opened = await owner.call(initialize());
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal((await owner.call({ op: 'binding', generation: previous.generation, instance: previous.instance })).error, 'WRONG_INSTANCE');
  assert.deepEqual((await owner.call({ op: 'binding', generation: opened.generation })).bytes, parameters);
  assert.equal((await owner.call({ op: 'close', generation: opened.generation })).ok, true);
} finally { await owner.destroy(); }
console.log(JSON.stringify({ pass: true, case: 'Node create/migrate/close/destroy/reopen', root }));
for (const fault of ['close', 'release', 'entropy', 'quota']) {
  const root = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/${fault}-`);
  const failing = start(bundle, root, true, { testWorker: true, fault });
  try {
    const opened = await failing.call(initialize());
    if (fault === 'entropy' || fault === 'quota') {
      assert.equal(opened.ok, false, `${fault}: ${JSON.stringify(opened)}`);
    } else {
      assert.equal(opened.ok, true, JSON.stringify(opened));
      assert.equal((await failing.call({ op: 'close', generation: opened.generation })).error, 'STORAGE_CLOSE_FAILED');
      assert.equal((await failing.call({ op: 'close', generation: opened.generation })).error, 'STORAGE_CLOSE_FAILED');
      assert.equal((await failing.call({ op: 'binding', generation: opened.generation })).error, 'STALE_HANDLE');
      const contender = start(bundle, root);
      try { assert.equal((await contender.call(initialize())).error, 'STORAGE_BUSY'); }
      finally { await contender.destroy(); }
    }
  } finally { await failing.destroy(); }
  const recovered = start(bundle, root, fault === 'entropy');
  try {
    const opened = await recovered.call(initialize()); assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal((await recovered.call({ op: 'close', generation: opened.generation })).ok, true);
  } finally { await recovered.destroy(); }
  console.log(JSON.stringify({ pass: true, case: `injected ${fault}; destroy/reopen`, root }));
}
