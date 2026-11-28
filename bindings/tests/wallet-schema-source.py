"""Check frozen, source-located DDL; see schema.md for the control-flow audit.

New source hashes require another audit before replacing the manifest. This is
not a general Rust parser or a completeness proof. SQL executes only in tests.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

codes = dict(account_kind_derived='0', account_kind_imported='1', sapling_pool_code='2',
             orchard_pool_code='3', transparent_pool_code='0', LEGACY_ADDRESS_INDEX_NULL='-1',
             foreign_key_scope='-1', external_scope_code='0', fallback_height='0')
literals = re.compile(r'//[^\n]*|/\*.*?\*/|r(#+)".*?"\1|"(?:[^"\\]|\\.)*"', re.S)


def strings(text):
    for match in literals.finditer(text):
        raw = match[0]
        if raw.startswith(('//', '/*')): continue
        if raw.startswith('r'): value = raw[raw.index('"') + 1:raw.rindex('"')]
        else:
            raw = re.sub(r'\\\n\s*', '', raw)
            value = json.loads(raw.replace('\n', '\\n'))
        yield text[:match.start()].count('\n') + 1, value


def split_sql(sql):
    token = re.compile(r"--[^\n]*|/\*.*?\*/|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|;", re.S)
    start = 0
    for match in token.finditer(sql):
        if match[0] == ';':
            yield sql[start:match.end()]
            start = match.end()
    if sql[start:].strip(): yield sql[start:] + ';'


def source(root, name):
    path = root / (name + '.rs')
    text = path.read_text().split('#[cfg(test)]')[0]
    id_ = re.search(r'MIGRATION_ID: Uuid = Uuid::from_u128\(0x([0-9a-f_]+)\)', text)[1].replace('_', '')
    deps = re.search(r'const DEPENDENCIES:.*?= &\[(.*?)\];', text, re.S)
    if not deps: deps = re.search(r'fn dependencies\([^)]*\)[^{]*\{(.*?)\n    }', text, re.S)
    names = re.findall(r'(\w+)::MIGRATION_ID', deps[1]) if deps else []
    return path, text, id_, names


def projection(root, name):
    path, text, id_, names = source(root, name)
    # These three new modules place view constants after down().
    if name not in ['v_transactions_sender_grouping', 'v_transactions_legacy_projection', 'one_time_pir']:
        text = text.split('fn down(')[0]
    found = {line: sql for line, sql in strings(text)
             if re.search(r'\b(CREATE|DROP|ALTER)\s+(TABLE|TEMPORARY|VIEW|INDEX|UNIQUE)', sql)}
    item = dict(name=name, id=id_, dependencies=[source(root, dep)[2] for dep in names],
                source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                source_sql_lines=sorted(found), statements=[])
    for line, sql in found.items():
        if name == 'orchard_ironwood_migration_anchor_interval': continue
        if name == 'one_time_ivk_discovery' and not sql.startswith('CREATE TABLE ironwood_one_time_recovery'):
            # The pinned creator has no obsolete scan_from column; that branch never runs.
            continue
        if '{}' in sql:
            if 'shard_scan_ranges AS' in sql:
                values = [16, 16, dict(orchard_shardtree=60, ironwood_shardtree=100,
                                      v_sapling_shard_unscanned_ranges=20)[name]]
            elif 'shard_unscanned_ranges AS' in sql: values = [10]
            else: values = [20 if name == 'add_account_birthdays' else 0]
            for value in values: sql = sql.replace('{}', str(value), 1)
        for key, value in codes.items(): sql = sql.replace('{' + key + '}', value)
        for statement in split_sql(sql):
            bare = re.sub(r'^(?:\s|--[^\n]*|/\*.*?\*/)*', '', statement, flags=re.S)
            if re.match(r'(CREATE (?!TEMP)|ALTER |DROP |PRAGMA legacy_alter_table)', bare):
                assert '{' not in statement, (name, line)
                item['statements'].append(dict(line=line, sql=statement))
    if name == 'orchard_ironwood_migration_unsatisfiability':
        item['statements'].sort(key=lambda s: {255: 0, 105: 1, 277: 2, 352: 3}[s['line']])
    if name in ['v_transactions_sender_grouping', 'v_transactions_legacy_projection', 'one_time_pir']:
        item['statements'].sort(key=lambda s: s['sql'].lstrip().startswith('CREATE VIEW'))
    if name in ['ironwood_enhance', 'transparent_policy_generation']:
        original = projection(root, 'v_transactions_zip318_kind')
        view = next(s['sql'].strip().removesuffix(';') for s in original['statements']
                    if s['sql'].lstrip().startswith('CREATE VIEW v_transactions'))
        enhance = source(root, 'ironwood_enhance')[1]
        old = next(strings(enhance[enhance.index('let original ='):]))[1]
        new = next(strings(enhance[enhance.index('let updated = view.replacen('):]))[1]
        assert view.count(old) == 1
        view = view.replace(old, new, 1)
        # Source-derived replacement/restoration, never a sampled wallet schema.
        item['statements'].append(dict(line=text[:text.index('execute_batch(&')].count('\n') + 1, sql=view + ';'))
    external = {
        'transaction_reconfirmation_receipts': ('../../transaction_reconfirmation.rs', 'RECEIPT_SCHEMA'),
        'transparent_activity_metadata': ('../../db.rs', 'TABLE_TPIR_TRANSACTION_METADATA'),
        'transparent_shared_derivations': ('../../db.rs', 'TABLE_TPIR_SHARED_DERIVATIONS'),
    }
    if name in external:
        relative, constant = external[name]
        path = root / relative
        content = path.read_text()
        position = content.index('const ' + constant + ':')
        offset, sql = next(strings(content[position:]))
        line = content[:position].count('\n') + offset
        item['external_sources'] = {relative: hashlib.sha256(path.read_bytes()).hexdigest()}
        item['statements'].extend(dict(line=line, sql=statement) for statement in split_sql(sql))
    return item


if __name__ == '__main__':
    root = Path(sys.argv[1])
    manifest_path = Path(__file__).with_name('wallet-schema-source.json')
    manifest = json.loads(manifest_path.read_text())
    for item in manifest:
        assert projection(root, item['name']) == item, (item['name'], 'source projection differs')
    print(json.dumps(dict(source_migrations=len(manifest),
                         projection_sha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest())))
