// Included as a unit test so the generator uses the production private Document.
// No production testing hook or alternative network codec is exposed.
use super as wallet;

fn document() -> Vec<u8> {
    br#"{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#.to_vec()
}

#[test]
fn schema_document_committed_prefixes_resume() {
    use zcash_client_sqlite::{WalletDb, util::SystemClock, wallet::init::WalletMigrator};
    // Reject a real SQLite commit: the interrupted migration and its metadata
    // insertion roll back together. No invented migration order or UUID subset.
    unsafe extern "C" fn stop_commit(state: *mut std::ffi::c_void) -> std::ffi::c_int {
        let remaining = unsafe { &mut *state.cast::<usize>() };
        if *remaining == 0 { 1 } else { *remaining -= 1; 0 }
    }
    let root = std::env::var("WALLET_TEST_ROOT").expect("fresh owned scratch required");
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let params = document();
    for committed in 0..=87 {
        let path = format!("{root}/document-prefix-{}-{stamp}-{committed}.db", std::process::id());
        assert!(!std::path::Path::new(&path).exists());
        let mut db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE ext_wallet_storage(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, parameters BLOB NOT NULL, genesis BLOB NOT NULL CHECK(length(genesis)=32));
            CREATE TABLE schemer_migrations(id blob PRIMARY KEY);").unwrap();
        db.execute("INSERT INTO ext_wallet_storage VALUES(1,1,?1,?2)", rusqlite::params![&params, &[3u8; 32]]).unwrap();
        let mut remaining = committed;
        unsafe { rusqlite::ffi::sqlite3_commit_hook(db.handle(), Some(stop_commit), (&mut remaining as *mut usize).cast()); }
        let migrated = {
            let mut wallet = WalletDb::from_connection(&mut db, super::super::Document::parse(&params).unwrap(),
                SystemClock, rand_core::UnwrapErr(getrandom::SysRng));
            WalletMigrator::new().init_or_migrate(&mut wallet)
        };
        unsafe { rusqlite::ffi::sqlite3_commit_hook(db.handle(), None, std::ptr::null_mut()); }
        assert_eq!(migrated.is_ok(), committed == 87, "commit boundary {committed}: {migrated:?}");
        let ids: Vec<String> = db.prepare("SELECT lower(hex(id)) FROM schemer_migrations ORDER BY id").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(ids.len(), committed);
        let version: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        eprintln!("R1 prefix={committed} user_version={version} ids={} path={path}", ids.join(","));
        for (pool, height) in [("sapling", 20), ("orchard", 60), ("ironwood", 100)] {
            let name = format!("v_{pool}_shard_scan_ranges");
            let mut stmt = db.prepare("SELECT sql FROM sqlite_schema WHERE name=?1").unwrap();
            for sql in stmt.query_map([&name], |row| row.get::<_, String>(0)).unwrap() {
                assert!(sql.unwrap().contains(&format!("IFNULL(prev_shard.subtree_end_height, {height})")),
                    "fixture producer must use the marker's parsed Document: {name}, boundary {committed}");
            }
        }
        db.close().unwrap();
        std::fs::copy(&path, format!("{path}.interrupted.db")).unwrap();
        let generation = wallet::initialize_path(&path, "zcash-js-network/1", &params, &[3; 32]).unwrap();
        wallet::storage_close(generation).unwrap();
    }
}


// Offline contract construction/qualification only. Production never executes
// this DDL projection and never opens a reference connection.
type Shape = (String, String, Option<String>);
type Schema = std::collections::BTreeMap<String, Shape>;
fn read_schema(conn: &rusqlite::Connection) -> Schema {
    conn.prepare("SELECT name,type,tbl_name,sql FROM sqlite_schema ORDER BY name").unwrap()
        .query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?, r.get(3)?))))
        .unwrap().collect::<Result<_, _>>().unwrap()
}

