// R1 schema cases from review/adversarial.mjs, using an explicit real WASM bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { start, initialize } from './wallet-support.mjs';

const bundle = process.argv[2];
assert.ok(bundle && process.env.WALLET_TEST_ROOT, 'bundle and owned WALLET_TEST_ROOT required');
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
async function open(root, create = false) {
  const owner = start(bundle, root, create);
  try {
    const result = await owner.call(initialize());
    if (result.ok) assert.equal((await owner.call({ op: 'close', generation: result.generation })).ok, true);
    return result;
  } finally { await owner.destroy(); }
}
const control = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/schema-control-`);
assert.equal((await open(control, true)).ok, true);
console.log(JSON.stringify({ case: 'control', pass: true, wasm: hash(`${bundle}/bindings_bg.wasm`) }));
const variants = {
  unknown_version: 'PRAGMA user_version=999',
  unknown_migration: 'INSERT INTO schemer_migrations VALUES(zeroblob(16))',
  missing_transactions: 'DROP TABLE transactions',
  extra_unknown_table: 'CREATE TABLE future_wallet_data(id INTEGER)',
  missing_migration_table: 'DROP TABLE schemer_migrations',
  wrong_zero_version: 'PRAGMA user_version=0',
  bad_accounts_shape: 'ALTER TABLE accounts ADD COLUMN future_secret BLOB',
  dependency_hole: "DELETE FROM schemer_migrations WHERE id=X'bc4f5e57d6004b6c990fb3538f0bfce1'",
  null_migration: 'INSERT INTO schemer_migrations VALUES(NULL)',
  text_migration: "INSERT INTO schemer_migrations VALUES('1234567890123456')",
  unknown_extension: 'CREATE TABLE ext_unintegrated(version INTEGER)',
  missing_index: 'DROP INDEX idx_transparent_received_outputs_value_zat',
  extra_index: 'CREATE INDEX future_accounts_index ON accounts(id)',
  missing_view: 'DROP VIEW v_orchard_shard_scan_ranges',
  altered_view: 'DROP VIEW v_orchard_shard_scan_ranges; CREATE VIEW v_orchard_shard_scan_ranges AS SELECT 1',
  marker_text_parameters: 'UPDATE ext_wallet_storage SET parameters=CAST(parameters AS TEXT)',
  marker_invalid_document: "UPDATE ext_wallet_storage SET parameters=X'00'",

};
let failed = 0;
for (const [name, sql] of Object.entries(variants)) {
  const root = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/schema-${name}-`);
  fs.copyFileSync(`${control}/wallet.db`, `${root}/wallet.db`);
  const mutation = spawnSync('python3', ['-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.close()',
    `${root}/wallet.db`, sql], { encoding: 'utf8' });
  assert.equal(mutation.status, 0, mutation.stderr);
  const before = hash(`${root}/wallet.db`);
  const result = await open(root);
  const bytesPreserved = before === hash(`${root}/wallet.db`);
  const pass = result.ok === false && result.error === 'SCHEMA_MISMATCH' && bytesPreserved;
  if (!pass) failed++;
  console.log(JSON.stringify({ case: name, result, bytesPreserved, pass, root }));
}
console.log(JSON.stringify({ negativeCases: Object.keys(variants).length, failed }));
// Optional source-bound inventory: old contradictory fixtures are negatives;
// the 13 originals without a parameter counterexample remain uncertified.
if (process.argv[3]) {
  const inventory = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const positives = inventory.legitimate;
  const negatives = inventory.original.filter(f => f.classification === 'negative_parameter_evidence');
  assert.equal(positives.length, 67);
  assert.equal(negatives.length, 54);
  for (const [expected, fixtures] of [[true, positives], [false, negatives]]) {
    for (const fixture of fixtures) {
      assert.equal(hash(fixture.path), fixture.sha256, 'immutable fixture provenance');
      const root = fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/schema-prefix-`);
      fs.copyFileSync(fixture.path, `${root}/wallet.db`);
      const result = await open(root);
      const bytesPreserved = hash(`${root}/wallet.db`) === fixture.sha256;
      const pass = expected ? result.ok === true : result.ok === false && result.error === 'SCHEMA_MISMATCH' && bytesPreserved;
      if (!pass) failed++;
      assert.equal(hash(fixture.path), fixture.sha256, 'retained original unchanged');
      console.log(JSON.stringify({ case: expected ? 'document_prefix' : 'contradictory_original',
        fixture: fixture.path, result, bytesPreserved, pass, root }));
    }
  }
  console.log(JSON.stringify({ legitimatePrefixes: positives.length, contradictoryOriginals: negatives.length,
    uncertifiedOriginals: 13, totalFailed: failed }));
}
process.exitCode = failed ? 1 : 0;
