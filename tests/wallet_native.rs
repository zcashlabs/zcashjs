use zakura_bindings_core::wallet;

fn document() -> Vec<u8> {
    br#"{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#.to_vec()
}

// R1: each alteration starts from a separately created real backend database.
// Check bytes even when admission incorrectly succeeds, retaining both failures.
fn rejects_schema_change(sql: &str) {
    let root = std::env::var("WALLET_TEST_ROOT").expect("fresh owned scratch required");
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let path = format!("{root}/schema-{}-{stamp}.db", std::process::id());
    assert!(!std::path::Path::new(&path).exists());
    let params = document();
    let generation = wallet::initialize_path(&path, "zcash-js-network/1", &params, &[3; 32]).unwrap();
    wallet::storage_close(generation).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch(sql).unwrap();
    db.close().unwrap();
    let before = std::fs::read(&path).unwrap();
    let result = wallet::initialize_path(&path, "zcash-js-network/1", &params, &[3; 32]);
    if let Ok(generation) = &result { wallet::storage_close(*generation).unwrap(); }
    let preserved = std::fs::read(&path).unwrap() == before;
    eprintln!("R1 sql={sql:?} result={result:?} bytes_preserved={preserved} path={path}");
    assert!(matches!(&result, Err(error) if error == "SCHEMA_MISMATCH") && preserved,
        "expected SCHEMA_MISMATCH and byte preservation; result={result:?}, bytes_preserved={preserved}");
}

#[test]
fn schema_missing_transactions() { rejects_schema_change("DROP TABLE transactions"); }
#[test]
fn schema_unknown_table() { rejects_schema_change("CREATE TABLE future_wallet_data(id INTEGER)"); }
#[test]
fn schema_unknown_column() { rejects_schema_change("ALTER TABLE accounts ADD COLUMN future_secret BLOB"); }
#[test]
fn schema_completed_zero_version() { rejects_schema_change("PRAGMA user_version=0"); }
#[test]
fn schema_missing_migration_metadata() { rejects_schema_change("DROP TABLE schemer_migrations"); }
#[test]
fn schema_unknown_version() { rejects_schema_change("PRAGMA user_version=999"); }
#[test]
fn schema_unknown_migration() { rejects_schema_change("INSERT INTO schemer_migrations VALUES(zeroblob(16))"); }

