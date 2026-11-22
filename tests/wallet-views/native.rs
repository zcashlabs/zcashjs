// Synthetic test authority derived from fixed bytes. NEVER use for production funds.
use super::*;
#[path = "creation.rs"]
mod creation;
#[path = "sync.rs"]
mod sync;
#[path = "account_lifecycle.rs"]
mod account_lifecycle;
#[path = "proposal.rs"]
mod proposal;
#[path = "zip321.rs"]
mod zip321;
#[path = "pczt_build.rs"]
mod pczt_build;
mod nu7;
use serde_json::{json, Value};
use zcash_client_backend::proto::service::TreeState;
use prost::Message;
use zcash_keys::keys::UnifiedSpendingKey;
const PARAMS: &[u8] = br#"{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#;
fn fixture(seed: u8) -> Value {
    let p = crate::Document::parse(PARAMS).unwrap();
    let key = UnifiedSpendingKey::from_seed(&p, &[seed; 32], zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key();
    let state = TreeState { network: "regtest".into(), height: 99, hash: "07".repeat(32), time: 1,
        sapling_tree: "000000".into(), orchard_tree: "000000".into(), ironwood_tree: "000000".into() };
    json!({"viewingKey":key.encode(&p), "birthday":{"parameters":hex::encode(PARAMS),"genesis":"03".repeat(32),"firstScanHeight":100,"priorTreeState":hex::encode(state.encode_to_vec()),"source":"checkpoint","recoverUntilExclusive":120}})
}
fn open() -> (String,u32) {
    let root = std::env::var("WALLET_TEST_ROOT").unwrap();
    let path = format!("{root}/views-{}.db", uuid::Uuid::new_v4());
    let generation = crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    (path,generation)
}
fn call(g: u32, op: &str, input: Value) -> std::result::Result<Value,String> {
    views_call(g,op,&input.to_string()).map(|s| serde_json::from_str(&s).unwrap())
}
fn native_scan_fixture() -> Value {
    crate::wallet::DOMAIN.with(|domain| {
        let domain=domain.borrow(); let db=&domain.active.first().unwrap().wallet;
        json!({"tipHeight":db.chain_height().unwrap().map(u32::from),
            "fullyScannedHeight":db.block_fully_scanned().unwrap().map(|b|u32::from(b.block_height())),
            "maxScannedHeight":db.block_max_scanned().unwrap().map(|b|u32::from(b.block_height())),
            "scanComplete":db.get_wallet_summary(zcash_client_backend::data_api::wallet::ConfirmationsPolicy::MIN).unwrap().map(|s|s.is_synced())})
    })
}
// Existing amount fixtures are portable across ownership epochs. Scan metadata is
// checked independently below rather than baking a random epoch into fixtures.
fn balance_amount_fixture(g: u32, input: Value) -> std::result::Result<Value,String> {
    let mut result=call(g,"account_balance",input)?;
    assert!(result["scan"]["revision"].as_str().is_some());
    let mut scan=result["scan"].clone();scan.as_object_mut().unwrap().remove("revision");
    assert_eq!(scan,native_scan_fixture());
    result.as_object_mut().unwrap().remove("scan");
    Ok(result)
}
#[test]
fn account_balance_revision_commits_rolls_back_and_changes_owner() {
    let (path,g)=open();
    let account=call(g,"account_import",fixture(10)).unwrap();
    let args=json!({"accountId":account["id"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true}});
    let first=call(g,"account_balance",args.clone()).unwrap();
    let epoch=first["scan"]["revision"].as_str().unwrap().split(':').next().unwrap().to_owned();
    assert_eq!(hex::decode(&epoch).unwrap().len(),16);
    assert_eq!(first["scan"],json!({"revision":format!("{epoch}:1"),"tipHeight":99,"fullyScannedHeight":null,"maxScannedHeight":null,"scanComplete":null}));
    assert_eq!(first["amounts"],Value::Null);
    assert_eq!(call(g,"account_balance",args.clone()).unwrap(),first);
    assert_eq!(call(g,"account_import",fixture(10)).unwrap_err(),"ACCOUNT_COLLISION");
    assert_eq!(call(g,"account_balance",args.clone()).unwrap(),first);
    call(g,"address_next",json!({"accountId":account["id"],"request":{"format":"transparent"}})).unwrap();
    assert_eq!(call(g,"account_balance",args.clone()).unwrap()["scan"]["revision"],format!("{epoch}:2"));
    crate::wallet::DOMAIN.with(|domain| {
        domain.borrow_mut().active.first_mut().unwrap().wallet.transactionally_with_extension(|_,ext| -> Result<()> {
            ext.execute("UPDATE ext_wallet_revision SET sequence=9223372036854775807",[])?;
            Ok(())
        }).unwrap();
    });
    let accounts=call(g,"account_list",json!({})).unwrap();
    let bytes=std::fs::read(&path).unwrap();
    assert_eq!(call(g,"account_import",fixture(11)).unwrap_err(),"STORAGE_ERROR");
    assert_eq!(call(g,"account_list",json!({})).unwrap(),accounts);
    assert_eq!(std::fs::read(&path).unwrap(),bytes,"revision failure rolls back native account writes");
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let reopened=call(g,"account_balance",args).unwrap();
    let revision=reopened["scan"]["revision"].as_str().unwrap();
    assert_ne!(revision.split(':').next().unwrap(),epoch);
    assert!(revision.ends_with(":0"));
    assert_eq!(call(g,"account_list",json!({})).unwrap(),accounts);
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn revision_legacy_migration_and_corrupt_row_admission() {
    let (path,g)=open();
    crate::wallet::storage_close(g).unwrap();
    let mut conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("DROP TABLE ext_wallet_revision").unwrap();
    let before=std::fs::read(&path).unwrap();
    let reader=rusqlite::Connection::open(&path).unwrap();
    reader.execute_batch("BEGIN; SELECT * FROM accounts").unwrap();
    conn.busy_timeout(std::time::Duration::ZERO).unwrap();
    assert_eq!(super::super::revision::initialize(&mut conn,&[42;16]).unwrap_err(),"STORAGE_INIT_FAILED");
    assert_eq!(std::fs::read(&path).unwrap(),before,"failed migration commit leaves no revision table");
    reader.execute_batch("ROLLBACK").unwrap();drop(reader);
    drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    super::super::revision::validate(&conn).unwrap();
    drop(conn);
    let valid=std::fs::read(&path).unwrap();
    for sql in ["DELETE FROM ext_wallet_revision", "UPDATE ext_wallet_revision SET sequence=-1",
        "UPDATE ext_wallet_revision SET sequence=1.5", "UPDATE ext_wallet_revision SET epoch='0123456789abcdef'",
        "UPDATE ext_wallet_revision SET epoch=zeroblob(15)",
        "INSERT INTO ext_wallet_revision VALUES(2,zeroblob(16),0)",
        "ALTER TABLE ext_wallet_revision ADD COLUMN extra TEXT"] {
        std::fs::write(&path,&valid).unwrap();
        let conn=rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA ignore_check_constraints=ON").unwrap();
        conn.execute_batch(sql).unwrap(); drop(conn);
        let before=std::fs::read(&path).unwrap();
        assert_eq!(crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap_err(),"SCHEMA_MISMATCH","{sql}");
        assert_eq!(std::fs::read(&path).unwrap(),before,"{sql}");
    }
}

#[test]
fn revision_view_is_rejected_before_its_expression_is_prepared() {
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    let (path,g)=open();
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("DROP TABLE ext_wallet_revision; CREATE VIEW ext_wallet_revision AS SELECT 1 AS id,randomblob(16) AS epoch,0 AS sequence").unwrap();
    let expressions=Arc::new(AtomicUsize::new(0));
    let observed=expressions.clone();
    conn.authorizer(Some(move |ctx: AuthContext<'_>| {
        if matches!(ctx.action,AuthAction::Function { function_name: "randomblob" }) {
            observed.fetch_add(1,Ordering::SeqCst);
        }
        Authorization::Allow
    }));
    assert_eq!(crate::wallet::validate_schema(&conn,PARAMS,&[3;32]).unwrap_err(),"SCHEMA_MISMATCH");
    assert_eq!(expressions.load(Ordering::SeqCst),0,"schema admission must not prepare an unadmitted view expression");
    // The counterexample view has a valid-looking row; demonstrate the observer
    // detects exactly the SELECT which pre-admission validation must avoid.
    super::super::revision::validate(&conn).unwrap();
    assert_eq!(expressions.load(Ordering::SeqCst),1);
}
#[test]
fn account_balance_unavailable_is_not_unknown() {
    let (path,g)=open();
    let account=call(g,"account_import",fixture(10)).unwrap();
    let args=json!({"accountId":account["id"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true}});
    let before=std::fs::read(&path).unwrap();
    assert_eq!(balance_amount_fixture(g,args.clone()).unwrap(),json!({"accountId":account["id"],"amounts":null}));
    let mut unknown=args.clone();unknown["accountId"]=json!("00000000-0000-0000-0000-000000000000");
    assert_eq!(balance_amount_fixture(g,unknown).unwrap_err(),"ACCOUNT_NOT_FOUND");
    assert_eq!(std::fs::read(&path).unwrap(),before);
    crate::wallet::storage_close(g).unwrap();
    assert_eq!(balance_amount_fixture(g,args.clone()).unwrap_err(),"STALE_HANDLE");
    let reopened=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(balance_amount_fixture(reopened,args).unwrap()["amounts"],Value::Null);
    crate::wallet::storage_close(reopened).unwrap();
}
#[test]
fn ufvk_import_retains_native_uuid_and_tracking_after_reopen() {
    let (path,g) = open();
    let account = call(g,"account_import",fixture(10)).unwrap();
    assert_eq!(account["name"],Value::Null);
    assert_eq!(account["birthdayHeight"],100);
    assert_eq!(account["viewOnly"],false);
    assert_eq!(account["signerAttached"],false);
    assert_eq!(account["accountIndex"],Value::Null);
    uuid::Uuid::parse_str(account["id"].as_str().unwrap()).unwrap();
    crate::wallet::storage_close(g).unwrap();
    let g2 = crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(g2,"account_list",json!({})).unwrap(),json!([account]));
    assert_eq!(call(g2,"account_get",json!({"accountId":account["id"]})).unwrap(),account);
    assert_eq!(call(g,"account_list",json!({})).unwrap_err(),"STALE_HANDLE");
    crate::wallet::storage_close(g2).unwrap();
}
#[test]
fn birthday_rejects_unconsumed_proto_and_tree_bytes_before_mutation() {
    let (_path,g)=open();
    let good=fixture(8);
    for tree_suffix in [true,false] {
        let mut bad=good.clone();
        let mut bytes=hex::decode(bad["birthday"]["priorTreeState"].as_str().unwrap()).unwrap();
        if tree_suffix {
            let mut state=TreeState::decode(bytes.as_slice()).unwrap();
            state.ironwood_tree.push_str("00"); bytes=state.encode_to_vec();
        } else { bytes.extend_from_slice(&[0x40,0x01]); }
        bad["birthday"]["priorTreeState"]=json!(hex::encode(bytes));
        assert_eq!(call(g,"account_import",bad).unwrap_err(),"INVALID_BIRTHDAY");
        assert_eq!(call(g,"account_list",json!({})).unwrap(),json!([]));
    }
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn import_enforces_authority_scope_and_rejects_overlapping_upgrades() {
    use zcash_address::unified::{Ufvk,Fvk,Encoding,Container};
    let (_path,g)=open();
    let full=fixture(9);
    let (network,container)=Ufvk::decode(full["viewingKey"].as_str().unwrap()).unwrap();
    let key=Ufvk::try_from_items(container.items_as_parsed().iter().filter(|k|matches!(k,Fvk::Sapling(_))).cloned().collect()).unwrap().encode(&network);
    let mut missing=full.clone(); missing["viewingKey"]=json!(key);
    assert_eq!(call(g,"account_import",missing.clone()).unwrap_err(),"MISSING_AUTHORITY");
    missing["enabledPools"]=json!(["sapling"]); missing["viewOnly"]=json!(true);
    let account=call(g,"account_import",missing).unwrap();
    assert_eq!(account["viewOnly"],true);
    assert_eq!(call(g,"account_import",full).unwrap_err(),"ACCOUNT_COLLISION");
    assert_eq!(call(g,"account_get",json!({"accountId":account["id"]})).unwrap(),account);
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn durable_addresses_use_exact_88_bit_indices_and_survive_reopen() {
    let (path,g)=open();
    let account=call(g,"account_import",fixture(10)).unwrap();
    let args=json!({"accountId":account["id"]});
    let before=call(g,"address_list",args.clone()).unwrap();
    let current=call(g,"address_current",args.clone()).unwrap();
    assert_eq!(call(g,"address_list",args.clone()).unwrap(),before,"current never allocates");
    assert!(current.is_string(),"native import exposes default address");
    let next=call(g,"address_next",args.clone()).unwrap();
    assert_eq!(next["receiverTypes"],json!(["p2pkh","sapling","orchard"]));
    assert_eq!(next["intendedPools"],json!(["transparent","sapling","ironwood"]));
    let mut exact=args.clone();
    exact["request"]=json!({"format":"unified","transparent":"omit","sapling":"omit","ironwood":"require"});
    exact["index"]=json!("309485009821345068724781055");
    let high=call(g,"address_at",exact.clone()).unwrap();
    assert_eq!(high["index"],exact["index"]);
    assert_eq!(high["receiverTypes"],json!(["orchard"]));
    let list=call(g,"address_list",args.clone()).unwrap();
    exact["index"]=json!("309485009821345068724781056");
    assert_eq!(call(g,"address_at",exact).unwrap_err(),"INVALID_ARGUMENT");
    assert_eq!(call(g,"address_list",args.clone()).unwrap(),list);
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(g,"address_list",args).unwrap(),list);
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn explicit_full_scan_uses_bound_genesis_without_current_tip_substitution() {
    let (path,g)=open();
    let mut input=fixture(11); input["birthday"]=json!("fullScan");
    let account=call(g,"account_import",input).unwrap();
    assert_eq!(account["birthdayHeight"],1);
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(path).unwrap();
    let recover:Option<u32>=conn.query_row("SELECT recover_until_height FROM accounts",[],|r|r.get(0)).unwrap();
    assert_eq!(recover,None);
}
#[test]
fn failed_native_commit_rolls_back_without_consuming_address() {
    let (path,g)=open();
    let account=call(g,"account_import",fixture(12)).unwrap();
    let args=json!({"accountId":account["id"]});
    let before=call(g,"address_list",args.clone()).unwrap();
    let reader=rusqlite::Connection::open(&path).unwrap();
    reader.execute_batch("BEGIN; SELECT * FROM accounts;").unwrap();
    assert!(call(g,"address_next",args.clone()).is_err());
    assert_eq!(call(g,"address_list",args.clone()).unwrap(),before);
    reader.execute_batch("ROLLBACK").unwrap();
    let allocated=call(g,"address_next",args.clone()).unwrap();
    let params=crate::Document::parse(PARAMS).unwrap();
    let key=UnifiedFullViewingKey::decode(&params,fixture(12)["viewingKey"].as_str().unwrap()).unwrap();
    let first_index=before[0]["index"].as_str().unwrap().parse::<u64>().unwrap()+1;
    let expected=key.find_address(DiversifierIndex::from(first_index),UnifiedAddressRequest::AllAvailableKeys).unwrap();
    assert_eq!(allocated["address"],expected.0.encode(&params));
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(path).unwrap();
    assert_eq!(conn.query_row("PRAGMA integrity_check",[],|r|r.get::<_,String>(0)).unwrap(),"ok");
}
#[test]
fn emit_synthetic_upstream_fixture_for_real_wasm_tests() {
    let root=std::env::var("WALLET_TEST_ROOT").unwrap();
    let p=crate::Document::parse(PARAMS).unwrap();
    let input=fixture(10);
    let key=UnifiedFullViewingKey::decode(&p,input["viewingKey"].as_str().unwrap()).unwrap();
    let (ua,j)=key.default_address(UnifiedAddressRequest::AllAvailableKeys).unwrap();
    let mut explicit_false=fixture(12);explicit_false["viewOnly"]=json!(false);
    let mut explicit_true=fixture(14);explicit_true["viewOnly"]=json!(true);
    let mut balance_cases=policy_scan_matrix(false);
    balance_cases.push(locked_balance_case(&balance_cases[0]));
    balance_cases.extend(balance_scanner_edge_cases());
    let output=json!({"shielding":proposal::shielding_fixture(),"pczt":pczt_build::pczt_fixture(),"history":query::history_fixture(),"enhancement":enhancement::enhancement_fixture(),"scan":full_scan_fixture(),"balanceCases":balance_cases,"warning":"SYNTHETIC TEST AUTHORITY ONLY. NEVER USE FOR PRODUCTION FUNDS.","import":input,
        "policyImports":[explicit_false,explicit_true],
        "uivk":key.to_unified_incoming_viewing_key().encode(&p),"defaultAddress":address_record(&p,&key.to_unified_incoming_viewing_key(),&ua,j).unwrap()});
    std::fs::write(format!("{root}/views-fixture.json"),output.to_string()).unwrap();
}
#[test]
fn birthday_checkpoint_is_durable_and_conflicting_hash_rejects() {
    let (path,g)=open();
    let original=fixture(14);
    let account=call(g,"account_import",original.clone()).unwrap();
    let mut conflicting=fixture(15);
    let raw=hex::decode(conflicting["birthday"]["priorTreeState"].as_str().unwrap()).unwrap();
    let mut state=TreeState::decode(raw.as_slice()).unwrap();state.hash="08".repeat(32);
    conflicting["birthday"]["priorTreeState"]=json!(hex::encode(state.encode_to_vec()));
    assert_eq!(call(g,"account_import",conflicting).unwrap_err(),"INCOHERENT_BIRTHDAY");
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(path).unwrap();
    let stored:String=conn.query_row("SELECT metadata FROM ext_viewing_accounts WHERE account_uuid=?1",[uuid::Uuid::parse_str(account["id"].as_str().unwrap()).unwrap()],|r|r.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(),original);
}
#[test]
fn transparent_exact_index_respects_native_recovery_gap() {
    let (_path,g)=open();let account=call(g,"account_import",fixture(16)).unwrap();
    let args=json!({"accountId":account["id"],"index":"1000","request":{"format":"unified","transparent":"require","sapling":"omit","ironwood":"require"}});
    assert_eq!(call(g,"address_at",args).unwrap_err(),"ADDRESS_GAP_LIMIT");
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn current_rechecks_requested_receivers_against_decoded_address() {
    let (path,g)=open();let account=call(g,"account_import",fixture(17)).unwrap();
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();conn.execute("UPDATE addresses SET receiver_flags=4 WHERE exposed_at_height IS NOT NULL",[]).unwrap();conn.close().unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(g,"address_current",json!({"accountId":account["id"],"request":{"format":"unified","transparent":"omit","sapling":"require","ironwood":"omit"}})).unwrap_err(),"INVALID_STORED_ADDRESS");
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn transparent_receive_addresses_persist_without_a_unified_fallback() {
    let (path,g)=open();let account=call(g,"account_import",fixture(18)).unwrap();
    let args=json!({"accountId":account["id"],"request":{"format":"transparent"}});
    let first=call(g,"address_next",args.clone()).unwrap();
    assert_eq!(first["receiverTypes"],json!(["p2pkh"]));assert_eq!(first["intendedPools"],json!(["transparent"]));
    assert_eq!(call(g,"address_current",args.clone()).unwrap(),first["address"]);
    let mut at=args.clone();at["index"]=first["index"].clone();assert_eq!(call(g,"address_at",at).unwrap(),first);
    assert!(call(g,"address_list",json!({"accountId":account["id"]})).unwrap().as_array().unwrap().contains(&first));
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(g,"address_current",args).unwrap(),first["address"]);
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn extension_admission_rejects_oversize_metadata_and_changed_schema() {
    let (path,g)=open();crate::wallet::storage_close(g).unwrap();
    let mut conn=rusqlite::Connection::open(path).unwrap();
    conn.execute("INSERT INTO ext_viewing_accounts VALUES(?1,?2)",rusqlite::params![uuid::Uuid::new_v4(),"x".repeat(160001)]).unwrap();
    assert_eq!(super::initialize(&mut conn).unwrap_err(),"VIEWING_SCHEMA_REQUIRED");
    conn.execute("DELETE FROM ext_viewing_accounts",[]).unwrap();
    conn.execute_batch("DROP TABLE ext_viewing_accounts; CREATE TABLE ext_viewing_accounts(account_uuid BLOB,metadata TEXT);").unwrap();
    assert_eq!(super::initialize(&mut conn).unwrap_err(),"VIEWING_SCHEMA_REQUIRED");
}
#[test]
fn projected_import_retains_original_key_and_nonempty_distinct_pool_trees() {
    use zcash_primitives::merkle_tree::{HashSer,write_commitment_tree};
    let (path,g)=open();let mut input=fixture(19);
    let raw=hex::decode(input["birthday"]["priorTreeState"].as_str().unwrap()).unwrap();
    let mut state=TreeState::decode(raw.as_slice()).unwrap();state.height=100;
    let mut sapling=state.sapling_tree().unwrap();let node=HashSer::read(&[0u8;32][..]).unwrap();sapling.append(node).unwrap();
    let mut orchard=state.orchard_tree().unwrap();let node=HashSer::read(&[0u8;32][..]).unwrap();orchard.append(node).unwrap();
    let mut ironwood=state.ironwood_tree().unwrap();
    for _ in 0..2 {let node=HashSer::read(&[0u8;32][..]).unwrap();ironwood.append(node).unwrap();}
    let mut buf=Vec::new();write_commitment_tree(&sapling,&mut buf).unwrap();state.sapling_tree=hex::encode(&buf);
    buf.clear();write_commitment_tree(&orchard,&mut buf).unwrap();state.orchard_tree=hex::encode(&buf);
    buf.clear();write_commitment_tree(&ironwood,&mut buf).unwrap();state.ironwood_tree=hex::encode(&buf);
    input["birthday"]["firstScanHeight"]=json!(101);input["birthday"]["priorTreeState"]=json!(hex::encode(state.encode_to_vec()));
    input["enabledPools"]=json!(["sapling"]);input["viewOnly"]=json!(true);input["name"]=json!("");
    let account=call(g,"account_import",input.clone()).unwrap();assert_eq!(account["name"],"");
    assert_eq!(call(g,"address_list",json!({"accountId":account["id"]})).unwrap()[0]["receiverTypes"],json!(["sapling"]));
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    let stored:String=conn.query_row("SELECT metadata FROM ext_viewing_accounts",[],|r|r.get(0)).unwrap();assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(),input);
    let spend:u32=conn.query_row("SELECT has_spend_key FROM accounts",[],|r|r.get(0)).unwrap();assert_eq!(spend,0);
    conn.close().unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(g,"account_get",json!({"accountId":account["id"]})).unwrap(),account);
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn native_default_address_cannot_exceed_recovery_gap_during_import() {
    let (_path,g)=open();
    assert_eq!(call(g,"account_import",fixture(7)).unwrap_err(),"ADDRESS_GAP_LIMIT");
    assert_eq!(call(g,"account_list",json!({})).unwrap(),json!([]));
    crate::wallet::storage_close(g).unwrap();
}

// Real encrypted compact outputs, decrypted by the pinned scanner and persisted by
// WalletWrite::put_blocks. Values/keys are synthetic; no provider or funds involved.
fn policy_block(key: &UnifiedFullViewingKey) -> zcash_client_backend::proto::compact_formats::CompactBlock {
    balance_block(key,50_000,60_000)
}
fn balance_block(key: &UnifiedFullViewingKey, sapling_value:u64, orchard_value:u64) -> zcash_client_backend::proto::compact_formats::CompactBlock {
    use zcash_client_backend::proto::compact_formats::*;
    use zcash_note_encryption::Domain;
    use orchard::note::{NoteVersion, RandomSeed, Rho, ExtractedNoteCommitment};
    use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption, OrchardDomain, OrchardNoteEncryption};
    let mut rng = rand_core::UnwrapErr(getrandom::SysRng);
    let dfvk = key.sapling().unwrap();
    let note = sapling::Note::from_parts(dfvk.default_address().1,
        sapling::value::NoteValue::from_raw(sapling_value), sapling::Rseed::AfterZip212([42;32]));
    let encryptor = sapling::note_encryption::sapling_note_encryption(Some(dfvk.fvk().ovk),note.clone(),[0;512],&mut rng);
    let output = CompactSaplingOutput { cmu:note.cmu().to_bytes().to_vec(),
        ephemeral_key:sapling::note_encryption::SaplingDomain::epk_bytes(encryptor.epk()).0.to_vec(),
        ciphertext:encryptor.encrypt_note_plaintext()[..52].to_vec() };
    let fvk = key.orchard().unwrap();
    let action = |ironwood| {
        let rho = Rho::from_bytes(&[0;32]).unwrap();
        let rseed = RandomSeed::from_bytes([43;32],&rho).unwrap();
        let note = orchard::Note::from_parts(fvk.address_at(0u32,zip32::Scope::External),
            orchard::value::NoteValue::from_raw(orchard_value),rho,rseed,
            if ironwood {NoteVersion::V3} else {NoteVersion::V2}).unwrap();
        let (epk,ciphertext) = if ironwood {
            let e=IronwoodNoteEncryption::new(Some(fvk.to_ovk(zip32::Scope::External)),note,[0;512]);
            (IronwoodDomain::epk_bytes(e.epk()).0,e.encrypt_note_plaintext())
        } else {
            let e=OrchardNoteEncryption::new(Some(fvk.to_ovk(zip32::Scope::External)),note,[0;512]);
            (OrchardDomain::epk_bytes(e.epk()).0,e.encrypt_note_plaintext())
        };
        CompactOrchardAction { nullifier:vec![0;32],cmx:ExtractedNoteCommitment::from(note.commitment()).to_bytes().to_vec(),ephemeral_key:epk.to_vec(),ciphertext:ciphertext[..52].to_vec() }
    };
    CompactBlock { height:100,hash:vec![8;32],prev_hash:vec![7;32],time:2,
        vtx:vec![CompactTx { txid:vec![9;32],index:1,outputs:vec![output],actions:vec![action(false)],ironwood_actions:vec![action(true)],..Default::default() }],
        chain_metadata:Some(ChainMetadata {sapling_commitment_tree_size:1,orchard_commitment_tree_size:1,ironwood_commitment_tree_size:1}),..Default::default() }
}

#[test]
fn native_policy_real_scan_retention_selection_and_reopen() { policy_scan_matrix(false); }

#[test]
fn native_policy_legacy_marks_migrate_on_open() {
    let cases = policy_scan_matrix(true);
    if let Ok(path) = std::env::var("WALLET_LEGACY_FIXTURE") {
        use std::io::Write;
        std::fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap()
            .write_all(&serde_json::to_vec(&cases).unwrap()).unwrap();
    }
}

// Read native rows verbatim for preservation/rollback assertions; never synthesize
// serialized tree data. ORDER BY rowid makes repeat-open comparisons deterministic.
fn policy_rows(conn: &rusqlite::Connection, tables: &[&str]) -> Vec<Vec<Vec<rusqlite::types::Value>>> {
    tables.iter().map(|table| {
        let mut stmt=conn.prepare(&format!("SELECT * FROM {table} ORDER BY rowid")).unwrap();
        let columns=stmt.column_count();
        stmt.query_map([],|row| (0..columns).map(|i|row.get(i)).collect()).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap()
    }).collect()
}

fn policy_scan_matrix(legacy: bool) -> Vec<Value> {
    let mut cases=Vec::new();
    use zcash_client_backend::{scanning::{scan_block,ScanningKeys,Nullifiers},data_api::{InputSource,WalletCommitmentTrees,BlockMetadata,locking::LockFilter}};
    use zcash_primitives::{block::BlockHash,transaction::TxId};
    use zcash_protocol::ShieldedPool;
    for policy in [None,Some(false),Some(true)] {
        let (path,g)=open();
        let mut input=fixture(10);
        input["birthday"].as_object_mut().unwrap().remove("recoverUntilExclusive");
        if let Some(value)=policy {input["viewOnly"]=json!(value);}
        let account=call(g,"account_import",input.clone()).unwrap();
        let account_id=id(&json!({"accountId":account["id"]})).unwrap();
        let p=crate::Document::parse(PARAMS).unwrap();
        let key=UnifiedFullViewingKey::decode(&p,input["viewingKey"].as_str().unwrap()).unwrap();
        let birthday=birthday(&input["birthday"],PARAMS,&[3;32],&p).unwrap();
        let mut other_input=fixture(12);
        other_input["birthday"].as_object_mut().unwrap().remove("recoverUntilExclusive");
        let other=call(g,"account_import",other_input.clone()).unwrap();
        let other_id=id(&json!({"accountId":other["id"]})).unwrap();
        let other_key=UnifiedFullViewingKey::decode(&p,other_input["viewingKey"].as_str().unwrap()).unwrap();
        let mut cb=policy_block(&key);
        let mut other_cb=policy_block(&other_key);
        other_cb.vtx[0].txid=vec![11;32]; other_cb.vtx[0].index=2;
        cb.vtx.extend(other_cb.vtx);
        let metadata=cb.chain_metadata.as_mut().unwrap();
        metadata.sapling_commitment_tree_size=2; metadata.orchard_commitment_tree_size=2; metadata.ironwood_commitment_tree_size=2;
        let keys=ScanningKeys::from_account_ufvks([(account_id,key),(other_id,other_key)]);
        let prior=BlockMetadata::from_parts(99u32.into(),BlockHash([7;32]),Some(0),Some(0),Some(0));
        let scan=scan_block(&p,cb,&keys,&Nullifiers::empty(),Some(&prior)).unwrap();
        assert_eq!(scan.transactions()[0].sapling_outputs().len(),1);
        assert_eq!(scan.transactions()[0].orchard_outputs().len(),1);
        assert_eq!(scan.transactions()[0].ironwood_outputs().len(),1);
        let sapling_commitments=scan.sapling().commitments().to_vec();
        let orchard_commitments=scan.orchard().commitments().to_vec();
        let ironwood_commitments=scan.ironwood().commitments().to_vec();
        crate::wallet::DOMAIN.with(|domain| {
            let mut domain=domain.borrow_mut();let db=&mut domain.active.first_mut().unwrap().wallet;
            let confirmation=zcash_client_backend::proto::compact_formats::CompactBlock {
                height:101,hash:vec![12;32],prev_hash:vec![8;32],time:2,
                chain_metadata:Some(zcash_client_backend::proto::compact_formats::ChainMetadata {
                    sapling_commitment_tree_size:2,orchard_commitment_tree_size:2,ironwood_commitment_tree_size:2
                }),..Default::default()
            };
            let confirmed=scan_block(&p,confirmation,&keys,&Nullifiers::empty(),Some(&scan.to_block_metadata())).unwrap();
            db.update_chain_tip(101u32.into()).unwrap();
            db.put_blocks(birthday.prior_chain_state(),vec![scan,confirmed]).unwrap();
            let address = *db.get_last_generated_address_matching(account_id,UnifiedAddressRequest::AllAvailableKeys).unwrap().unwrap().transparent().unwrap();
            let output = zcash_client_backend::wallet::WalletTransparentOutput::from_parts(
                zcash_transparent::bundle::OutPoint::new([10;32],0),
                zcash_transparent::bundle::TxOut::new(zcash_protocol::value::Zatoshis::const_from_u64(70_000),address.script().into()),
                Some(100u32.into()),Some(account_id),Some(TransparentKeyScope::EXTERNAL),None).unwrap();
            db.put_received_transparent_utxo(&output).unwrap();
            if legacy {
                // Genuine scanner commitments and original native retention flags, persisted
                // through native insertion APIs, reproduce pre-policy per-note marks.
                db.with_sapling_tree_mut(|tree| tree.batch_insert(0u64.into(),sapling_commitments.clone().into_iter())).unwrap();
                db.with_orchard_tree_mut(|tree| tree.batch_insert(0u64.into(),orchard_commitments.clone().into_iter())).unwrap();
                db.with_ironwood_tree_mut(|tree| tree.batch_insert(0u64.into(),ironwood_commitments.clone().into_iter())).unwrap();
                // Deferred native removals retain marks until checkpoint pruning. The
                // policy migration must clear only the view-only removal records too.
                for position in [0u64,1] {
                    db.with_sapling_tree_mut(|tree| tree.remove_mark(position.into(),Some(&100u32.into()))).unwrap();
                    db.with_orchard_tree_mut(|tree| tree.remove_mark(position.into(),Some(&100u32.into()))).unwrap();
                    db.with_ironwood_tree_mut(|tree| tree.remove_mark(position.into(),Some(&100u32.into()))).unwrap();
                }
                assert_eq!(db.with_sapling_tree_mut(|tree| tree.marked_positions()).unwrap().len(),2);
                assert_eq!(db.with_orchard_tree_mut(|tree| tree.marked_positions()).unwrap().len(),2);
                assert_eq!(db.with_ironwood_tree_mut(|tree| tree.marked_positions()).unwrap().unwrap().len(),2);
            }
        });
        crate::wallet::storage_close(g).unwrap();
        let mut conn=rusqlite::Connection::open(&path).unwrap();
        if legacy { conn.execute("UPDATE ext_viewing_version SET version=1",[]).unwrap(); }
        for pool in ["sapling","orchard","ironwood"] {
            let count:u32=conn.query_row(&format!("SELECT count(*) FROM {pool}_received_notes WHERE nf IS NOT NULL AND value>0 AND commitment_tree_position=0"),[],|r|r.get(0)).unwrap();
            assert_eq!(count,1,"viewing history and spentness retained: {pool}");
        }
        assert_eq!(conn.query_row("SELECT ufvk IS NOT NULL FROM accounts",[],|r|r.get::<_,bool>(0)).unwrap(),true);
        let preserved_tables=["accounts","ext_viewing_accounts","ext_viewing_addresses","transactions","sapling_received_notes","orchard_received_notes","ironwood_received_notes","transparent_received_outputs","sapling_tree_checkpoints","orchard_tree_checkpoints","ironwood_tree_checkpoints"];
        let preserved=policy_rows(&conn,&preserved_tables);
        let tree_tables=["sapling_tree_shards","orchard_tree_shards","ironwood_tree_shards","sapling_tree_cap","orchard_tree_cap","ironwood_tree_cap","sapling_tree_checkpoint_marks_removed","orchard_tree_checkpoint_marks_removed","ironwood_tree_checkpoint_marks_removed","ext_viewing_version"];
        let initial_trees=policy_rows(&conn,&tree_tables);
        if legacy && policy==Some(true) {
            let before=initial_trees.clone();
            let reader=rusqlite::Connection::open(&path).unwrap();
            reader.execute_batch("BEGIN; SELECT * FROM accounts;").unwrap();
            conn.busy_timeout(std::time::Duration::ZERO).unwrap();
            let changes=conn.total_changes();
            assert_eq!(super::initialize(&mut conn).unwrap_err(),"VIEWING_SCHEMA_REQUIRED");
            assert!(conn.total_changes()>changes,"native migration wrote before blocked COMMIT");
            assert_eq!(policy_rows(&conn,&tree_tables),before,"all pool writes and version roll back");
            assert_eq!(policy_rows(&conn,&preserved_tables),preserved);
            eprintln!("native migration COMMIT blocked: all tree/version writes rolled back");
            assert!(crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).is_err(),"locked legacy opening must not publish an owner");
            assert!(call(g,"account_list",json!({})).is_err());
            assert_eq!(policy_rows(&conn,&tree_tables),before,"failed open cannot expose a partial migration");
            reader.execute_batch("ROLLBACK").unwrap();
        }
        conn.close().unwrap();
        let legacy_database = legacy.then(|| hex::encode(std::fs::read(&path).unwrap()));
        let mut migrated=None;
        for reopen in 0..2 {
        let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        assert_eq!(call(g,"account_get",json!({"accountId":account["id"]})).unwrap(),account);
        assert_eq!(call(g,"account_get",json!({"accountId":other["id"]})).unwrap(),other);
        crate::wallet::DOMAIN.with(|domain| {
            let mut domain=domain.borrow_mut();let db=&mut domain.active.first_mut().unwrap().wallet;
            let expected=usize::from(policy!=Some(true));
            let summary=db.get_wallet_summary(zcash_client_backend::data_api::wallet::ConfirmationsPolicy::MIN).unwrap().unwrap();
            let balance=&summary.account_balances()[&account_id];
            eprintln!("legacy={legacy} policy={policy:?} native summary spendable: {:?}", [balance.sapling_balance().spendable_value(),balance.orchard_balance().spendable_value(),balance.ironwood_balance().spendable_value(),balance.unshielded_regular_balance().spendable_value()]);
            for (pool, balance, value) in [("sapling",balance.sapling_balance(),50_000u64),("orchard",balance.orchard_balance(),60_000),("ironwood",balance.ironwood_balance(),60_000),("transparent",balance.unshielded_regular_balance(),70_000)] {
                assert_eq!(u64::from(balance.total()),value,"viewing total: {pool}");
                assert_eq!(u64::from(balance.spendable_value()),value*expected as u64,"summary purpose: {pool}");
            }

            let sapling=db.with_sapling_tree_mut(|tree| tree.marked_positions()).unwrap();
            let orchard=db.with_orchard_tree_mut(|tree| tree.marked_positions()).unwrap();
            let ironwood=db.with_ironwood_tree_mut(|tree| tree.marked_positions()).unwrap().unwrap();
            assert_eq!([sapling.len(),orchard.len(),ironwood.len()],[expected+1;3],"legacy={legacy}, policy={policy:?}");
            for marks in [&sapling,&orchard,&ironwood] { assert!(marks.contains(&1u64.into()),"spending mark preserved"); }
            for (bal,value) in [(summary.account_balances()[&other_id].sapling_balance(),50_000u64),(summary.account_balances()[&other_id].orchard_balance(),60_000),(summary.account_balances()[&other_id].ironwood_balance(),60_000)] {
                assert_eq!(u64::from(bal.spendable_value()),value,"mixed spending account unchanged");
            }
            let selected = db.select_spendable_notes(account_id,
                zcash_client_backend::data_api::TargetValue::AtLeast(zcash_protocol::value::Zatoshis::const_from_u64(10_000)),
                &[ShieldedPool::Sapling,ShieldedPool::Orchard,ShieldedPool::Ironwood],102u32.into(),
                zcash_client_backend::data_api::wallet::ConfirmationsPolicy::MIN,&[],LockFilter::Unfiltered).unwrap();
            assert_eq!([selected.sapling().len(),selected.orchard().len(),selected.ironwood().len()],[expected;3]);
            let address = *db.get_last_generated_address_matching(account_id,UnifiedAddressRequest::AllAvailableKeys).unwrap().unwrap().transparent().unwrap();
            let outputs = db.get_spendable_transparent_outputs(&address,102u32.into(),
                zcash_client_backend::data_api::wallet::ConfirmationsPolicy::MIN,
                zcash_client_backend::data_api::CoinbaseFilter::AllTransparentOutputs,LockFilter::Unfiltered).unwrap();
            assert_eq!(outputs.len(),expected);
            assert_eq!(db.get_unspent_transparent_output(&zcash_transparent::bundle::OutPoint::new([10;32],0),102u32.into()).unwrap().is_some(),expected==1);
            for pool in [ShieldedPool::Sapling,ShieldedPool::Orchard,ShieldedPool::Ironwood] {
                assert_eq!(db.get_spendable_note(&TxId::from_bytes([9;32]),pool,0,102u32.into(),LockFilter::Unfiltered).unwrap().is_some(),expected==1,"{pool:?}");
            }
        });
        let mut queries=Vec::new();
        for (trusted,untrusted,zero) in [(1,1,true),(2,10,false)] {
            let confirmations=json!({"trusted":trusted,"untrusted":untrusted,"allowZeroConfirmationShielding":zero});
            let args=json!({"accountId":account["id"],"confirmations":confirmations});
            let native=crate::wallet::DOMAIN.with(|domain| {
                let d=domain.borrow();let db=&d.active.first().unwrap().wallet;
                let policy=zcash_client_backend::data_api::wallet::ConfirmationsPolicy::new(
                    std::num::NonZeroU32::new(trusted).unwrap(),std::num::NonZeroU32::new(untrusted).unwrap(),zero).unwrap();
                let summary=db.get_wallet_summary(policy).unwrap().unwrap();
                let b=&summary.account_balances()[&account_id];
                let bucket=|b:&zcash_client_backend::data_api::Balance| json!({
                    "total":u64::from(b.total()).to_string(),"spendable":u64::from(b.spendable_value()).to_string(),
                    "locked":u64::from(b.locked_value()).to_string(),"changePendingConfirmation":u64::from(b.change_pending_confirmation()).to_string(),
                    "pendingSpendability":u64::from(b.value_pending_spendability()).to_string(),"uneconomic":u64::from(b.uneconomic_value()).to_string()});
                json!({"accountId":account["id"],"amounts":{"total":"240000","uneconomic":"0","observedTotal":"240000",
                    "transparent":{"regular":bucket(b.unshielded_regular_balance()),"coinbase":bucket(b.unshielded_coinbase_balance())},
                    "sapling":bucket(b.sapling_balance()),"ironwood":bucket(b.ironwood_balance()),
                    "unsupportedLegacy":{"kind":"legacyOrchard","balance":bucket(b.orchard_balance())}}})
            });
            let bytes=std::fs::read(&path).unwrap();
            assert_eq!(balance_amount_fixture(g,args.clone()).unwrap(),native);
            assert_eq!(std::fs::read(&path).unwrap(),bytes,"balance query cannot write");
            queries.push(json!({"args":args,"expected":native,"scan":native_scan_fixture()}));
        }
        crate::wallet::storage_close(g).unwrap();
        if reopen==1 {
            let mut case=json!({"viewOnly":policy,"database":hex::encode(std::fs::read(&path).unwrap()),"queries":queries});
            if let Some(bytes)=&legacy_database { case["legacyDatabase"]=json!(bytes); }
            cases.push(case);
        }
        let conn=rusqlite::Connection::open(&path).unwrap();
        assert_eq!(policy_rows(&conn,&preserved_tables),preserved,"history/authority/checkpoints preserved on open {reopen}");
        let after=policy_rows(&conn,&tree_tables);
        if policy!=Some(true) {assert_eq!(after[..9],initial_trees[..9],"spending-purpose tree storage unchanged");}
        if legacy {
            for pool in ["sapling","orchard","ironwood"] {
                let positions:Vec<u64>=conn.prepare(&format!("SELECT mark_removed_position FROM {pool}_tree_checkpoint_marks_removed ORDER BY mark_removed_position")).unwrap().query_map([],|r|r.get(0)).unwrap().collect::<std::result::Result<_,_>>().unwrap();
                assert_eq!(positions,if policy==Some(true) {vec![1]} else {vec![0,1]},"only view-only deferred marks removed");
            }
        }
        if let Some(before)=&migrated {assert_eq!(&after,before,"repeat-open idempotence");}
        migrated=Some(after);
        assert_eq!(conn.query_row("SELECT version FROM ext_viewing_version",[],|r|r.get::<_,u32>(0)).unwrap(),2);
        }
    }
    cases
}