#[test]
fn schema_source_effects_compose() {
    use std::collections::{BTreeMap, BTreeSet};
    let source: Vec<serde_json::Value> = serde_json::from_str(include_str!("../wallet-schema-source.json")).unwrap();
    assert_eq!(source.len(), 87);
    let ids: Vec<_> = source.iter().map(|m| m["id"].as_str().unwrap()).collect();
    let mut closures: Vec<BTreeSet<usize>> = Vec::new();
    for (i, migration) in source.iter().enumerate() {
        let mut closure = BTreeSet::new();
        for dep in migration["dependencies"].as_array().unwrap() {
            let d = ids.iter().position(|id| *id == dep.as_str().unwrap()).unwrap();
            assert!(d < i, "source input must be topological");
            closure.extend(closures[d].iter().copied());
            closure.insert(d);
        }
        closures.push(closure);
    }
    let apply = |conn: &rusqlite::Connection, i: usize| {
        for statement in source[i]["statements"].as_array().unwrap() {
            conn.execute_batch(statement["sql"].as_str().unwrap()).unwrap_or_else(|error|
                panic!("{}:{}: {error}", source[i]["name"], statement["line"]));
        }
    };
    let reference = |applied: &BTreeSet<usize>| {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
        for &i in applied { apply(&conn, i); }
        conn
    };
    let mut effects: Vec<BTreeMap<String, Option<Shape>>> = Vec::new();
    for i in 0..source.len() {
        let conn = reference(&closures[i]);
        let before = read_schema(&conn);
        apply(&conn, i);
        let after = read_schema(&conn);
        effects.push(before.keys().chain(after.keys()).filter(|k| before.get(*k) != after.get(*k))
            .map(|k| (k.clone(), after.get(k).cloned())).collect());
    }
    let fold = |applied: &BTreeSet<usize>| {
        let mut result = Schema::new();
        for &i in applied {
            for (name, shape) in &effects[i] {
                if let Some(shape) = shape { result.insert(name.clone(), shape.clone()); }
                else { result.remove(name); }
            }
        }
        result
    };
    let mut pairs = 0;
    for a in 0..source.len() {
        for b in a + 1..source.len() {
            if closures[b].contains(&a) { continue; }
            assert!(effects[a].keys().all(|name| !effects[b].contains_key(name)),
                "incomparable persistent writers {} / {}", ids[a], ids[b]);
            let minimal = closures[a].union(&closures[b]).copied().collect();
            let maximal = (0..source.len()).filter(|&i| i != a && i != b &&
                !closures[i].contains(&a) && !closures[i].contains(&b)).collect();
            for base in [minimal, maximal] {
                let ab = reference(&base);
                apply(&ab, a); apply(&ab, b);
                let ba = reference(&base);
                apply(&ba, b); apply(&ba, a);
                let union = base.union(&BTreeSet::from([a, b])).copied().collect();
                assert_eq!(read_schema(&ab), read_schema(&ba), "incomparable {} / {}", ids[a], ids[b]);
                assert_eq!(read_schema(&ab), fold(&union), "effect context {} / {}", ids[a], ids[b]);
            }
            pairs += 1;
        }
    }
    assert_eq!(pairs, 389);
    let root = std::env::var("WALLET_TEST_ROOT").expect("owned scratch required");
    let out = serde_json::json!({"sqlite_version": rusqlite::version(), "pairs": pairs, "contexts": pairs * 2, "effects": effects});
    std::fs::write(format!("{root}/native-effects.json"), serde_json::to_vec_pretty(&out).unwrap()).unwrap();
    eprintln!("source projections: migrations={} incomparable_pairs={} sqlite={}", source.len(), pairs, rusqlite::version());
}

