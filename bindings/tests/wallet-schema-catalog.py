"""Serialize native source-effect receipts; never derive admission from wallet samples."""
import hashlib
import json
import sys
from pathlib import Path

source_root, receipt_path, output_path = map(Path, sys.argv[1:])
source = json.loads(Path(__file__).with_name('wallet-schema-source.json').read_text())
receipt = json.loads(receipt_path.read_text())
assert receipt['pairs'] == 389 and len(receipt['effects']) == len(source) == 87
for item in source:
    path = source_root / (item['name'] + '.rs')
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['source_sha256'], path
    for relative, digest in item.get('external_sources', {}).items():
        assert hashlib.sha256((source_root / relative).read_bytes()).hexdigest() == digest, relative

def raw(s):
    assert '"###' not in s
    return 'r###"' + s + '"###'

lines = ['// Native SQLite source-effect catalog. See tests/wallet-schema-source.json and schema.md.',
         '// Generated from source DDL, never from interrupted wallet samples.',
         'use super::{Effect, Migration, Object};', 'pub(super) const MIGRATIONS: &[Migration] = &[']
for item, effects in zip(source, receipt['effects']):
    lines += [f'    // {item["name"]}; source sha256 {item["source_sha256"]}',
              f'    Migration {{ id: 0x{item["id"]}, dependencies: &[{", ".join("0x"+d for d in item["dependencies"])}], effects: &[']
    for name, shape in sorted(effects.items()):
        obj = 'None'
        if shape is not None:
            kind, table, sql = shape
            if name in ('v_sapling_shard_scan_ranges', 'v_orchard_shard_scan_ranges', 'v_ironwood_shard_scan_ranges'):
                height = {'v_sapling_shard_scan_ranges':20, 'v_orchard_shard_scan_ranges':60, 'v_ironwood_shard_scan_ranges':100}[name]
                needle = f'IFNULL(prev_shard.subtree_end_height, {height})'
                assert sql.count(needle) == 1
                sql = sql.replace(needle, 'IFNULL(prev_shard.subtree_end_height, @ACTIVATION@)')
            sql = 'None' if sql is None else 'Some('+raw(sql)+')'
            obj = f'Some(Object {{ kind: {raw(kind)}, table: {raw(table)}, sql: {sql} }})'
        lines.append(f'        Effect {{ name: {raw(name)}, object: {obj} }},')
    lines.append('    ] },')
lines.append('];')
output_path.write_text('\n'.join(lines)+'\n')
print(json.dumps({'migrations':len(source), 'native_sqlite':receipt['sqlite_version'],
                  'source_projection_sha256':hashlib.sha256(Path(__file__).with_name('wallet-schema-source.json').read_bytes()).hexdigest(),
                  'native_receipt_sha256':hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
                  'catalog_sha256':hashlib.sha256(output_path.read_bytes()).hexdigest()}))