#[test]
fn hd_explicit_native_index_and_next_survive_reopen() {
    for length in [32,64] {
    let (path,g)=open();
    let input=json!({"birthday":fixture(40)["birthday"],"accountIndex":0,"name":"private HD"});
    let account:Value=serde_json::from_str(&views_seed_call(g,"account_import_hd",&input.to_string(),vec![40;length]).unwrap()).unwrap();
    let p=crate::Document::parse(PARAMS).unwrap();
    let key=UnifiedSpendingKey::from_seed(&p,&vec![40;length],zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key();
    let (ua,j)=key.default_address(UnifiedAddressRequest::AllAvailableKeys).unwrap();
    assert_eq!(call(g,"address_list",json!({"accountId":account["id"]})).unwrap(),json!([address_record(&p,&key.to_unified_incoming_viewing_key(),&ua,j).unwrap()]));
    assert_eq!(account["accountIndex"],0);
    assert_eq!(account["signerAttached"],false);
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(g,"account_get",json!({"accountId":account["id"]})).unwrap(),account);
    creation::ready(g);
    let input=json!({});
    let next:Value=serde_json::from_str(&views_seed_call(g,"account_create_hd",&input.to_string(),vec![40;length]).unwrap()).unwrap();
    assert_eq!(next["accountIndex"],1);
    crate::wallet::storage_close(g).unwrap();
    }
}