#[test]
#[ignore = "requires WALLET_SCHEMA_INVENTORY pointing to retained native fixture receipts; run explicitly with --ignored"]
fn schema_retained_fixture_admission() {
    let inventory = std::env::var("WALLET_SCHEMA_INVENTORY").expect("source-bound fixture inventory required");
    let inventory: serde_json::Value = serde_json::from_slice(&std::fs::read(inventory).unwrap()).unwrap();
    let root = std::env::var("WALLET_TEST_ROOT").unwrap();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let mut positives = 0;
    let mut negatives = 0;
    let mut unselectable = 0;
    for (kind, fixtures) in [("legitimate", &inventory["legitimate"]), ("original", &inventory["original"])] {
        for fixture in fixtures.as_array().unwrap() {
            if kind == "original" && fixture["classification"] != "negative_parameter_evidence" { continue; }
            let original = fixture["path"].as_str().unwrap();
            let bytes = std::fs::read(original).unwrap();
            let ids = fixture["ids"].as_array().unwrap();
            if kind == "legitimate" && ids.iter().any(|id| id == "3a6487f7e06842bb9d126bb8dbe6da00") &&
                !ids.iter().any(|id| id == "eeec0d0dfee042318c685f3a7c7c2245") {
                let db = rusqlite::Connection::open_with_flags(original, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
                let error = db.prepare("SELECT * FROM v_orchard_shard_unscanned_ranges LIMIT 0").unwrap_err();
                assert!(error.to_string().contains("birthday_height"));
                unselectable += 1;
            }
            let path = format!("{root}/admission-{stamp}-{kind}-{}.db", fixture["count"]);
            assert!(!std::path::Path::new(&path).exists());
            std::fs::write(&path, &bytes).unwrap();
            let result = wallet::initialize_path(&path, "zcash-js-network/1", &document(), &[3; 32]);
            if kind == "legitimate" {
                let generation = result.unwrap_or_else(|e| panic!("legitimate {original}: {e}"));
                wallet::storage_close(generation).unwrap();
                positives += 1;
            } else {
                if let Ok(generation) = result { wallet::storage_close(generation).unwrap(); }
                assert_eq!(result, Err("SCHEMA_MISMATCH".into()), "{original}");
                assert_eq!(std::fs::read(&path).unwrap(), bytes, "rejected copy must not change: {original}");
                negatives += 1;
            }
            assert_eq!(std::fs::read(original).unwrap(), bytes, "retained source must not change");
        }
    }
    assert_eq!((positives, negatives), (67, 54));
    assert!(unselectable > 0);
    eprintln!("retained admission: legitimate={positives}, contradictory_negative={negatives}, original_uncertified=13");
}

#[test]
fn schema_exact_bootstrap_and_document_variants() {
    let root = std::env::var("WALLET_TEST_ROOT").unwrap();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    for objects in 0..=2 {
        for version in [0, 8] {
            let path = format!("{root}/bootstrap-{stamp}-{objects}-{version}.db");
            let db = rusqlite::Connection::open(&path).unwrap();
            if objects >= 1 {
                db.execute_batch("CREATE TABLE ext_wallet_storage(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, parameters BLOB NOT NULL, genesis BLOB NOT NULL CHECK(length(genesis)=32))").unwrap();
                db.execute("INSERT INTO ext_wallet_storage VALUES(1,1,?1,?2)", rusqlite::params![document(), &[3u8; 32]]).unwrap();
            }
            if objects == 2 { db.execute_batch("CREATE TABLE schemer_migrations(id blob PRIMARY KEY)").unwrap(); }
            db.pragma_update(None, "user_version", version).unwrap();
            db.close().unwrap();
            let before = std::fs::read(&path).unwrap();
            let result = wallet::initialize_path(&path, "zcash-js-network/1", &document(), &[3; 32]);
            if version == 0 { wallet::storage_close(result.unwrap()).unwrap(); }
            else {
                assert_eq!(result, Err("SCHEMA_MISMATCH".into()));
                assert_eq!(std::fs::read(&path).unwrap(), before);
            }
        }
    }
    for (n, params) in [
        String::from_utf8(document()).unwrap().replace("regtest", "main"),
        String::from_utf8(document()).unwrap().replace("regtest", "test"),
        "{\"encoding\":\"regtest\",\"Overwinter\":null,\"Sapling\":null,\"Blossom\":null,\"Heartwood\":null,\"Canopy\":null,\"Nu5\":null,\"Nu6\":null,\"Nu6_1\":null,\"Nu6_2\":null,\"Nu6_3\":null}".into(),
    ].iter().enumerate() {
        let path = format!("{root}/parameters-{stamp}-{n}.db");
        let generation = wallet::initialize_path(&path, "zcash-js-network/1", params.as_bytes(), &[3; 32]).unwrap();
        wallet::storage_close(generation).unwrap();
        let generation = wallet::initialize_path(&path, "zcash-js-network/1", params.as_bytes(), &[3; 32]).unwrap();
        wallet::storage_close(generation).unwrap();
    }
    eprintln!("bootstrap cases=6 parameter documents=3");
}
