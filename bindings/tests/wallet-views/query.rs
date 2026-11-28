use super::*;
fn query(g:u32,operation:&str,input:Value)->std::result::Result<Value,String> {
    crate::wallet::query::query_call(g,operation,&input.to_string()).map(|s|serde_json::from_str(&s).unwrap())
}
pub(super) fn history_fixture() -> Value {
    let fixture=full_scan_fixture();let (path,g)=open();
    let account=call(g,"account_import",fixture["import"].clone()).unwrap();
    assert_eq!(query(g,"wallet_transaction",json!({"txid":"00".repeat(32)})).unwrap(),Value::Null);
    assert_eq!(query(g,"wallet_history",json!({"accountId":"00000000-0000-0000-0000-000000000000"})).unwrap_err(),"ACCOUNT_NOT_FOUND");
    assert_eq!(query(g,"wallet_history",json!({"accountId":account["id"],"limit":0})).unwrap_err(),"INVALID_ARGUMENT");
    let target=fixture["target"].clone();
    let mut plan:Value=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap()).unwrap();
    for batch in fixture["batches"].as_array().unwrap() {
        let mut batch=batch.clone();batch["target"]=target.clone();batch["revision"]=plan["revision"].clone();
        plan=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_ingest_batch",&batch.to_string()).unwrap()).unwrap();
    }
    let before=std::fs::read(&path).unwrap();
    let history=query(g,"wallet_history",json!({"accountId":account["id"]})).unwrap();
    assert_eq!(history["historyComplete"],"unknown");
    assert!(!history["items"].as_array().unwrap().is_empty());
    let mut pools=std::collections::BTreeSet::new();
    for row in history["items"].as_array().unwrap() {
        assert_eq!(row["accountId"],account["id"]);
        let detail=query(g,"wallet_transaction",json!({"txid":row["txid"]})).unwrap();
        assert_eq!(detail["raw"],Value::Null,"known compact record awaits full enhancement");
        assert_eq!(detail["scan"],history["scan"]);
        for output in detail["outputs"].as_array().unwrap() {
            pools.insert(output["pool"].as_str().unwrap().to_owned());
            assert!(output["receivingAccountIds"].as_array().unwrap().contains(&account["id"]));
            assert_eq!(output["memo"]["kind"],"unknown");
        }
    }
    assert!(pools.contains("sapling")&&pools.contains("legacyOrchard")&&pools.contains("ironwood"));
    assert_eq!(std::fs::read(&path).unwrap(),before,"all query projections are read-only");
    // A second local record and a distinct sending account exercise pagination and
    // relationships without inventing a second scanner or a signed transaction.
    let sender=call(g,"account_import",super::fixture(11)).unwrap();
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute("INSERT INTO transactions(txid,mined_height,tx_index,min_observed_height) VALUES(?1,100,1,100)",[&[0x55u8;32]]).unwrap();
    let new=conn.last_insert_rowid();
    conn.execute("INSERT INTO sapling_received_notes(transaction_id,output_index,account_id,diversifier,value,rcm,is_change,memo) SELECT ?1,output_index,account_id,diversifier,value,rcm,is_change,X'6869' FROM sapling_received_notes LIMIT 1",[new]).unwrap();
    let sender_id=uuid::Uuid::parse_str(sender["id"].as_str().unwrap()).unwrap();
    conn.execute("INSERT INTO sent_notes(transaction_id,output_pool,output_index,from_account_id,to_account_id,value,memo) SELECT n.transaction_id,2,n.output_index,a.id,n.account_id,n.value,X'6869' FROM sapling_received_notes n,accounts a WHERE a.uuid=?1 AND n.transaction_id!=?2 LIMIT 1",rusqlite::params![sender_id.as_bytes(),new]).unwrap();
    drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let detail=query(g,"wallet_transaction",json!({"txid":history["items"][0]["txid"]})).unwrap();
    let output=detail["outputs"].as_array().unwrap().iter().find(|o|o["pool"]=="sapling").unwrap();
    assert_eq!(output["sendingAccountIds"],json!([sender["id"]]));
    assert_eq!(output["receivingAccountIds"],json!([account["id"]]));
    assert_eq!(output["memo"],json!({"kind":"text","text":"hi"}));
    assert_eq!(output["changeClassification"],"recorded");
    let page=query(g,"wallet_history",json!({"accountId":account["id"],"limit":1})).unwrap();
    assert!(page["nextCursor"].is_string(),"fixture has multiple transactions");
    let cursor=page["nextCursor"].clone();
    let next=query(g,"wallet_history",json!({"accountId":account["id"],"limit":1,"cursor":cursor})).unwrap();
    assert_ne!(page["items"][0]["txid"],next["items"][0]["txid"]);
    crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap();
    assert_eq!(query(g,"wallet_history",json!({"accountId":account["id"],"cursor":cursor})).unwrap_err(),"CURSOR_STALE");
    let page=query(g,"wallet_history",json!({"accountId":account["id"],"limit":1})).unwrap();
    crate::wallet::storage_close(g).unwrap();
    let database=hex::encode(std::fs::read(&path).unwrap());
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(query(g,"wallet_history",json!({"accountId":account["id"],"cursor":page["nextCursor"]})).unwrap_err(),"CURSOR_STALE");
    crate::wallet::storage_close(g).unwrap();
    for (bytes,expected) in [(vec![0xf6],json!({"kind":"empty"})),(std::iter::once(0xff).chain(std::iter::repeat_n(1,511)).collect::<Vec<_>>(),json!({"kind":"binary","bytes":format!("ff{}","01".repeat(511))}))] {
        let conn=rusqlite::Connection::open(&path).unwrap();
        conn.execute("UPDATE sapling_received_notes SET memo=?1",[&bytes]).unwrap();
        conn.execute("UPDATE sent_notes SET memo=?1",[&bytes]).unwrap();drop(conn);
        let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        let detail=query(g,"wallet_transaction",json!({"txid":history["items"][0]["txid"]})).unwrap();
        assert_eq!(detail["outputs"].as_array().unwrap().iter().find(|o|o["pool"]=="sapling").unwrap()["memo"],expected);
        crate::wallet::storage_close(g).unwrap();
    }
    // Reject oversized recorded text before producing a JSON aggregate.
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute("UPDATE sent_notes SET to_address=?1",["x".repeat(1024*1024)]).unwrap();drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let before=std::fs::read(&path).unwrap();
    assert_eq!(query(g,"wallet_transaction",json!({"txid":history["items"][0]["txid"]})).unwrap_err(),"RESOURCE_LIMIT");
    assert_eq!(std::fs::read(&path).unwrap(),before);
    crate::wallet::storage_close(g).unwrap();
    json!({"database":database,"accountId":account["id"],"txids":[page["items"][0]["txid"],next["items"][0]["txid"]],"target":target})
}
#[test]
fn query_real_scan_history_detail_and_revision_bound_pages() {history_fixture();}
#[test]
fn query_enhanced_bytes_are_distinct_from_known_unenhanced_record() {
    let f=enhancement::enhancement_fixture();let (path,g)=open();crate::wallet::storage_close(g).unwrap();
    std::fs::write(&path,hex::decode(f["database"].as_str().unwrap()).unwrap()).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let pending:Value=serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap();
    let request=pending["requests"].as_array().unwrap().iter().find(|r|r["txid"]==f["txid"]).unwrap();
    crate::wallet::enhancement::enhancement_call(g,"enhancement_apply",&json!({"revision":pending["revision"],"request":request,"result":{"transactions":[{"bytes":f["raw"],"minedHeight":100}]}}).to_string()).unwrap();
    let result=query(g,"wallet_transaction",json!({"txid":f["txid"]})).unwrap();
    assert_eq!(result["raw"],f["raw"]);assert_eq!(result["outputs"][0]["value"],"1000");
    assert_eq!(result["outputs"][0]["pool"],"transparent");
    assert_eq!(result["outputs"][0]["receivingAccountIds"],json!([f["accountId"]]));
    crate::wallet::storage_close(g).unwrap();
}