fn hd(g:u32, op:&str, seed:u8, input:Value) -> std::result::Result<Value,String> {
    views_seed_call(g,op,&input.to_string(),vec![seed;32]).map(|s|serde_json::from_str(&s).unwrap())
}
fn hd_input(index:u32) -> Value {json!({"accountIndex":index,"birthday":fixture(40)["birthday"]})}
#[test]
fn hd_gap_independent_seed_provenance_and_native_default() {
    let (path,g)=open();
    let p=crate::Document::parse(PARAMS).unwrap();
    let mut records=Vec::new();
    for index in [0,3] {
        let a=hd(g,"account_import_hd",40,hd_input(index)).unwrap();
        assert_eq!(a["accountIndex"],index);
        let key=UnifiedSpendingKey::from_seed(&p,&[40;32],zip32::AccountId::try_from(index).unwrap()).unwrap().to_unified_full_viewing_key();
        let (ua,j)=key.default_address(UnifiedAddressRequest::AllAvailableKeys).unwrap();
        assert_eq!(call(g,"address_list",json!({"accountId":a["id"]})).unwrap(),json!([address_record(&p,&key.to_unified_incoming_viewing_key(),&ua,j).unwrap()]));
        super::super::DOMAIN.with(|domain| {
            let d=domain.borrow();let db=&d.active.first().unwrap().wallet;
            let native=db.get_account(id(&json!({"accountId":a["id"]})).unwrap()).unwrap().unwrap();
            assert!(matches!(native.source(),zcash_client_backend::data_api::AccountSource::Derived{..}));
            assert_eq!(native.source().key_derivation().unwrap().seed_fingerprint(),&zip32::fingerprint::SeedFingerprint::from_seed(&[40;32]).unwrap());
            assert_eq!(native.source().key_source(),None);
        });
        records.push(a);
    }
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    creation::ready(g);
    let args=json!({});
    let next=hd(g,"account_create_hd",40,args.clone()).unwrap();assert_eq!(next["accountIndex"],4);
    let independent=hd(g,"account_create_hd",41,args).unwrap();assert_eq!(independent["accountIndex"],0);
    for a in records {assert_eq!(call(g,"account_get",json!({"accountId":a["id"]})).unwrap(),a);}
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn hd_seed_domain_rejects_before_mutation() {
    let (path,g)=open();
    let before=std::fs::read(&path).unwrap();
    for length in [33,0,16,31,48,63,65,252,253] {
        for op in ["account_import_hd","account_create_hd"] {
            let mut input=hd_input(0);
            if op=="account_create_hd" {input.as_object_mut().unwrap().remove("accountIndex");}
            assert_eq!(views_seed_call(g,op,&input.to_string(),vec![40;length]).unwrap_err(),"INVALID_ARGUMENT","{op} seed length {length}");
            assert_eq!(call(g,"account_list",json!({})).unwrap(),json!([]));
            assert_eq!(std::fs::read(&path).unwrap(),before,"invalid seed leaves DB bytes unchanged");
        }
    }
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn hd_validation_and_partial_collision_roll_back_native_state() {
    let (path,g)=open();
    for index in [json!(-1),json!(2147483648u64),json!(1.5),json!("0"),Value::Null] {
        let mut v=hd_input(0);v["accountIndex"]=index;
        assert_eq!(hd(g,"account_import_hd",40,v).unwrap_err(),"INVALID_ARGUMENT");
    }
    for length in [0,31,253] {assert_eq!(views_seed_call(g,"account_import_hd",&hd_input(0).to_string(),vec![40;length]).unwrap_err(),"INVALID_ARGUMENT");}
    for pools in [json!(["sapling"]),json!([])] {
        let mut v=hd_input(0);v["enabledPools"]=pools;assert_eq!(hd(g,"account_import_hd",40,v).unwrap_err(),"UNSUPPORTED_HD_POOLS");
    }
    let mut bad=hd_input(0);bad["birthday"]["genesis"]=json!("04".repeat(32));
    assert_eq!(hd(g,"account_import_hd",40,bad).unwrap_err(),"NETWORK_MISMATCH");
    let mut bad=hd_input(0);bad["birthday"]["priorTreeState"]=json!("00");
    assert_eq!(hd(g,"account_import_hd",40,bad).unwrap_err(),"INVALID_BIRTHDAY");
    let mut bad=hd_input(0);bad["seed"]=json!("forbidden");
    assert_eq!(hd(g,"account_import_hd",40,bad).unwrap_err(),"INVALID_ARGUMENT");
    assert_eq!(call(g,"account_list",json!({})).unwrap(),json!([]));
    let mut partial=fixture(40);partial["enabledPools"]=json!(["sapling"]);partial["viewOnly"]=json!(true);partial["name"]=json!("retain me");
    let a=call(g,"account_import",partial).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    let tables=["accounts","addresses","ext_viewing_accounts","ext_viewing_addresses"];
    creation::ready(g);
    let before=policy_rows(&conn,&tables);
    assert_eq!(hd(g,"account_import_hd",40,hd_input(0)).unwrap_err(),"ACCOUNT_COLLISION");
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"ACCOUNT_COLLISION");
    assert_eq!(policy_rows(&conn,&tables),before);
    assert_eq!(call(g,"account_get",json!({"accountId":a["id"]})).unwrap(),a);
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(policy_rows(&conn,&tables),before);
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn hd_duplicate_overflow_and_cross_import_birthday_coherence() {
    let (_path,g)=open();
    hd(g,"account_import_hd",40,hd_input(0)).unwrap();
    assert_eq!(hd(g,"account_import_hd",40,hd_input(0)).unwrap_err(),"ACCOUNT_COLLISION");
    let mut conflicting=fixture(41);
    let mut state=TreeState::decode(hex::decode(conflicting["birthday"]["priorTreeState"].as_str().unwrap()).unwrap().as_slice()).unwrap();
    state.hash="08".repeat(32);conflicting["birthday"]["priorTreeState"]=json!(hex::encode(state.encode_to_vec()));
    assert_eq!(call(g,"account_import",conflicting.clone()).unwrap_err(),"INCOHERENT_BIRTHDAY");
    crate::wallet::storage_close(g).unwrap();
    let (_path,g)=open();call(g,"account_import",conflicting).unwrap();
    assert_eq!(hd(g,"account_import_hd",40,hd_input(0)).unwrap_err(),"INCOHERENT_BIRTHDAY");
    crate::wallet::storage_close(g).unwrap();
    let (_path,g)=open();
    let full=hd_input(2147483647);
    let max=hd(g,"account_import_hd",40,full).unwrap();assert_eq!(max["accountIndex"],2147483647u64);
    creation::ready(g);
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"ACCOUNT_INDEX_EXHAUSTED");
    assert_eq!(call(g,"account_list",json!({})).unwrap(),json!([max]));
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn hd_metadata_and_commit_failures_roll_back_and_reopen() {
    for commit_failure in [false,true] {
        let (path,g)=open();
        creation::ready(g);
        let conn=rusqlite::Connection::open(&path).unwrap();
        let tables=["accounts","addresses","ext_viewing_accounts","ext_viewing_addresses"];
        let before=policy_rows(&conn,&tables);
        if commit_failure {conn.execute_batch("BEGIN; SELECT * FROM accounts;").unwrap();}
        else {
            // Failure only fires after native account AND default-address writes exist.
            conn.execute_batch("CREATE TRIGGER hd_fail BEFORE INSERT ON ext_viewing_accounts WHEN (SELECT count(*) FROM accounts)>0 AND (SELECT count(*) FROM addresses)>0 BEGIN SELECT RAISE(ABORT,'synthetic metadata failure'); END").unwrap();
        }
        assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"STORAGE_ERROR");
        if commit_failure {conn.execute_batch("ROLLBACK").unwrap();}
        else {conn.execute_batch("DROP TRIGGER hd_fail").unwrap();}
        assert_eq!(policy_rows(&conn,&tables),before);
        crate::wallet::storage_close(g).unwrap();
        let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        assert_eq!(call(g,"account_list",json!({})).unwrap(),json!([]));
        let a=hd(g,"account_create_hd",40,json!({})).unwrap();assert_eq!(a["accountIndex"],0);
        crate::wallet::storage_close(g).unwrap();
        let metadata:String=conn.query_row("SELECT metadata FROM ext_viewing_accounts",[],|r|r.get(0)).unwrap();
        let value:Value=serde_json::from_str(&metadata).unwrap();assert_eq!(value.as_object().unwrap().len(),3);
        for candidate in [&path, &format!("{path}-journal")] {
            if let Ok(bytes)=std::fs::read(candidate) {
                let usk=UnifiedSpendingKey::from_seed(&crate::Document::parse(PARAMS).unwrap(),&[40;32],zip32::AccountId::ZERO).unwrap();
                for secret in [vec![40;32],hex::encode([40;32]).into_bytes(),usk.sapling().to_bytes().to_vec(),usk.orchard().to_bytes().to_vec(),usk.transparent().to_bytes()] {assert!(!bytes.windows(secret.len()).any(|w|w==secret),"synthetic secret persisted");}
            }
        }
    }
}

// Synthetic BIP39 fixtures; assertion diagnostics never print secret material.
const MNEMONIC: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
fn mnemonic(g:u32,input:Value,phrase:&[u8],pass:&[u8])->std::result::Result<Value,String> {
    views_mnemonic_call(g,&input.to_string(),phrase.to_vec(),pass.to_vec()).map(|s|serde_json::from_str(&s).unwrap())
}
#[test]
fn mnemonic_vectors_normalization_and_rejection() {
    for (bytes,last) in [(16,"about"),(20,"address"),(24,"agent"),(28,"admit"),(32,"art")] {
        let phrase=format!("{}{last}","abandon ".repeat(bytes*3/4-1));
        let canonical=bip39::Mnemonic::from_entropy_in(bip39::Language::English,&vec![0;bytes]).unwrap();
        assert!(canonical.to_string()==phrase,"canonical zero entropy words");
        let (path,g)=open();
        let a=mnemonic(g,hd_input(0),phrase.as_bytes(),b"TREZOR").unwrap();
        assert_eq!(a["accountIndex"],0);
        let expected=match bytes {
            16=>Some("c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"),
            24=>Some("035895f2f481b1b0f01fcf8c289c794660b289981a78f8106447707fdd9666ca06da5a9a565181599b79f53b844d8a71dd9f439c52a3d7b3e8a79c906ac845fa"),
            32=>Some("bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8"),
            _=>None,
        };
        if let Some(expected)=expected {
            let seed=hex::decode(expected).unwrap();
            assert_eq!(views_seed_call(g,"account_import_hd",&hd_input(0).to_string(),seed).unwrap_err(),"ACCOUNT_COLLISION");
        }
        crate::wallet::storage_close(g).unwrap();
        assert!(std::fs::read(path).unwrap().windows(phrase.len()).all(|w|w!=phrase.as_bytes()),"mnemonic not persisted");
    }
    let (path,g)=open();let before=std::fs::read(&path).unwrap();
    for phrase in ["abandon ".repeat(12),"unknown ".repeat(12),"abandon ".repeat(11),"abandon ".repeat(13),"abandon ".repeat(25),MNEMONIC.to_uppercase(),MNEMONIC.replace("abandon","aban"),"あいこくしん ".repeat(12)] {
        assert_eq!(mnemonic(g,hd_input(0),phrase.as_bytes(),b"").unwrap_err(),"INVALID_MNEMONIC");
    }
    for phrase in ["a".repeat(4097),"㍍".repeat(1000)] {
        assert_eq!(mnemonic(g,hd_input(0),phrase.as_bytes(),b"").unwrap_err(),"INVALID_ARGUMENT");
    }
    for (phrase,pass) in [(vec![0xff],vec![]),(MNEMONIC.as_bytes().to_vec(),vec![0xff]),(MNEMONIC.as_bytes().to_vec(),vec![b'a';65537]),(MNEMONIC.as_bytes().to_vec(),"㍍".repeat(15000).into_bytes())] {
        assert_eq!(mnemonic(g,hd_input(0),&phrase,&pass).unwrap_err(),"INVALID_ARGUMENT");
    }
    assert_eq!(std::fs::read(&path).unwrap(),before);
    let a=mnemonic(g,hd_input(0),MNEMONIC.as_bytes(),"é".as_bytes()).unwrap();
    let fullwidth:String=MNEMONIC.chars().map(|c|if c==' ' {'\u{3000}'}else{char::from_u32(c as u32+0xfee0).unwrap()}).collect();
    assert_eq!(mnemonic(g,hd_input(0),fullwidth.as_bytes(),"e\u{301}".as_bytes()).unwrap_err(),"ACCOUNT_COLLISION");
    assert_eq!(a["signerAttached"],false);
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn mnemonic_native_provenance_boundaries_and_transaction_rollback() {
    let seed=bip39::Mnemonic::parse_in_normalized(bip39::Language::English,MNEMONIC).unwrap().to_seed_normalized("");
    for commit_failure in [false,true] {
        let (path,g)=open();let conn=rusqlite::Connection::open(&path).unwrap();
        let tables=["accounts","addresses","ext_viewing_accounts","ext_viewing_addresses"];
        let before=policy_rows(&conn,&tables);
        if commit_failure {conn.execute_batch("BEGIN; SELECT * FROM accounts;").unwrap();}
        else {conn.execute_batch("CREATE TRIGGER mnemonic_fail BEFORE INSERT ON ext_viewing_accounts WHEN (SELECT count(*) FROM accounts)>0 AND (SELECT count(*) FROM addresses)>0 BEGIN SELECT RAISE(ABORT,'synthetic metadata failure'); END").unwrap();}
        assert_eq!(mnemonic(g,hd_input(3),MNEMONIC.as_bytes(),b"").unwrap_err(),"STORAGE_ERROR");
        if commit_failure {conn.execute_batch("ROLLBACK").unwrap();}else{conn.execute_batch("DROP TRIGGER mnemonic_fail").unwrap();}
        assert_eq!(policy_rows(&conn,&tables),before);
        let mut records=Vec::new();
        for index in [0,3] {
            let a=mnemonic(g,hd_input(index),MNEMONIC.as_bytes(),b"").unwrap();
            super::super::DOMAIN.with(|domain| {
                let d=domain.borrow();let db=&d.active.first().unwrap().wallet;
                let native=db.get_account(id(&json!({"accountId":a["id"]})).unwrap()).unwrap().unwrap();
                assert!(matches!(native.source(),zcash_client_backend::data_api::AccountSource::Derived{..}));
                assert_eq!(native.source().key_derivation().unwrap().seed_fingerprint(),&zip32::fingerprint::SeedFingerprint::from_seed(&seed).unwrap());
                assert_eq!(native.source().key_source(),None);
                let expected=UnifiedSpendingKey::from_seed(db.params(),&seed,zip32::AccountId::try_from(index).unwrap()).unwrap().to_unified_full_viewing_key();
                assert!(native.ufvk().unwrap().encode(db.params())==expected.encode(db.params()),"independent native authority");
            });
            assert_eq!(mnemonic(g,hd_input(index),MNEMONIC.as_bytes(),b"").unwrap_err(),"ACCOUNT_COLLISION");
            records.push(a);
        }
        crate::wallet::storage_close(g).unwrap();
        let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        for a in records {assert_eq!(call(g,"account_get",json!({"accountId":a["id"]})).unwrap(),a);}
        creation::ready(g);
        let next:Value=serde_json::from_str(&views_seed_call(g,"account_create_hd",&json!({}).to_string(),seed.to_vec()).unwrap()).unwrap();assert_eq!(next["accountIndex"],4);
        crate::wallet::storage_close(g).unwrap();
        let metadata:String=conn.query_row("SELECT metadata FROM ext_viewing_accounts LIMIT 1",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap().as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(),vec!["birthday","enabledPools","name"]);
        let backup=format!("{path}.backup");conn.execute("VACUUM INTO ?1",[&backup]).unwrap();
        for candidate in [&path,&format!("{path}-journal"),&backup] {
            if let Ok(bytes)=std::fs::read(candidate) {
                let usk=UnifiedSpendingKey::from_seed(&crate::Document::parse(PARAMS).unwrap(),&seed,zip32::AccountId::ZERO).unwrap();
                for secret in [MNEMONIC.as_bytes().to_vec(),seed.to_vec(),hex::encode(seed).into_bytes(),usk.sapling().to_bytes().to_vec(),usk.orchard().to_bytes().to_vec(),usk.transparent().to_bytes()] {assert!(!bytes.windows(secret.len()).any(|w|w==secret),"synthetic secret persisted");}
            }
        }
    }
    let (_path,g)=open();
    for index in [json!(-1),json!(2147483648u64),json!(1.5),json!("0"),Value::Null] {let mut input=hd_input(0);input["accountIndex"]=index;assert_eq!(mnemonic(g,input,MNEMONIC.as_bytes(),b"").unwrap_err(),"INVALID_ARGUMENT");}
    let mut input=hd_input(0);input["enabledPools"]=json!(["sapling"]);assert_eq!(mnemonic(g,input,MNEMONIC.as_bytes(),b"").unwrap_err(),"UNSUPPORTED_HD_POOLS");
    let mut input=hd_input(0);input["birthday"]["priorTreeState"]=json!("00");assert_eq!(mnemonic(g,input,MNEMONIC.as_bytes(),b"").unwrap_err(),"INVALID_BIRTHDAY");
    let mut input=hd_input(0);input["birthday"]=json!("fullScan");assert_eq!(mnemonic(g,input,MNEMONIC.as_bytes(),b"").unwrap()["accountIndex"],0);
    // Exact raw and normalized limits accepted; one more byte rejects before writes.
    let padded=format!("{}{}",MNEMONIC," ".repeat(4096-MNEMONIC.len()));
    assert!(mnemonic(g,hd_input(1),padded.as_bytes(),&vec![b'x';65536]).is_ok());
    assert_eq!(mnemonic(g,hd_input(2),format!("{padded} ").as_bytes(),b"").unwrap_err(),"INVALID_ARGUMENT");
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn mnemonic_passphrase_normalized_limit_and_nonpersistence() {
    let (path,g)=open();
    let pass="㍍ガバヴァぱばぐゞちぢ十人十色";
    let mut normalized=Cow::Borrowed(pass);Mnemonic::normalize_utf8_cow(&mut normalized);
    let seed=Mnemonic::parse_in_normalized(Language::English,MNEMONIC).unwrap().to_seed_normalized(&normalized);
    let account=mnemonic(g,hd_input(0),MNEMONIC.as_bytes(),pass.as_bytes()).unwrap();
    assert_eq!(mnemonic(g,hd_input(0),MNEMONIC.as_bytes(),normalized.as_bytes()).unwrap_err(),"ACCOUNT_COLLISION");
    let mut fingerprints=std::collections::BTreeSet::new();
    for pass in ["", "TREZOR", "TREZOR ", "TREZOR\0"] {
        let a=mnemonic(g,hd_input(0),MNEMONIC.as_bytes(),pass.as_bytes()).unwrap();
        super::super::DOMAIN.with(|domain| {
            let d=domain.borrow();let db=&d.active.first().unwrap().wallet;
            let native=db.get_account(id(&json!({"accountId":a["id"]})).unwrap()).unwrap().unwrap();
            assert!(fingerprints.insert(format!("{:?}",native.source().key_derivation().unwrap().seed_fingerprint())),"distinct passphrase authority");
        });
    }
    let boundary=format!("{}x","é".repeat(21845)); // NFKD is exactly 65536 bytes.
    assert!(mnemonic(g,hd_input(0),MNEMONIC.as_bytes(),boundary.as_bytes()).is_ok());
    let before=call(g,"account_list",json!({})).unwrap();
    assert_eq!(mnemonic(g,hd_input(0),MNEMONIC.as_bytes(),format!("{boundary}x").as_bytes()).unwrap_err(),"INVALID_ARGUMENT");
    assert_eq!(call(g,"account_list",json!({})).unwrap(),before);
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(g,"account_get",json!({"accountId":account["id"]})).unwrap(),account);
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();let backup=format!("{path}.backup");conn.execute("VACUUM INTO ?1",[&backup]).unwrap();
    let usk=UnifiedSpendingKey::from_seed(&crate::Document::parse(PARAMS).unwrap(),&seed,zip32::AccountId::ZERO).unwrap();
    let mut secrets=vec![MNEMONIC.as_bytes().to_vec(),pass.as_bytes().to_vec(),normalized.as_bytes().to_vec(),seed.to_vec(),usk.sapling().to_bytes().to_vec(),usk.orchard().to_bytes().to_vec(),usk.transparent().to_bytes()];
    secrets.extend(secrets.clone().iter().map(|s|hex::encode(s).into_bytes()));
    for candidate in [&path,&format!("{path}-journal"),&backup] {
        if let Ok(bytes)=std::fs::read(candidate) {for secret in &secrets {assert!(!bytes.windows(secret.len()).any(|w|w==secret),"synthetic authority persisted");}}
    }
    let result=account.to_string();for secret in &secrets {assert!(!result.as_bytes().windows(secret.len()).any(|w|w==secret),"synthetic authority in result");}
}

#[test]
fn account_balance_policy_admission_and_native_bucket_extremes() {
    use zcash_client_backend::data_api::{AccountBalance,Balance};
    use zcash_protocol::value::{Zatoshis,BalanceError,MAX_MONEY};
    let (path,g)=open();
    let a=call(g,"account_import",fixture(10)).unwrap();
    let policy=json!({"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true});
    let before=std::fs::read(&path).unwrap();
    for field in ["trusted","untrusted"] {
        for value in [json!(0),json!(-1),json!(4294967296u64),json!(1.5),json!("1"),json!(true),Value::Null] {
            let mut p=policy.clone();p[field]=value;
            assert_eq!(balance_amount_fixture(g,json!({"accountId":a["id"],"confirmations":p})).unwrap_err(),"INVALID_ARGUMENT");
        }
    }
    for p in [json!({}),json!({"trusted":2,"untrusted":1,"allowZeroConfirmationShielding":true}),json!({"trusted":1,"untrusted":1}),json!({"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":"true"}),json!({"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true,"secret":"private caller text"})] {
        assert_eq!(balance_amount_fixture(g,json!({"accountId":a["id"],"confirmations":p})).unwrap_err(),"INVALID_ARGUMENT");
    }
    let max=json!({"trusted":u32::MAX,"untrusted":u32::MAX,"allowZeroConfirmationShielding":false});
    assert_eq!(balance_amount_fixture(g,json!({"accountId":a["id"],"confirmations":max})).unwrap()["amounts"],Value::Null);
    assert_eq!(std::fs::read(&path).unwrap(),before);
    crate::wallet::storage_close(g).unwrap();

    let mut native=AccountBalance::ZERO;
    for (i,mutate) in [AccountBalance::with_sapling_balance_mut::<_,BalanceError>,AccountBalance::with_orchard_balance_mut::<_,BalanceError>,AccountBalance::with_ironwood_balance_mut::<_,BalanceError>,AccountBalance::with_unshielded_regular_balance_mut::<_,BalanceError>,AccountBalance::with_unshielded_coinbase_balance_mut::<_,BalanceError>].into_iter().enumerate() {
        let n=(i as u64+1)*10_000;
        mutate(&mut native,move |b:&mut Balance| {
            b.add_spendable_value(Zatoshis::const_from_u64(n+1))?;
            b.add_locked_value(Zatoshis::const_from_u64(n+2))?;
            b.add_pending_change_value(Zatoshis::const_from_u64(n+3))?;
            b.add_pending_spendable_value(Zatoshis::const_from_u64(n+4))?;
            b.add_uneconomic_value(Zatoshis::const_from_u64(n+5))
        }).unwrap();
    }
    let amounts=balance_amounts(&native).unwrap();
    for (i,b) in [&amounts["sapling"],&amounts["unsupportedLegacy"]["balance"],&amounts["ironwood"],&amounts["transparent"]["regular"],&amounts["transparent"]["coinbase"]].into_iter().enumerate() {
        let n=(i as u64+1)*10_000;
        assert_eq!(*b,json!({"total":(4*n+10).to_string(),"spendable":(n+1).to_string(),"locked":(n+2).to_string(),"changePendingConfirmation":(n+3).to_string(),"pendingSpendability":(n+4).to_string(),"uneconomic":(n+5).to_string()}));
    }
    assert_eq!(amounts["total"],"600050");assert_eq!(amounts["uneconomic"],"150025");assert_eq!(amounts["observedTotal"],"750075");
    let empty=balance_amounts(&AccountBalance::ZERO).unwrap();assert_eq!(empty["unsupportedLegacy"],Value::Null);
    assert_eq!(empty["observedTotal"],"0");assert_eq!(empty["sapling"],balance_bucket(&Balance::ZERO));
    let mut large=AccountBalance::ZERO;
    large.with_sapling_balance_mut::<_,BalanceError>(|b|b.add_spendable_value(Zatoshis::const_from_u64(MAX_MONEY))).unwrap();
    assert_eq!(balance_amounts(&large).unwrap()["observedTotal"],MAX_MONEY.to_string());
    large.with_orchard_balance_mut::<_,BalanceError>(|b|b.add_uneconomic_value(Zatoshis::const_from_u64(1))).unwrap();
    assert_eq!(balance_amounts(&large).unwrap_err().0,"BALANCE_OVERFLOW");
}

fn locked_balance_case(source:&Value)->Value {
    use zcash_client_backend::{data_api::locking::{OutputLockStore,LockOwner},wallet::OutputRef};
    use zcash_primitives::transaction::TxId;
    use zcash_protocol::{PoolType,ShieldedPool};
    let root=std::env::var("WALLET_TEST_ROOT").unwrap();
    let path=format!("{root}/balance-locked-{}.db",uuid::Uuid::new_v4());
    std::fs::write(&path,hex::decode(source["database"].as_str().unwrap()).unwrap()).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    crate::wallet::DOMAIN.with(|domain| {
        let mut d=domain.borrow_mut();let db=&mut d.active.first_mut().unwrap().wallet;
        db.lock_outputs(&[
            OutputRef::new(TxId::from_bytes([9;32]),PoolType::Shielded(ShieldedPool::Sapling),0),
            OutputRef::new(TxId::from_bytes([10;32]),PoolType::Transparent,0),
        ],LockOwner::new([55;32]),200u32.into()).unwrap();
    });
    let mut query=source["queries"][0].clone();
    query["expected"]["amounts"]["sapling"]["spendable"]=json!("0");
    query["expected"]["amounts"]["sapling"]["locked"]=json!("50000");
    query["expected"]["amounts"]["transparent"]["regular"]["spendable"]=json!("0");
    query["expected"]["amounts"]["transparent"]["regular"]["locked"]=json!("70000");
    let before=std::fs::read(&path).unwrap();
    assert_eq!(balance_amount_fixture(g,query["args"].clone()).unwrap(),query["expected"],"locks remain included once in total");
    assert_eq!(std::fs::read(&path).unwrap(),before);
    crate::wallet::storage_close(g).unwrap();
    json!({"database":hex::encode(std::fs::read(path).unwrap()),"queries":[query],"locked":true})
}

#[test]
fn account_balance_scanner_empty_uneconomic_coinbase_change() { balance_scanner_edge_cases(); }

#[test]
fn account_balance_scanned_coinbase_maturity_transition() {
    let cases=balance_scanner_edge_cases();
    for (scenario,spendable,pending) in [("coinbase-before-maturity","0","70000"),("coinbase-at-maturity","70000","0")] {
        let case=cases.iter().find(|case|case["scenario"]==scenario).expect("scanned maturity boundary fixture required");
        assert_eq!(case["queries"].as_array().unwrap().len(),2);
        for query in case["queries"].as_array().unwrap() {
            assert_eq!(query["expected"]["amounts"]["transparent"]["coinbase"],json!({
                "total":"70000","spendable":spendable,"locked":"0",
                "changePendingConfirmation":"0","pendingSpendability":pending,"uneconomic":"0"
            }));
        }
    }
}

fn balance_scanner_edge_cases()->Vec<Value> {
    use zcash_client_backend::{scanning::{scan_block,ScanningKeys,Nullifiers},data_api::{BlockMetadata,Balance}};
    use zcash_client_backend::proto::compact_formats::CompactSaplingSpend;
    use zcash_primitives::block::BlockHash;
    let mut cases=Vec::new();
    for scenario in ["empty","uneconomic","coinbase","change","coinbase-before-maturity","coinbase-at-maturity"] {
        // Pinned SQLite uses target = tip + 1 and target - mined >= 100.
        let tip=match scenario {"change"=>101u32,"coinbase-before-maturity"=>198,"coinbase-at-maturity"=>199,_=>100};
        let coinbase=scenario.starts_with("coinbase");
        let (path,g)=open();
        let mut input=fixture(10);
        input["birthday"].as_object_mut().unwrap().remove("recoverUntilExclusive");
        let account=call(g,"account_import",input.clone()).unwrap();
        let account_id=id(&json!({"accountId":account["id"]})).unwrap();
        let p=crate::Document::parse(PARAMS).unwrap();
        let key=UnifiedFullViewingKey::decode(&p,input["viewingKey"].as_str().unwrap()).unwrap();
        let birthday=birthday(&input["birthday"],PARAMS,&[3;32],&p).unwrap();
        let keys=ScanningKeys::from_account_ufvks([(account_id,key.clone())]);
        let mut cb=if scenario=="uneconomic" {balance_block(&key,1,5_000)} else {policy_block(&key)};
        if scenario=="empty" {
            cb.vtx.clear();
            let m=cb.chain_metadata.as_mut().unwrap();
            m.sapling_commitment_tree_size=0;m.orchard_commitment_tree_size=0;m.ironwood_commitment_tree_size=0;
        }
        if coinbase {cb.vtx[0].index=0;}
        let prior=BlockMetadata::from_parts(99u32.into(),BlockHash([7;32]),Some(0),Some(0),Some(0));
        let scan=scan_block(&p,cb,&keys,&Nullifiers::empty(),Some(&prior)).unwrap();
        let mut scans=Vec::new();
        if scenario=="change" {
            let mut nullifiers=Nullifiers::empty();nullifiers.update_with(&scan);
            let mut next=balance_block(&key,40_000,45_000);
            next.height=101;next.hash=vec![12;32];next.prev_hash=vec![8;32];
            next.vtx[0].txid=vec![13;32];
            next.vtx[0].spends.push(CompactSaplingSpend {nf:nullifiers.sapling()[0].1.0.to_vec()});
            let m=next.chain_metadata.as_mut().unwrap();
            m.sapling_commitment_tree_size=2;m.orchard_commitment_tree_size=2;m.ironwood_commitment_tree_size=2;
            let next=scan_block(&p,next,&keys,&nullifiers,Some(&scan.to_block_metadata())).unwrap();
            assert!(next.transactions()[0].sapling_outputs()[0].is_change(),"scanner identifies change from actual prior note spend");
            scans.push(scan);scans.push(next);
        } else {scans.push(scan);}
        if coinbase {
            // Advance actual scanned chain state, retaining the original transaction at 100.
            for height in 101..=tip {
                let prior=scans.last().unwrap().to_block_metadata();
                let next=zcash_client_backend::proto::compact_formats::CompactBlock {
                    height:height.into(),hash:vec![height as u8;32],prev_hash:prior.block_hash().0.to_vec(),time:height,
                    chain_metadata:Some(zcash_client_backend::proto::compact_formats::ChainMetadata {
                        sapling_commitment_tree_size:1,orchard_commitment_tree_size:1,ironwood_commitment_tree_size:1
                    }),..Default::default()
                };
                scans.push(scan_block(&p,next,&keys,&Nullifiers::empty(),Some(&prior)).unwrap());
            }
        }
        crate::wallet::DOMAIN.with(|domain| {
            let mut d=domain.borrow_mut();let db=&mut d.active.first_mut().unwrap().wallet;
            db.update_chain_tip(tip.into()).unwrap();
            db.put_blocks(birthday.prior_chain_state(),scans).unwrap();
            if coinbase {
                // Same transaction scanned at index zero supplies native coinbase identity.
                let address=*db.get_last_generated_address_matching(account_id,UnifiedAddressRequest::AllAvailableKeys).unwrap().unwrap().transparent().unwrap();
                let output=zcash_client_backend::wallet::WalletTransparentOutput::from_parts(
                    zcash_transparent::bundle::OutPoint::new([9;32],0),
                    zcash_transparent::bundle::TxOut::new(zcash_protocol::value::Zatoshis::const_from_u64(70_000),address.script().into()),
                    Some(100u32.into()),Some(account_id),Some(TransparentKeyScope::EXTERNAL),None).unwrap();
                db.put_received_transparent_utxo(&output).unwrap();
            }
        });
        let mut queries=Vec::new();
        for trusted in [1,2] {
            let args=json!({"accountId":account["id"],"confirmations":{"trusted":trusted,"untrusted":trusted,"allowZeroConfirmationShielding":false}});
            let expected=crate::wallet::DOMAIN.with(|domain| {
                let d=domain.borrow();let db=&d.active.first().unwrap().wallet;
                let policy=zcash_client_backend::data_api::wallet::ConfirmationsPolicy::new(
                    std::num::NonZeroU32::new(trusted).unwrap(),std::num::NonZeroU32::new(trusted).unwrap(),false).unwrap();
                let summary=db.get_wallet_summary(policy).unwrap().expect("scanned summary available");
                let b=&summary.account_balances()[&account_id];
                match scenario {
                    "empty"=>{assert_eq!(u64::from(b.total()),0);assert_eq!(u64::from(b.uneconomic_value()),0);},
                    "uneconomic"=>{
                        assert_eq!(u64::from(b.total()),0);assert_eq!(u64::from(b.uneconomic_value()),10_001);
                        assert_eq!(u64::from(b.sapling_balance().uneconomic_value()),1);
                        assert_eq!(u64::from(b.orchard_balance().uneconomic_value()),5_000);
                        assert_eq!(u64::from(b.ironwood_balance().uneconomic_value()),5_000);
                    },
                    "coinbase"=>{
                        assert_eq!(u64::from(b.unshielded_regular_balance().total()),0);
                        assert_eq!(u64::from(b.unshielded_coinbase_balance().total()),70_000);
                        assert_eq!(u64::from(b.unshielded_coinbase_balance().value_pending_spendability()),70_000);
                    },
                    "coinbase-before-maturity"|"coinbase-at-maturity"=>{
                        assert_eq!(*b.unshielded_regular_balance(),Balance::ZERO);
                        let cb=b.unshielded_coinbase_balance();
                        assert_eq!([
                            u64::from(cb.total()),u64::from(cb.spendable_value()),u64::from(cb.locked_value()),
                            u64::from(cb.change_pending_confirmation()),u64::from(cb.value_pending_spendability()),u64::from(cb.uneconomic_value())
                        ],if tip==199 {[70_000,70_000,0,0,0,0]} else {[70_000,0,0,0,70_000,0]});
                    },
                    "change"=>{
                        assert_eq!(u64::from(b.sapling_balance().total()),40_000,"spent note excluded");
                        for (balance,value) in [(b.sapling_balance(),40_000),(b.orchard_balance(),45_000),(b.ironwood_balance(),45_000)] {
                            assert_eq!(u64::from(balance.change_pending_confirmation()),if trusted==2 {value} else {0});
                        }
                        assert_eq!(u64::from(b.sapling_balance().spendable_value()),0,"a newly mined change note has no older anchor yet");
                        assert_eq!(u64::from(b.sapling_balance().value_pending_spendability()),if trusted==1 {40_000} else {0});
                    },
                    _=>unreachable!(),
                }
                let bucket=|b:&Balance|json!({"total":u64::from(b.total()).to_string(),"spendable":u64::from(b.spendable_value()).to_string(),"locked":u64::from(b.locked_value()).to_string(),"changePendingConfirmation":u64::from(b.change_pending_confirmation()).to_string(),"pendingSpendability":u64::from(b.value_pending_spendability()).to_string(),"uneconomic":u64::from(b.uneconomic_value()).to_string()});
                let legacy=b.orchard_balance();
                json!({"accountId":account["id"],"amounts":{"total":u64::from(b.total()).to_string(),"uneconomic":u64::from(b.uneconomic_value()).to_string(),
                    "observedTotal":(u64::from(b.total())+u64::from(b.uneconomic_value())).to_string(),
                    "transparent":{"regular":bucket(b.unshielded_regular_balance()),"coinbase":bucket(b.unshielded_coinbase_balance())},
                    "sapling":bucket(b.sapling_balance()),"ironwood":bucket(b.ironwood_balance()),
                    "unsupportedLegacy":if legacy.total()==zcash_protocol::value::Zatoshis::ZERO&&legacy.uneconomic_value()==zcash_protocol::value::Zatoshis::ZERO {Value::Null} else {json!({"kind":"legacyOrchard","balance":bucket(legacy)})}}})
            });
            let before=std::fs::read(&path).unwrap();
            assert_eq!(balance_amount_fixture(g,args.clone()).unwrap(),expected,"{scenario}");
            assert_eq!(std::fs::read(&path).unwrap(),before);
            queries.push(json!({"args":args,"expected":expected,"scan":native_scan_fixture()}));
        }
        crate::wallet::storage_close(g).unwrap();
        let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        for query in &queries {assert_eq!(balance_amount_fixture(g,query["args"].clone()).unwrap(),query["expected"],"{scenario} reopen");}
        crate::wallet::storage_close(g).unwrap();
        cases.push(json!({"scenario":scenario,"database":hex::encode(std::fs::read(&path).unwrap()),"queries":queries}));
    }
    cases
}

#[test]
fn persistent_scan_ingestion_plan_rollback_revision_and_reopen() {
    let (path,g)=open();
    let mut input=fixture(10);
    input["birthday"].as_object_mut().unwrap().remove("recoverUntilExclusive");
    let account=call(g,"account_import",input.clone()).unwrap();
    let scan=|generation,op,input:Value| crate::wallet::scan::scan_call(generation,op,&input.to_string())
        .map(|s|serde_json::from_str::<Value>(&s).unwrap());
    let args=json!({"accountId":account["id"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true}});
    let before=call(g,"account_balance",args.clone()).unwrap();
    let target=json!({"height":100,"hash":"08".repeat(32)});
    let plan=scan(g,"scan_plan",json!({"target":target})).unwrap();
    assert_ne!(plan["revision"],before["scan"]["revision"]);
    assert!(plan["ranges"].as_array().unwrap().iter().any(|r|r["start"]==100 && r["endExclusive"]==101));
    let p=crate::Document::parse(PARAMS).unwrap();
    let key=UnifiedFullViewingKey::decode(&p,input["viewingKey"].as_str().unwrap()).unwrap();
    let block=policy_block(&key);
    let request=json!({"revision":plan["revision"],"target":target,"priorTreeState":input["birthday"]["priorTreeState"],"blocks":[hex::encode(block.encode_to_vec())]});
    let planned=call(g,"account_balance",args.clone()).unwrap();
    for corrupt in 0..9 {
        let mut bad=request.clone();
        match corrupt {
            0=>bad["revision"]=before["scan"]["revision"].clone(),
            1=>bad["target"]["hash"]=json!("09".repeat(32)),
            2=>{let mut b=block.clone();b.prev_hash=vec![0;32];bad["blocks"]=json!([hex::encode(b.encode_to_vec())]);},
            3=>{let mut b=block.clone();b.header=vec![0];bad["blocks"]=json!([hex::encode(b.encode_to_vec())]);},
            4=>{let mut b=block.clone();b.vtx[0].outputs[0].cmu=vec![255;32];bad["blocks"]=json!([hex::encode(b.encode_to_vec())]);},
            5=>{let mut b=block.clone();b.hash=vec![0;32];bad["blocks"]=json!([hex::encode(b.encode_to_vec())]);},
            6=>bad["blocks"]=json!(vec![hex::encode(block.encode_to_vec());17]),
            7=>bad["priorTreeState"]=json!("00"),
            _=>{let mut b=block.clone();b.vtx[0].outputs=vec![b.vtx[0].outputs[0].clone();4097];bad["blocks"]=json!([hex::encode(b.encode_to_vec())]);},
        }
        assert!(scan(g,"scan_ingest_batch",bad).is_err(),"corrupt case {corrupt}");
        assert_eq!(call(g,"account_balance",args.clone()).unwrap(),planned);
    }
    // Force the final revision write to fail after real native scan/put_blocks.
    crate::wallet::DOMAIN.with(|domain| {
        let mut domain=domain.borrow_mut();let active=domain.active.first_mut().unwrap();
        active.wallet.transactionally_with_extension(|_,ext| -> Result<()> {
            ext.execute("UPDATE ext_wallet_revision SET sequence=9223372036854775807",[])?;Ok(())
        }).unwrap();
        let epoch=plan["revision"].as_str().unwrap().split(':').next().unwrap();
        active.scan_plan=Some((format!("{epoch}:9223372036854775807"),target.clone()));
    });
    let overflow=call(g,"account_balance",args.clone()).unwrap();
    let bytes=std::fs::read(&path).unwrap();
    let mut failed=request.clone();failed["revision"]=overflow["scan"]["revision"].clone();
    assert_eq!(scan(g,"scan_ingest_batch",failed).unwrap_err(),"STORAGE_ERROR");
    assert_eq!(std::fs::read(&path).unwrap(),bytes);
    assert_eq!(call(g,"account_balance",args.clone()).unwrap(),overflow);
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(scan(g,"scan_ingest_batch",request.clone()).unwrap_err(),"STALE_REVISION");
    let plan=scan(g,"scan_plan",json!({"target":target})).unwrap();
    let mut request=request;request["revision"]=plan["revision"].clone();
    // Valid protobuf field order and future unknown fields are not a new wire format.
    let canonical=block.encode_to_vec();assert_eq!(&canonical[..2],&[16,100]);
    let mut reordered=canonical[2..].to_vec();reordered.extend_from_slice(&canonical[..2]);
    reordered.extend_from_slice(&[0xa0,0x06,0x00]); // unknown field100, varint0
    request["blocks"]=json!([hex::encode(reordered)]);
    let committed=scan(g,"scan_ingest_batch",request.clone()).unwrap();
    assert_eq!(committed["start"],100);assert_eq!(committed["endExclusive"],101);
    let balance=call(g,"account_balance",args.clone()).unwrap();
    assert_eq!(balance["scan"]["revision"],committed["revision"]);
    assert_eq!(balance["scan"]["fullyScannedHeight"],100);
    assert_eq!(balance["amounts"]["sapling"]["total"],"50000");
    assert_eq!(balance["amounts"]["ironwood"]["total"],"60000");
    assert_eq!(balance["amounts"]["unsupportedLegacy"]["balance"]["total"],"60000");
    assert_eq!(scan(g,"scan_ingest_batch",request).unwrap_err(),"STALE_REVISION");
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let reopened=call(g,"account_balance",args).unwrap();
    assert_eq!(reopened["amounts"],balance["amounts"]);
    assert_eq!(reopened["scan"]["fullyScannedHeight"],100);
    assert_ne!(reopened["scan"]["revision"],balance["scan"]["revision"]);
    crate::wallet::storage_close(g).unwrap();
}

// Spend tests need a checkpoint behind the tip; scan tests retain the boundary fixture.
fn confirmed_scan_fixture() -> Value {
    let mut fixture=full_scan_fixture();
    let batches=fixture["batches"].as_array_mut().unwrap();
    let blocks=batches.last_mut().unwrap()["blocks"].as_array_mut().unwrap();
    let last=zcash_client_backend::proto::compact_formats::CompactBlock::decode(&hex::decode(blocks.last().unwrap().as_str().unwrap()).unwrap()[..]).unwrap();
    let next=zcash_client_backend::proto::compact_formats::CompactBlock {
        height:last.height+1,hash:vec![12;32],prev_hash:last.hash,time:last.time+1,
        chain_metadata:last.chain_metadata,..Default::default()
    };
    blocks.push(json!(hex::encode(next.encode_to_vec())));
    fixture["target"]=json!({"height":next.height,"hash":"0c".repeat(32)});
    fixture
}

fn full_scan_fixture() -> Value {
    use zcash_client_backend::proto::compact_formats::{CompactBlock,ChainMetadata};
    let (path,g)=open();
    let p=crate::Document::parse(PARAMS).unwrap();
    let mut input=fixture(10);input["birthday"]=json!("fullScan");
    let account=call(g,"account_import",input.clone()).unwrap();
    let key=UnifiedFullViewingKey::decode(&p,input["viewingKey"].as_str().unwrap()).unwrap();
    let hash=|height:u32| -> Vec<u8> {
        match height {0=>vec![3;32],99=>vec![7;32],100=>vec![8;32],_=>{
            let mut h=vec![0x42;32];h[..4].copy_from_slice(&height.to_le_bytes());h
        }}
    };
    let blocks=(1u32..=100).map(|h|if h==100 {policy_block(&key)} else {
        CompactBlock {height:u64::from(h),hash:hash(h),prev_hash:hash(h-1),time:h+1,
            chain_metadata:Some(ChainMetadata {sapling_commitment_tree_size:0,orchard_commitment_tree_size:0,ironwood_commitment_tree_size:0}),..Default::default()}
    }).collect::<Vec<_>>();
    let target=json!({"height":100,"hash":hex::encode(hash(100))});
    let scan=|generation,op,input:Value| crate::wallet::scan::scan_call(generation,op,&input.to_string())
        .map(|s|serde_json::from_str::<Value>(&s).unwrap()).unwrap();
    let mut revision=scan(g,"scan_plan",json!({"target":target}))["revision"].clone();
    let mut batches=Vec::new();
    for batch in blocks.chunks(16) {
        let height=batch[0].height-1;
        let mut display_hash=hash(height as u32);display_hash.reverse();
        let state=TreeState {network:"regtest".into(),height,hash:hex::encode(display_hash),time:height as u32+1,
            sapling_tree:"000000".into(),orchard_tree:"000000".into(),ironwood_tree:"000000".into()};
        let data=json!({"priorTreeState":hex::encode(state.encode_to_vec()),"blocks":batch.iter().map(|b|hex::encode(b.encode_to_vec())).collect::<Vec<_>>()});
        let mut request=data.clone();request["target"]=target.clone();request["revision"]=revision;
        revision=scan(g,"scan_ingest_batch",request)["revision"].clone();
        batches.push(data);
    }
    let args=json!({"accountId":account["id"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true}});
    let balance=call(g,"account_balance",args.clone()).unwrap();
    assert_eq!(balance["scan"]["fullyScannedHeight"],100);
    assert_eq!(balance["amounts"]["sapling"]["total"],"50000");
    assert_eq!(balance["amounts"]["ironwood"]["total"],"60000");
    assert_eq!(balance["amounts"]["unsupportedLegacy"]["balance"]["total"],"60000");
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let reopened=call(g,"account_balance",args).unwrap();
    assert_eq!(reopened["amounts"],balance["amounts"]);
    assert_eq!(reopened["scan"]["fullyScannedHeight"],100);
    assert_ne!(reopened["scan"]["revision"],balance["scan"]["revision"]);
    crate::wallet::storage_close(g).unwrap();
    let mut state=balance["scan"].clone();state.as_object_mut().unwrap().remove("revision");
    json!({"import":input,"target":target,"batches":batches,"expectedAmounts":balance["amounts"],"expectedScan":state})
}

#[test]
fn persistent_full_scan_fixture_reopens_with_real_three_pool_balance() {
    let scan=full_scan_fixture();
    assert_eq!(scan["batches"].as_array().unwrap().len(),7);
    std::fs::write(format!("{}/scan-fixture.json",std::env::var("WALLET_TEST_ROOT").unwrap()),scan.to_string()).unwrap();
}

mod enhancement;

mod query;

mod inventory;

#[test]
fn wallet_memory_is_explicit_and_ephemeral() {
    let open = || crate::wallet::storage_initialize_memory("zcash-js-network/1", PARAMS, &[3;32]).unwrap();
    let g = open();
    assert_eq!(call(g,"account_list",json!({})).unwrap(),json!([]));
    let account = call(g,"account_import",fixture(29)).unwrap();
    assert_eq!(call(g,"account_get",json!({"accountId":account["id"]})).unwrap(),account);
    assert_eq!(call(g,"account_list",json!({})).unwrap().as_array().unwrap().len(),1);
    crate::wallet::storage_close(g).unwrap();
    let fresh = open();
    assert_eq!(call(fresh,"account_list",json!({})).unwrap(),json!([]));
    crate::wallet::storage_close(fresh).unwrap();
}

#[test]
fn native_signer_outlives_wallet_and_binds_reopened_account() {
    use crate::wallet::signer::*;
    let (path,g)=open();
    let input=hd_input(0).to_string();
    let created:Value=serde_json::from_str(&signer_create_account(g,"account_import_hd",&input,MNEMONIC.as_bytes().to_vec(),vec![]).unwrap()).unwrap();
    let token=created["signerToken"].as_u64().unwrap() as u32;
    let id=created["account"]["id"].as_str().unwrap();
    let description=signer_describe(token).unwrap();
    assert_eq!(signer_bind(token,g,id).unwrap(),"ready");
    assert_eq!(call(g,"account_get",json!({"accountId":id})).unwrap()["signerAttached"],true);
    assert_eq!(signer_create_account(g,"account_import_hd",&input,MNEMONIC.as_bytes().to_vec(),vec![]).unwrap_err(),"ACCOUNT_COLLISION");
    assert_eq!(signer_describe(token+1).unwrap_err(),"STALE_HANDLE");
    crate::wallet::storage_close(g).unwrap();
    assert_eq!(signer_describe(token).unwrap(),description);
    let reopened=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(signer_bind(token,reopened,id).unwrap(),"ready");
    signer_unbind(token,reopened,id).unwrap();
    crate::wallet::storage_close(reopened).unwrap();
    let (_other,g2)=open();
    let mut viewing=fixture(11);
    viewing["viewingKey"]=serde_json::from_str::<Value>(&description).unwrap()["viewingKey"].clone();
    let second=call(g2,"account_import",viewing).unwrap();
    assert_eq!(signer_bind(token,g2,second["id"].as_str().unwrap()).unwrap(),"ready");
    let different=call(g2,"account_import",fixture(12)).unwrap();
    assert_eq!(signer_bind(token,g2,different["id"].as_str().unwrap()).unwrap_err(),"SIGNER_MISMATCH");
    crate::wallet::storage_close(g2).unwrap();
    let (_partial,g2)=open();
    let mut viewing=fixture(11);
    viewing["viewingKey"]=serde_json::from_str::<Value>(&description).unwrap()["viewingKey"].clone();
    viewing["enabledPools"]=json!(["sapling"]);
    let second=call(g2,"account_import",viewing).unwrap();
    assert_eq!(signer_bind(token,g2,second["id"].as_str().unwrap()).unwrap(),"ready");
    signer_release(token).unwrap();
    assert_eq!(signer_describe(token).unwrap_err(),"STALE_HANDLE");
    assert_eq!(call(g2,"account_get",json!({"accountId":second["id"]})).unwrap()["signerAttached"],false);
    assert_eq!(signer_bind(token,g2,second["id"].as_str().unwrap()).unwrap_err(),"STALE_HANDLE");
    crate::wallet::storage_close(g2).unwrap();
}

#[test]
fn native_signer_two_open_wallets_remain_independent() {
    use crate::wallet::signer::*;
    let (_p1,g1)=open(); let (_p2,g2)=open();
    let created:Value=serde_json::from_str(&signer_create_account(g1,"account_import_hd",&hd_input(0).to_string(),MNEMONIC.as_bytes().to_vec(),vec![]).unwrap()).unwrap();
    let token=created["signerToken"].as_u64().unwrap() as u32;
    assert_eq!(call(g2,"account_list",json!({})).unwrap(),json!([]));
    let mut viewing=fixture(13);
    viewing["viewingKey"]=serde_json::from_str::<Value>(&signer_describe(token).unwrap()).unwrap()["viewingKey"].clone();
    let imported=call(g2,"account_import",viewing).unwrap();
    assert_eq!(signer_bind(token,g2,imported["id"].as_str().unwrap()).unwrap(),"ready");
    crate::wallet::storage_close(g1).unwrap();
    assert_eq!(call(g1,"account_list",json!({})).unwrap_err(),"STALE_HANDLE");
    assert_eq!(call(g2,"account_list",json!({})).unwrap().as_array().unwrap().len(),1);
    assert!(signer_describe(token).is_ok());
    crate::wallet::storage_close(g2).unwrap(); signer_release(token).unwrap();
}

#[test]
fn native_restore_signer_preserves_existing_account_and_scan_revision() {
    use crate::wallet::signer::*;
    let (path,g)=open();
    let account=mnemonic(g,hd_input(7),MNEMONIC.as_bytes(),b"restore-passphrase").unwrap();
    let id=account["id"].as_str().unwrap();
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let before=call(g,"account_list",json!({})).unwrap();
    let scan=crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap();
    let input=json!({"accountId":id}).to_string();
    assert_eq!(signer_create_account(g,"account_restore_signer",&input,MNEMONIC.as_bytes().to_vec(),vec![]).unwrap_err(),"SIGNER_MISMATCH");
    let restored:Value=serde_json::from_str(&signer_create_account(g,"account_restore_signer",&input,MNEMONIC.as_bytes().to_vec(),b"restore-passphrase".to_vec()).unwrap()).unwrap();
    let token=restored["signerToken"].as_u64().unwrap() as u32;
    assert_eq!(restored["account"],before[0]);
    assert_eq!(call(g,"account_list",json!({})).unwrap(),before);
    assert_eq!(crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap(),scan);
    assert_eq!(signer_bind(token,g,id).unwrap(),"ready");
    signer_release(token).unwrap();
    assert_eq!(call(g,"account_list",json!({})).unwrap(),before);
    assert_eq!(signer_create_account(g,"account_restore_signer",&json!({"accountId":uuid::Uuid::new_v4().to_string()}).to_string(),MNEMONIC.as_bytes().to_vec(),vec![]).unwrap_err(),"ACCOUNT_NOT_FOUND");
    crate::wallet::storage_close(g).unwrap();
}
