use super::*;
fn inventory(g:u32,op:&str,input:Value)->std::result::Result<Value,String>{crate::wallet::query::query_call(g,op,&input.to_string()).map(|s|serde_json::from_str(&s).unwrap())}
#[test]
fn inventory_all_rows_filters_spends_locks_and_cursor() {
    let f=query::history_fixture();let(path,g)=open();crate::wallet::storage_close(g).unwrap();std::fs::write(&path,hex::decode(f["database"].as_str().unwrap()).unwrap()).unwrap();
    let reopen=||crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let args=json!({"accountId":f["accountId"]});let g=reopen();
    let before=std::fs::read(&path).unwrap();let all=inventory(g,"wallet_notes",args.clone()).unwrap();
    assert!(all["unsupportedLegacyRowsOmitted"].as_bool().unwrap());assert!(all["items"].as_array().unwrap().len()>=2);
    assert!(all["items"].as_array().unwrap().iter().all(|n|n["pool"]!="legacyOrchard"&&n["eligibility"]=="unknown"));
    let page=inventory(g,"wallet_notes",json!({"accountId":f["accountId"],"limit":1})).unwrap();let cursor=page["nextCursor"].clone();assert!(cursor.is_string());
    assert_eq!(inventory(g,"wallet_notes",json!({"accountId":f["accountId"],"cursor":cursor,"locked":false})).unwrap_err(),"INVALID_ARGUMENT");
    let next=inventory(g,"wallet_notes",json!({"accountId":f["accountId"],"cursor":cursor,"limit":1})).unwrap();assert_ne!(next["items"][0],page["items"][0]);
    assert_eq!(std::fs::read(&path).unwrap(),before);crate::wallet::storage_close(g).unwrap();
    let g=reopen();assert_eq!(inventory(g,"wallet_notes",json!({"accountId":f["accountId"],"cursor":cursor})).unwrap_err(),"CURSOR_STALE");crate::wallet::storage_close(g).unwrap();
    // Mutate only the closed synthetic DB: one real received note, explicit native
    // spending relationships and lock columns; production APIs never write this fixture.
    for (mined,expiry,state) in [(Some(100),Some(110),"spent"),(Some(101),Some(110),"unknown"),(None,Some(110),"pendingSpend"),(None,Some(99),"unknown"),(None,None,"unknown")] {
        let conn=rusqlite::Connection::open(&path).unwrap();
        conn.execute("DELETE FROM sapling_received_note_spends",[]).unwrap();
        conn.execute("INSERT OR REPLACE INTO transactions(id_tx,txid,mined_height,expiry_height,min_observed_height) VALUES(9000,?1,?2,?3,100)",rusqlite::params![&[0x99u8;32],mined,expiry]).unwrap();
        conn.execute("INSERT INTO sapling_received_note_spends(sapling_received_note_id,transaction_id) SELECT id,9000 FROM sapling_received_notes WHERE nf IS NOT NULL LIMIT 1",[]).unwrap();
        conn.execute("UPDATE sapling_received_notes SET lock_expiry_height=101 WHERE nf IS NOT NULL",[]).unwrap();drop(conn);
        let g=reopen();let page=inventory(g,"wallet_notes",json!({"accountId":f["accountId"],"pool":"sapling","spendState":state,"locked":true})).unwrap();
        assert!(!page["items"].as_array().unwrap().is_empty(),"{state}: {page}");
        let note=&page["items"][0];assert_eq!(note["lock"]["operationId"],Value::Null);assert_eq!(note["lock"]["expiresAtHeight"],101);
        if state=="spent"||state=="pendingSpend" {assert_eq!(note["spendingTxid"],"99".repeat(32));}
        crate::wallet::storage_close(g).unwrap();
    }
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute("UPDATE transactions SET expiry_height=110 WHERE id_tx=9000",[]).unwrap();
    conn.execute("INSERT INTO transactions(id_tx,txid,expiry_height,min_observed_height) VALUES(9001,?1,110,100)",[&[0x98u8;32]]).unwrap();
    conn.execute("INSERT INTO sapling_received_note_spends SELECT sapling_received_note_id,9001 FROM sapling_received_note_spends WHERE transaction_id=9000",[]).unwrap();
    conn.execute("DELETE FROM scan_queue",[]).unwrap();drop(conn);
    let g=reopen();let page=inventory(g,"wallet_notes",json!({"accountId":f["accountId"],"pool":"sapling","spendState":"unknown"})).unwrap();
    assert!(page["items"].as_array().unwrap().iter().any(|n|n["spendingTxid"].is_null()&&!n["lockKnown"].as_bool().unwrap()));
    let filtered=inventory(g,"wallet_notes",json!({"accountId":f["accountId"],"locked":false})).unwrap();assert!(filtered["items"].as_array().unwrap().iter().all(|n|n["lockKnown"]==true));
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn inventory_native_complete_notes_and_transparent_observation() {
    let fixture=full_scan_fixture();let(path,g)=open();let account=call(g,"account_import",fixture["import"].clone()).unwrap();
    let target=fixture["target"].clone();let mut plan:Value=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap()).unwrap();
    for batch in fixture["batches"].as_array().unwrap(){let mut batch=batch.clone();batch["target"]=target.clone();batch["revision"]=plan["revision"].clone();plan=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_ingest_batch",&batch.to_string()).unwrap()).unwrap();}
    let page=inventory(g,"wallet_notes",json!({"accountId":account["id"],"spendState":"unspent"})).unwrap();
    assert!(!page["items"].as_array().unwrap().is_empty());assert!(page["items"].as_array().unwrap().iter().all(|n|n["spendingTxid"].is_null()&&n["lockKnown"]==true&&n["lock"].is_null()));
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute("UPDATE transactions SET block=NULL,mined_height=101 WHERE id_tx IN (SELECT transaction_id FROM sapling_received_notes)",[]).unwrap();drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert!(inventory(g,"wallet_notes",json!({"accountId":account["id"],"pool":"sapling","spendState":"unspent"})).unwrap()["items"].as_array().unwrap().is_empty());
    crate::wallet::storage_close(g).unwrap();
    let f=enhancement::enhancement_fixture();std::fs::write(&path,hex::decode(f["database"].as_str().unwrap()).unwrap()).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let pending:Value=serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap();let request=pending["requests"].as_array().unwrap().iter().find(|r|r["txid"]==f["txid"]).unwrap();
    crate::wallet::enhancement::enhancement_call(g,"enhancement_apply",&json!({"revision":pending["revision"],"request":request,"result":{"transactions":[{"bytes":f["raw"],"minedHeight":100}]}}).to_string()).unwrap();
    let page=inventory(g,"wallet_utxos",json!({"accountId":f["accountId"],"uneconomic":true})).unwrap();
    assert_eq!(page["items"][0]["value"],"1000");assert_eq!(page["items"][0]["txid"],f["txid"]);assert!(page["items"][0]["address"].is_string());assert_eq!(page["unsupportedLegacyRowsOmitted"],false);
    assert!(inventory(g,"wallet_utxos",json!({"accountId":f["accountId"],"uneconomic":false})).unwrap()["items"].as_array().unwrap().is_empty());
    crate::wallet::storage_close(g).unwrap();
}
