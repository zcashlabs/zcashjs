"""Make a new, explicitly derived test harness; never alter a build or its receipt.

Usage: python3 tests/wallet-schema-prepare-browser.py BUNDLE INVENTORY NEW_HARNESS LOG_ROOT
The emitted Firefox driver retains the existing realm/cleanup checks. Only its
log directory changes. The derived page seeds ordinary OPFS before real workers.
"""
import hashlib
import json
import shutil
import sqlite3
import sys
from pathlib import Path

bundle, inventory_path, output, logs = map(Path, sys.argv[1:])
assert not output.exists() and logs.is_dir()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
original_artifacts = {str(p.relative_to(bundle)):sha(p) for p in bundle.rglob('*') if p.is_file()}
shutil.copytree(bundle, output)
manifest = json.loads(inventory_path.read_text())
fixtures = []
fixture_dir = output/'tests/schema-fixtures'
fixture_dir.mkdir()
def add(name, fixture, expected, mutation=None):
    source = Path(fixture['path'])
    assert sha(source) == fixture['sha256']
    target = fixture_dir/(name+'.db')
    shutil.copyfile(source,target)
    if mutation:
        db=sqlite3.connect(target); db.executescript(mutation); db.close()
    fixtures.append(dict(name=name, url='/tests/schema-fixtures/'+target.name, expected=expected,
                         sha256=sha(target), source=str(source), source_sha256=fixture['sha256'], mutation=mutation))
legitimate = {f['count']:f for f in manifest['legitimate']}
original = {f['count']:f for f in manifest['original']}
for n in [0,13,66]: add('document-'+str(n), legitimate[n],True)
for n in [11,14,66]: add('contradictory-'+str(n), original[n],False)
for name, sql in dict(missing_transactions='DROP TABLE transactions', missing_metadata='DROP TABLE schemer_migrations',
                     extra_table='CREATE TABLE future_wallet_data(id INTEGER)', extra_column='ALTER TABLE accounts ADD COLUMN future_secret BLOB',
                     version_zero='PRAGMA user_version=0', missing_index='DROP INDEX idx_transparent_received_outputs_value_zat',
                     altered_view='DROP VIEW v_orchard_shard_scan_ranges; CREATE VIEW v_orchard_shard_scan_ranges AS SELECT 1',
                     dependency_hole="DELETE FROM schemer_migrations WHERE id=X'bc4f5e57d6004b6c990fb3538f0bfce1'",
                     null_metadata='INSERT INTO schemer_migrations VALUES(NULL)',
                     text_parameters='UPDATE ext_wallet_storage SET parameters=CAST(parameters AS TEXT)').items():
    add(name,legitimate[66],False,sql)
(output/'tests/schema-fixtures.json').write_text(json.dumps(fixtures,indent=2))
source_dir = Path(__file__).parent
page = (source_dir/'wallet-browser.mjs').read_text()
assert page.count('let outcome;') == 1
page = page.split('let outcome;')[0].replace('const root =', 'let root =')
page += '''
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('');
let outcome;
try {
  const fixtures = await (await fetch('/tests/schema-fixtures.json')).json();
  for (const fixture of fixtures) {
    root = `schema-${crypto.randomUUID()}`;
    const bytes = await (await fetch(fixture.url)).arrayBuffer();
    check(await hash(bytes) === fixture.sha256, 'fixture provenance');
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(root, {create:true});
    const file = await dir.getFileHandle('wallet.db', {create:true});
    const writer = await file.createWritable(); await writer.write(bytes); await writer.close();
    const owner = start();
    const result = await owner.call(initialize(false));
    if (result.ok) {
      check(result.secure && !result.isolated && result.sab === 'undefined', 'ordinary dedicated worker');
      check((await owner.call({op:'close',generation:result.generation})).ok, 'close');
    }
    await owner.destroy();
    const preserved = await hash(await (await file.getFile()).arrayBuffer()) === fixture.sha256;
    const pass = fixture.expected ? result.ok === true : result.ok === false && result.error === 'SCHEMA_MISMATCH' && preserved;
    results.push({fixture:fixture.name, result, bytesPreserved:preserved, pass, root});
    check(pass, JSON.stringify(results.at(-1)));
  }
  outcome = {pass:true, results, userAgent:navigator.userAgent};
} catch(e) { outcome = {pass:false, results, error:{name:e.name,message:e.message,stack:e.stack}}; }
finally { for (const worker of active) worker.terminate(); }
document.querySelector('#result').textContent = JSON.stringify(outcome,null,2);
await fetch('/result',{method:'POST',body:JSON.stringify(outcome)});
'''
(output/'tests/wallet-browser.mjs').write_text(page)
driver = (source_dir/'wallet-firefox.mjs').read_text()
needle = "const logs = '/home/jack/zakura-wallet-storage-logs';"
assert driver.count(needle) == 1
driver = driver.replace(needle,'const logs = '+json.dumps(str(logs))+';')
(output/'schema-firefox.mjs').write_text(driver)
assert all(sha(bundle/k)==v for k,v in original_artifacts.items())
assert sha(output/'bindings_bg.wasm') == original_artifacts['bindings_bg.wasm']
receipt = dict(scope='Derived test harness, not a new production build', bundle=str(bundle),
               original_artifacts=original_artifacts, fixtures=fixtures,
               source_helpers={p.name:sha(p) for p in [Path(__file__),source_dir/'wallet-browser.mjs',source_dir/'wallet-firefox.mjs']},
               derived_artifacts={str(p.relative_to(output)):sha(p) for p in output.rglob('*') if p.is_file()})
(output/'schema-harness.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(dict(fixtures=len(fixtures), wasm=sha(output/'bindings_bg.wasm'),
                     command=['node',str(output/'schema-firefox.mjs'),str(output)])))
