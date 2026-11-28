//! Read-only admission for the host's pinned producer and compatible legacy prefixes; see schema.md.
use std::collections::{BTreeMap, BTreeSet};
use rusqlite::Connection;
use zcash_protocol::consensus::{NetworkUpgrade, Parameters};

#[derive(Clone, Copy)]
struct Object { kind: &'static str, table: &'static str, sql: Option<&'static str> }
struct Effect { name: &'static str, object: Option<Object> }
struct Migration { id: u128, dependencies: &'static [u128], effects: &'static [Effect] }
#[path = "schema_catalog.rs"]
mod catalog;

const MARKER: &str = "CREATE TABLE ext_wallet_storage(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, parameters BLOB NOT NULL, genesis BLOB NOT NULL CHECK(length(genesis)=32))";
const METADATA: &str = "CREATE TABLE schemer_migrations(id blob PRIMARY KEY)";
type Shape = (String, String, Option<String>);
const MISMATCH: &str = "SCHEMA_MISMATCH";

pub(super) fn validate(conn: &Connection, bytes: &[u8], genesis: &[u8]) -> Result<bool, String> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|_| MISMATCH)?;
    if version != 0 && version != 8 { return Err(MISMATCH.into()); }
    let mut statement = conn.prepare("SELECT name,type,tbl_name,sql FROM sqlite_schema").map_err(|_| MISMATCH)?;
    let rows = statement.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?))))
        .map_err(|_| MISMATCH)?;
    let mut actual: BTreeMap<String, Shape> = BTreeMap::new();
    for row in rows {
        let (name, shape) = row.map_err(|_| MISMATCH)?;
        if actual.insert(name, shape).is_some() { return Err(MISMATCH.into()); }
    }
    if actual.is_empty() {
        return if version == 0 { Ok(false) } else { Err(MISMATCH.into()) };
    }
    let marker = ("table".into(), "ext_wallet_storage".into(), Some(MARKER.into()));
    if actual.get("ext_wallet_storage") != Some(&marker) { return Err(MISMATCH.into()); }
    let mut statement = conn.prepare("SELECT id,version,parameters,genesis FROM ext_wallet_storage LIMIT 2")
        .map_err(|_| MISMATCH)?;
    let mut rows = statement.query([]).map_err(|_| MISMATCH)?;
    let row = rows.next().map_err(|_| MISMATCH)?.ok_or(MISMATCH)?;
    let id: i64 = row.get(0).map_err(|_| MISMATCH)?;
    let marker_version: i64 = row.get(1).map_err(|_| MISMATCH)?;
    let parameters: Vec<u8> = row.get(2).map_err(|_| MISMATCH)?;
    let stored_genesis: Vec<u8> = row.get(3).map_err(|_| MISMATCH)?;
    if id != 1 || marker_version != 1 || stored_genesis.len() != 32 || rows.next().map_err(|_| MISMATCH)?.is_some() {
        return Err(MISMATCH.into());
    }
    let document = super::super::Document::parse(&parameters).map_err(|_| MISMATCH)?;
    if parameters != bytes || stored_genesis != genesis { return Err("NETWORK_MISMATCH".into()); }
    let mut expected = BTreeMap::from([("ext_wallet_storage".to_string(), marker)]);
    let mut applied = BTreeSet::new();
    if actual.contains_key("schemer_migrations") {
        let metadata = ("table".into(), "schemer_migrations".into(), Some(METADATA.into()));
        if actual.get("schemer_migrations") != Some(&metadata) { return Err(MISMATCH.into()); }
        expected.insert("schemer_migrations".into(), metadata);
        expected.insert("sqlite_autoindex_schemer_migrations_1".into(), ("index".into(), "schemer_migrations".into(), None));
        let mut statement = conn.prepare(&format!("SELECT id FROM schemer_migrations LIMIT {}", catalog::MIGRATIONS.len() + 1)).map_err(|_| MISMATCH)?;
        let rows = statement.query_map([], |r| r.get::<_, Vec<u8>>(0)).map_err(|_| MISMATCH)?;
        for row in rows {
            let id: [u8; 16] = row.map_err(|_| MISMATCH)?.try_into().map_err(|_| MISMATCH)?;
            let id = u128::from_be_bytes(id);
            if !catalog::MIGRATIONS.iter().any(|m| m.id == id) || !applied.insert(id) {
                return Err(MISMATCH.into());
            }
        }
    }
    if version != if applied.is_empty() { 0 } else { 8 } { return Err(MISMATCH.into()); }
    for migration in catalog::MIGRATIONS.iter().filter(|m| applied.contains(&m.id)) {
        if !migration.dependencies.iter().all(|id| applied.contains(id)) { return Err(MISMATCH.into()); }
        for effect in migration.effects {
            if let Some(object) = effect.object {
                let sql = object.sql.map(|sql| {
                    let upgrade = match effect.name {
                        "v_sapling_shard_scan_ranges" => Some(NetworkUpgrade::Sapling),
                        "v_orchard_shard_scan_ranges" => Some(NetworkUpgrade::Nu5),
                        "v_ironwood_shard_scan_ranges" => Some(NetworkUpgrade::Nu6_3),
                        _ => None,
                    };
                    if let Some(upgrade) = upgrade {
                        let height = document.activation_height(upgrade).map(|h| u32::from(h).to_string())
                            .unwrap_or_else(|| "NULL".into());
                        sql.replace("@ACTIVATION@", &height)
                    } else { sql.to_string() }
                });
                expected.insert(effect.name.into(), (object.kind.into(), object.table.into(), sql));
            } else { expected.remove(effect.name); }
        }
    }
    // Admit only this exact owned extension, including its automatic PK indexes.
    if actual.contains_key("ext_viewing_version") {
        for (name, sql) in super::accounts::DEFINITIONS {
            expected.insert(name.into(), ("table".into(), name.into(), Some(sql.into())));
        }
        for table in ["ext_viewing_accounts", "ext_viewing_addresses"] {
            expected.insert(format!("sqlite_autoindex_{table}_1"), ("index".into(), table.into(), None));
        }
    }
    if actual.contains_key(super::revision::TABLE) {
        expected.insert(super::revision::TABLE.into(), ("table".into(), super::revision::TABLE.into(), Some(super::revision::SQL.into())));
    }
    if actual.contains_key(super::creation::TABLE) {
        expected.insert(super::creation::TABLE.into(), ("table".into(), super::creation::TABLE.into(), Some(super::creation::SQL.into())));
    }
    if actual.contains_key(super::proposal::TABLE) {
        expected.insert(super::proposal::TABLE.into(), ("table".into(), super::proposal::TABLE.into(), Some(super::proposal::SQL.into())));
        expected.insert("sqlite_autoindex_ext_wallet_proposals_1".into(), ("index".into(), super::proposal::TABLE.into(), None));
    }
    if actual.contains_key(super::pczt_import::TABLE) {
        expected.insert(super::pczt_import::TABLE.into(), ("table".into(), super::pczt_import::TABLE.into(), Some(super::pczt_import::SQL.into())));
        expected.insert("sqlite_autoindex_ext_wallet_pczt_artifacts_1".into(), ("index".into(), super::pczt_import::TABLE.into(), None));
    }
    if actual.contains_key(super::pczt_build::TABLE) {
        expected.insert(super::pczt_build::TABLE.into(), ("table".into(), super::pczt_build::TABLE.into(), Some(super::pczt_build::SQL.into())));
        expected.insert("sqlite_autoindex_ext_wallet_pczt_1".into(), ("index".into(), super::pczt_build::TABLE.into(), None));
    }
    if actual.contains_key(super::pczt_finalize::TABLE) {
        expected.insert(super::pczt_finalize::TABLE.into(), ("table".into(), super::pczt_finalize::TABLE.into(), Some(super::pczt_finalize::SQL.into())));
        expected.insert("sqlite_autoindex_ext_wallet_finalized_1".into(), ("index".into(), super::pczt_finalize::TABLE.into(), None));
    }
    for (table,sql) in super::payment::DEFINITIONS {
        if actual.contains_key(table) {
            expected.insert(table.into(),("table".into(),table.into(),Some(sql.into())));
            if table!="ext_wallet_submission_meta" {
                expected.insert(format!("sqlite_autoindex_{table}_1"),("index".into(),table.into(),None));
            }
        }
    }
    if actual.contains_key(super::proposal::INTENTS) {
        expected.insert(super::proposal::INTENTS.into(), ("table".into(), super::proposal::INTENTS.into(), Some(super::proposal::INTENTS_SQL.into())));
        for index in [1,2] {expected.insert(format!("sqlite_autoindex_ext_wallet_proposal_intents_{index}"), ("index".into(), super::proposal::INTENTS.into(), None));}
    }
    // Exact producer text preserves literals and SQLite's indirect rewrites.
    // No view is prepared: legitimate intermediate views can be unselectable.
    if actual != expected { return Err(MISMATCH.into()); }
    if actual.contains_key(super::creation::TABLE) {
        super::creation::validate(conn).map_err(|_|MISMATCH.to_string())?;
    }
    if actual.contains_key(super::revision::TABLE) {
        super::revision::validate(conn).map_err(|_| MISMATCH.to_string())?;
    }
    Ok(true)
}
