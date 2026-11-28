"""Read-only fixture receipts. No database or migration metadata is rewritten."""
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

original_manifest, successful_native_log, source_root = map(Path, sys.argv[1:])
def sha(data): return hashlib.sha256(data).hexdigest()
def inspect(path):
    before = path.read_bytes()
    db = sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)
    marker = db.execute('SELECT id,version,parameters,genesis FROM ext_wallet_storage').fetchall()
    assert len(marker) == 1
    id_, version, parameters, genesis = marker[0]
    assert (id_, version) == (1, 1)
    document = json.loads(parameters)
    schema = db.execute('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').fetchall()
    ids = [r[0] for r in db.execute('SELECT lower(hex(id)) FROM schemer_migrations ORDER BY id')]
    mismatches = []
    for pool, upgrade, mixed in [('sapling','Sapling',280000),('orchard','Nu5',1842420),('ironwood','Nu6_3',4134000)]:
        row = db.execute('SELECT sql FROM sqlite_schema WHERE name=?', (f'v_{pool}_shard_scan_ranges',)).fetchone()
        if row and f'IFNULL(prev_shard.subtree_end_height, {document[upgrade]})' not in row[0]:
            assert f'IFNULL(prev_shard.subtree_end_height, {mixed})' in row[0]
            mismatches.append(pool)
    user_version = db.execute('PRAGMA user_version').fetchone()[0]
    db.close()
    assert path.read_bytes() == before
    return dict(path=str(path), sha256=sha(before), count=len(ids), ids=ids, version=user_version,
                parameters_hex=parameters.hex(), parameters_sha256=sha(parameters), genesis_hex=genesis.hex(),
                marker_sha256=sha(json.dumps([id_,version,parameters.hex(),genesis.hex()],separators=(',',':')).encode()),
                ddl_sha256=sha(json.dumps(schema,separators=(',',':')).encode()), schema=schema,
                parameter_contradictions=mismatches)

originals = []
for old in json.loads(original_manifest.read_text()):
    observed = inspect(Path(old['path']))
    assert observed['sha256'] == old['sha256']
    observed['classification'] = 'negative_parameter_evidence' if observed['parameter_contradictions'] else 'not_certified'
    originals.append(observed)
assert len(originals) == 67 and sum(bool(x['parameter_contradictions']) for x in originals) == 54
text = successful_native_log.read_text()
assert re.search(r'test result: ok\. \d+ passed; 0 failed', text)
assert 'schema_document_committed_prefixes_resume ... ok' in text
paths = re.findall(r'R1 prefix=\d+ user_version=\d+ ids=[^\n]*? path=([^\n]+)', text)
new = [inspect(Path(path+'.interrupted.db')) for path in paths]
assert len(new) == 88 and sorted(x['count'] for x in new) == list(range(88))
assert not any(x['parameter_contradictions'] for x in new)
source = json.loads(Path(__file__).with_name('wallet-schema-source.json').read_text())
for migration in source:
    assert sha((source_root/(migration['name']+'.rs')).read_bytes()) == migration['source_sha256']
print(json.dumps(dict(scope='Receipts and parameter provenance, not a schema admission allowlist',
                     original=originals, legitimate=new, source=source),indent=2))