#[test]
fn schema_dependency_hole() {
    // initial_setup is an ancestor of every recorded migration.
    rejects_schema_change("DELETE FROM schemer_migrations WHERE id=X'bc4f5e57d6004b6c990fb3538f0bfce1'");
}
#[test]
fn schema_null_migration() { rejects_schema_change("INSERT INTO schemer_migrations VALUES(NULL)"); }
#[test]
fn schema_text_migration() { rejects_schema_change("INSERT INTO schemer_migrations VALUES('1234567890123456')"); }
#[test]
fn schema_unknown_extension() { rejects_schema_change("CREATE TABLE ext_unintegrated(version INTEGER)"); }
#[test]
fn schema_missing_index() { rejects_schema_change("DROP INDEX idx_transparent_received_outputs_value_zat"); }
#[test]
fn schema_extra_index() { rejects_schema_change("CREATE INDEX future_accounts_index ON accounts(id)"); }
#[test]
fn schema_missing_view() { rejects_schema_change("DROP VIEW v_orchard_shard_scan_ranges"); }
#[test]
fn schema_altered_view() {
    rejects_schema_change("DROP VIEW v_orchard_shard_scan_ranges; CREATE VIEW v_orchard_shard_scan_ranges AS SELECT 1");
}
#[test]
fn schema_marker_extra_row() {
    // Deliberately weaken the marker definition to admit a second row without
    // bypassing SQLite constraints or changing writable_schema.
    rejects_schema_change("ALTER TABLE ext_wallet_storage RENAME TO old_marker;
        CREATE TABLE ext_wallet_storage(id INTEGER PRIMARY KEY, version INTEGER NOT NULL,
            parameters BLOB NOT NULL, genesis BLOB NOT NULL CHECK(length(genesis)=32));
        INSERT INTO ext_wallet_storage SELECT * FROM old_marker;
        INSERT INTO ext_wallet_storage SELECT 2,version,parameters,genesis FROM old_marker;
        DROP TABLE old_marker");
}

// Pinned source: orchard_shardtree, v_sapling_shard_unscanned_ranges and
// ironwood_shardtree render these activation heights into persistent view SQL.
// This checks producer parameters; it is not a complete schema contract.
#[test]
fn schema_host_view_parameters_match_binding() {
    let root = std::env::var("WALLET_TEST_ROOT").expect("fresh owned scratch required");
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let path = format!("{root}/host-view-parameters-{}-{stamp}.db", std::process::id());
    assert!(!std::path::Path::new(&path).exists());
    let generation = wallet::initialize_path(&path, "zcash-js-network/1", &document(), &[3; 32]).unwrap();
    wallet::storage_close(generation).unwrap();
    let db = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    for (pool, height) in [("sapling", 20), ("orchard", 60), ("ironwood", 100)] {
        let name = format!("v_{pool}_shard_scan_ranges");
        let sql: String = db.query_row("SELECT sql FROM sqlite_schema WHERE name=?1", [&name], |r| r.get(0)).unwrap();
        assert!(sql.contains(&format!("IFNULL(prev_shard.subtree_end_height, {height})")), "{name}: {sql}");
        eprintln!("R1 host parameter view={name} activation={height} path={path}");
    }
    db.close().unwrap();
}

#[test]
fn schema_mixed_network_producer_is_not_host_history() {
    use zcash_client_sqlite::{WalletDb, util::SystemClock, wallet::init::WalletMigrator};
    // Reproduce the retained prefix generator's parameters exactly. Its marker
    // says regtest, while its backend uses TestNetwork. A source-derived host
    // contract must reject this even though the old recovery test accepts it.
    let root = std::env::var("WALLET_TEST_ROOT").expect("fresh owned scratch required");
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let path = format!("{root}/mixed-network-{}-{stamp}.db", std::process::id());
    assert!(!std::path::Path::new(&path).exists());
    let mut db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE ext_wallet_storage(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, parameters BLOB NOT NULL, genesis BLOB NOT NULL CHECK(length(genesis)=32));
        CREATE TABLE schemer_migrations(id blob PRIMARY KEY);").unwrap();
    db.execute("INSERT INTO ext_wallet_storage VALUES(1,1,?1,?2)", rusqlite::params![document(), &[3u8; 32]]).unwrap();
    {
        let mut backend = WalletDb::from_connection(&mut db, zcash_protocol::consensus::Network::TestNetwork,
            SystemClock, rand_core::UnwrapErr(getrandom::SysRng));
        WalletMigrator::new().init_or_migrate(&mut backend).unwrap();
    }
    for (pool, height) in [("sapling", 280000), ("orchard", 1842420), ("ironwood", 4134000)] {
        let name = format!("v_{pool}_shard_scan_ranges");
        let sql: String = db.query_row("SELECT sql FROM sqlite_schema WHERE name=?1", [&name], |r| r.get(0)).unwrap();
        assert!(sql.contains(&format!("IFNULL(prev_shard.subtree_end_height, {height})")), "{name}: {sql}");
        eprintln!("R1 mixed producer view={name} activation={height} path={path}");
    }
    db.close().unwrap();
    let before = std::fs::read(&path).unwrap();
    let result = wallet::initialize_path(&path, "zcash-js-network/1", &document(), &[3; 32]);
    if let Ok(generation) = &result { wallet::storage_close(*generation).unwrap(); }
    let preserved = std::fs::read(&path).unwrap() == before;
    eprintln!("R1 mixed producer result={result:?} bytes_preserved={preserved} path={path}");
    assert!(matches!(&result, Err(error) if error == "SCHEMA_MISMATCH") && preserved,
        "expected SCHEMA_MISMATCH and byte preservation; result={result:?}, bytes_preserved={preserved}");
}

#[test]
fn real_owned_wallet_migrates_closes_and_reopens() {
    let root = std::env::var("WALLET_TEST_ROOT").expect("fresh owned scratch required");
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let path = format!("{root}/native-{}-{stamp}.db", std::process::id());
    assert!(!std::path::Path::new(&path).exists());
    let params = document();
    let generation = wallet::initialize_path(&path, "zcash-js-network/1", &params, &[3; 32]).unwrap();
    assert_eq!(wallet::storage_binding(generation).unwrap(), params);
    wallet::storage_close(generation).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    let migrations: u32 = db.query_row("SELECT count(*) FROM schemer_migrations", [], |r| r.get(0)).unwrap();
    assert!(migrations > 60, "actual pinned wallet migrations");
    assert_eq!(db.query_row("SELECT count(*) FROM accounts", [], |r| r.get::<_, u32>(0)).unwrap(), 0);
    assert_eq!(db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    db.close().unwrap();
    assert_eq!(wallet::initialize_path(&path, "zcash-js-network/1", &params, &[4; 32]).unwrap_err(), "NETWORK_MISMATCH");
    let changed = String::from_utf8(params.clone()).unwrap().replace("\"Nu6_3\":100", "\"Nu6_3\":101").into_bytes();
    assert_eq!(wallet::initialize_path(&path, "zcash-js-network/1", &changed, &[3; 32]).unwrap_err(), "NETWORK_MISMATCH");
    let reopened = wallet::initialize_path(&path, "zcash-js-network/1", &params, &[3; 32]).unwrap();
    assert_ne!(generation, reopened);
    assert_eq!(wallet::storage_binding(generation).unwrap_err(), "STALE_HANDLE");
    wallet::storage_close(reopened).unwrap();
    assert_eq!(wallet::storage_close(reopened).unwrap_err(), "STALE_HANDLE");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("INSERT INTO schemer_migrations(id) VALUES(zeroblob(16))", []).unwrap();
    db.close().unwrap();
    assert_eq!(wallet::initialize_path(&path, "zcash-js-network/1", &params, &[3; 32]).unwrap_err(), "SCHEMA_MISMATCH");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("DELETE FROM schemer_migrations WHERE id=zeroblob(16)", []).unwrap();
    db.execute_batch("PRAGMA user_version=999;").unwrap();
    db.close().unwrap();
    let before = std::fs::read(&path).unwrap();
    assert_eq!(wallet::initialize_path(&path, "zcash-js-network/1", &params, &[3; 32]).unwrap_err(), "SCHEMA_MISMATCH");
    assert_eq!(std::fs::read(&path).unwrap(), before, "unknown schema unchanged");
}
