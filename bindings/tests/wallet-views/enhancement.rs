use super::*;
fn enhance(g:u32,op:&str,input:Value)->std::result::Result<Value,String>{crate::wallet::enhancement::enhancement_call(g,op,&input.to_string()).map(|s|serde_json::from_str(&s).unwrap())}
pub(super) fn enhancement_fixture() -> Value {
    use zcash_client_backend::data_api::WalletRead;
    let (path,g)=open();let account=call(g,"account_import",fixture(10)).unwrap();
    let p=crate::Document::parse(PARAMS).unwrap();
    let key=UnifiedFullViewingKey::decode(&p,fixture(10)["viewingKey"].as_str().unwrap()).unwrap();
    let address=*key.default_address(UnifiedAddressRequest::AllAvailableKeys).unwrap().0.transparent().unwrap();
    let coinbase=zcash_transparent::bundle::TxIn::coinbase(100.into(),None).unwrap();
    let tx=zcash_primitives::transaction::TransactionData::<zcash_primitives::transaction::Authorized>::from_parts(
        zcash_primitives::transaction::TxVersion::V5,zcash_protocol::consensus::BranchId::for_height(&p,100.into()),0,120.into(),
        Some(zcash_transparent::bundle::Bundle{vin:vec![zcash_transparent::bundle::TxIn::from_parts(coinbase.prevout().clone(),zcash_transparent::address::Script::read(&[2u8,1,100][..]).unwrap(),coinbase.sequence())],vout:vec![zcash_transparent::bundle::TxOut::new(zcash_protocol::value::Zatoshis::const_from_u64(1000),address.script().into())],authorization:zcash_transparent::bundle::Authorized}),None,None,None).freeze().unwrap();
    let id=tx.txid();let mut raw=Vec::new();tx.write(&mut raw).unwrap();
    // Seed a closed synthetic fixture database with upstream retrieval intent.
    // The extension transaction authorizer remains unchanged in production.
    use zcash_client_backend::data_api::WalletWrite;
    crate::wallet::DOMAIN.with(|d|d.borrow_mut().active.first_mut().unwrap().wallet.update_chain_tip(100.into())).unwrap();
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute("INSERT INTO tx_retrieval_queue(txid,query_type) VALUES(?1,1)",[id.as_ref()]).unwrap();drop(conn);
    let database=hex::encode(std::fs::read(&path).unwrap());
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let requests=enhance(g,"enhancement_requests",json!({})).unwrap();
    let request=requests["requests"].as_array().unwrap().iter().find(|r|r["txid"]==id.to_string()).unwrap().clone();
    let apply=json!({"revision":requests["revision"],"request":request,"result":{"transactions":[{"bytes":hex::encode(&raw),"minedHeight":100}]}});
    let mut bad=apply.clone();bad["result"]["transactions"][0]["bytes"]=json!("00");
    assert_eq!(enhance(g,"enhancement_apply",bad).unwrap_err(),"INVALID_ARGUMENT");
    assert_eq!(enhance(g,"enhancement_requests",json!({})).unwrap(),requests);
    let applied=enhance(g,"enhancement_apply",apply.clone()).unwrap();assert_ne!(applied["revision"],requests["revision"]);
    assert_eq!(enhance(g,"enhancement_apply",apply).unwrap_err(),"STALE_REVISION");
    let remaining=enhance(g,"enhancement_requests",json!({})).unwrap();
    let balance=call(g,"account_balance",json!({"accountId":account["id"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true}})).unwrap();
    assert!(!remaining["requests"].as_array().unwrap().iter().any(|r|r["kind"]=="enhancement"&&r["txid"]==id.to_string()));
    crate::wallet::DOMAIN.with(|d|assert!(d.borrow().active.first().unwrap().wallet.get_transaction(id).unwrap().is_some()));
    crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":{"height":101,"hash":"04".repeat(32)}}).to_string()).unwrap();
    let pending=enhance(g,"enhancement_requests",json!({})).unwrap();
    let address_request=pending["requests"].as_array().unwrap().iter().find(|r|r["kind"]=="address"&&r["txStatus"]=="mined"&&r["outputStatus"]=="all").expect("real transparent spend-search request").clone();
    let as_of=address_request["endExclusive"].as_u64().unwrap()-1;
    let partial=enhance(g,"enhancement_apply",json!({"revision":pending["revision"],"request":address_request,"result":{"transactions":[],"asOfHeight":as_of,"complete":false}})).unwrap();
    assert_ne!(partial["revision"],pending["revision"]);
    assert!(enhance(g,"enhancement_requests",json!({})).unwrap()["requests"].as_array().unwrap().contains(&address_request));
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    crate::wallet::DOMAIN.with(|d|assert!(d.borrow().active.first().unwrap().wallet.get_transaction(id).unwrap().is_some()));
    let reopened=enhance(g,"enhancement_requests",json!({})).unwrap();
    assert_ne!(reopened["revision"],applied["revision"]);
    assert!(reopened["requests"].as_array().unwrap().contains(&address_request));
    enhance(g,"enhancement_apply",json!({"revision":reopened["revision"],"request":address_request,"result":{"transactions":[],"asOfHeight":as_of,"complete":true}})).unwrap();
    assert!(!enhance(g,"enhancement_requests",json!({})).unwrap()["requests"].as_array().unwrap().contains(&address_request));
    crate::wallet::storage_close(g).unwrap();
    // A known unmined transaction produces the upstream status polling request.
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute("UPDATE transactions SET mined_height=NULL,confirmed_unmined_at_height=NULL WHERE txid=?1",[id.as_ref()]).unwrap();
    conn.execute("INSERT OR IGNORE INTO tx_retrieval_queue(txid,query_type) VALUES(?1,0)",[id.as_ref()]).unwrap();drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let pending=enhance(g,"enhancement_requests",json!({})).unwrap();
    let status=pending["requests"].as_array().unwrap().iter().find(|r|r["kind"]=="status"&&r["txid"]==id.to_string()).unwrap();
    let invalid=json!({"revision":pending["revision"],"request":status,"result":{"status":"mined","height":102}});
    assert_eq!(enhance(g,"enhancement_apply",invalid).unwrap_err(),"CHAIN_MISMATCH");
    assert_eq!(enhance(g,"enhancement_requests",json!({})).unwrap(),pending);
    let applied=enhance(g,"enhancement_apply",json!({"revision":pending["revision"],"request":status,"result":{"status":"notInMainChain"}})).unwrap();
    assert_ne!(applied["revision"],pending["revision"]);
    crate::wallet::storage_close(g).unwrap();
    json!({"database":database,"accountId":account["id"],"txid":id.to_string(),"raw":hex::encode(raw),"minedHeight":100,"expectedAmounts":balance["amounts"]})
}

#[test]
fn enhancement_full_transaction_is_atomic_and_persists_after_reopen() {
    enhancement_fixture();
}

#[test]
fn enhancement_and_status_negative_replies_complete_only_their_own_work() {
    let (path,g)=open();
    crate::wallet::DOMAIN.with(|d|d.borrow_mut().active.first_mut().unwrap().wallet.update_chain_tip(100.into())).unwrap();
    crate::wallet::storage_close(g).unwrap();
    let id=[41u8;32];
    let conn=rusqlite::Connection::open(&path).unwrap();
    for kind in [0,1] {conn.execute("INSERT INTO tx_retrieval_queue(txid,query_type) VALUES(?1,?2)",rusqlite::params![&id,kind]).unwrap();}
    drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let pending=enhance(g,"enhancement_requests",json!({})).unwrap();
    assert_eq!(pending["requests"].as_array().unwrap().len(),2);
    let status=pending["requests"].as_array().unwrap().iter().find(|r|r["kind"]=="status").unwrap();
    enhance(g,"enhancement_apply",json!({"revision":pending["revision"],"request":status,"result":{"status":"notRecognized"}})).unwrap();
    let pending=enhance(g,"enhancement_requests",json!({})).unwrap();
    assert_eq!(pending["requests"],json!([{"kind":"enhancement","txid":hex::encode(id)}]));
    enhance(g,"enhancement_apply",json!({"revision":pending["revision"],"request":pending["requests"][0],"result":{"status":"notRecognized"}})).unwrap();
    assert_eq!(enhance(g,"enhancement_requests",json!({})).unwrap()["requests"],json!([]));
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn enhancement_unspent_positive_only_and_atomic() {
    unspent_checks(false);
    unspent_checks(true);
}

fn unspent_checks(ordinary: bool) {
    use zcash_keys::encoding::AddressCodec;
    let data=super::pczt_build::public_wallet_funds(&serde_json::from_str(include_str!("../public-wallet-funding.json")).unwrap());
    let(path,g)=open();crate::wallet::storage_close(g).unwrap();std::fs::write(&path,hex::decode(data["database"].as_str().unwrap()).unwrap()).unwrap();let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let p=crate::Document::parse(PARAMS).unwrap();
    let receivers=crate::wallet::DOMAIN.with(|domain| {
        let domain=domain.borrow();let db=&domain.active.first().unwrap().wallet;
        db.get_account_ids().unwrap().into_iter().flat_map(|account|
            db.get_transparent_receivers(account,true,false).unwrap().into_keys()
        ).map(|address|address.encode(&p)).collect::<std::collections::HashSet<_>>()
    });
    let pending=enhance(g,"enhancement_requests",json!({})).unwrap();
    let request=pending["requests"].as_array().unwrap().iter().find(|r|
        r["outputStatus"]=="unspent" && r["address"].as_str().is_some_and(|address|
            receivers.contains(address)==ordinary)
    ).expect("both ordinary and ephemeral receivers must request funding").clone();
    let address=zcash_transparent::address::TransparentAddress::decode(&p,request["address"].as_str().unwrap()).unwrap();let coinbase=zcash_transparent::bundle::TxIn::coinbase(40001.into(),None).unwrap();
    let tx=zcash_primitives::transaction::TransactionData::<zcash_primitives::transaction::Authorized>::from_parts(zcash_primitives::transaction::TxVersion::V5,zcash_protocol::consensus::BranchId::for_height(&p,40001.into()),0,0.into(),Some(zcash_transparent::bundle::Bundle{vin:vec![zcash_transparent::bundle::TxIn::from_parts(coinbase.prevout().clone(),coinbase.script_sig().into(),coinbase.sequence())],vout:vec![zcash_transparent::bundle::TxOut::new(zcash_protocol::value::Zatoshis::const_from_u64(1000),address.script().into());2],authorization:zcash_transparent::bundle::Authorized}),None,None,None).freeze().unwrap();
    let mut raw=vec![];tx.write(&mut raw).unwrap();let script=hex::encode(&tx.transparent_bundle().unwrap().vout[0].script_pubkey().0.0);
    let mut result=json!({"transactions":[{"txid":tx.txid().to_string(),"bytes":hex::encode(raw),"minedHeight":40001,"unspentOutputs":[{"outputIndex":0,"script":script,"value":"1000"},{"outputIndex":1,"script":script,"value":"1000"}]}],"asOfHeight":40001,"asOfHash":"08".repeat(32),"complete":true});
    let renew=|g| {
        let target=crate::wallet::DOMAIN.with(|domain| {
            let domain=domain.borrow();let db=&domain.active.first().unwrap().wallet;
            let height=db.chain_height().unwrap().unwrap();
            json!({"height":u32::from(height),"hash":hex::encode(db.get_block_hash(height).unwrap().unwrap().0)})
        });
        crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap();
    };
    let apply=|result:Value|{
        let pending=enhance(g,"enhancement_requests",json!({})).unwrap();
        if ordinary&&!pending["requests"].as_array().unwrap().iter().any(|r|r["address"]==request["address"]&&r["outputStatus"]=="unspent") {renew(g);}
        let current=enhance(g,"enhancement_requests",json!({})).unwrap();enhance(g,"enhancement_apply",json!({"revision":current["revision"],"request":current["requests"].as_array().unwrap().iter().find(|r|r["address"]==request["address"]&&r["outputStatus"]=="unspent").unwrap(),"result":result}))};
    let mut partial=result.clone();partial["complete"]=json!(false);assert_eq!(apply(partial).unwrap_err(),"INVALID_ARGUMENT");assert_eq!(enhance(g,"enhancement_requests",json!({})).unwrap(),pending);
    let mut overflow=result.clone();overflow["transactions"]=json!(vec![result["transactions"][0].clone();1001]);assert_eq!(apply(overflow).unwrap_err(),"RESOURCE_LIMIT");assert_eq!(enhance(g,"enhancement_requests",json!({})).unwrap(),pending);
    apply(result.clone()).unwrap();
    let db=rusqlite::Connection::open(&path).unwrap();
    db.execute("UPDATE transparent_received_outputs SET max_observed_unspent_height=39999 WHERE transaction_id=(SELECT id_tx FROM transactions WHERE txid=?1)",[tx.txid().as_ref()]).unwrap();
    let hash:Vec<u8>=(0u8..32).collect();db.execute("UPDATE blocks SET hash=?1 WHERE height=40001",[&hash]).unwrap();result["asOfHash"]=json!(hex::encode(&hash));
    if ordinary {renew(g);}
    let tables=["transactions","transparent_received_outputs","addresses","ext_wallet_revision"];let before=policy_rows(&db,&tables);
    for field in ["txid","script","value","outputIndex","asOfHeight","asOfHash"] {
        let mut bad=result.clone();match field{"txid"=>bad["transactions"][0][field]=json!("00".repeat(32)),"script"=>bad["transactions"][0]["unspentOutputs"][0][field]=json!("00"),"value"=>bad["transactions"][0]["unspentOutputs"][0][field]=json!("1001"),"outputIndex"=>bad["transactions"][0]["unspentOutputs"][0][field]=json!(99),"asOfHeight"=>bad[field]=json!(40000),_=>bad[field]=json!("09".repeat(32))};
        assert_eq!(apply(bad).unwrap_err(),"CHAIN_MISMATCH");assert_eq!(policy_rows(&db,&tables),before);
    }
    let mut one=result.clone();one["transactions"][0]["unspentOutputs"].as_array_mut().unwrap().pop();apply(one).unwrap();
    let heights:Vec<Option<u32>>=db.prepare("SELECT max_observed_unspent_height FROM transparent_received_outputs WHERE transaction_id=(SELECT id_tx FROM transactions WHERE txid=?1) ORDER BY output_index").unwrap().query_map([tx.txid().as_ref()],|r|r.get(0)).unwrap().collect::<std::result::Result<_,_>>().unwrap();assert_eq!(heights,vec![Some(40001),Some(39999)],"omitted known output is not renewed by raw decryption");
    let before=policy_rows(&db,&["transparent_received_outputs"]);apply(json!({"transactions":[],"asOfHeight":40001,"asOfHash":hex::encode(&hash),"complete":true})).unwrap();assert_eq!(policy_rows(&db,&["transparent_received_outputs"]),before,"empty response is not spent/unspent evidence");
    let pending=enhance(g,"enhancement_requests",json!({})).unwrap();
    let remaining=pending["requests"].as_array().unwrap().iter().find(|r|r["address"]==request["address"]&&r["outputStatus"]=="unspent");
    if ordinary {assert!(remaining.is_none(),"committed discovery must not block proposal freshness");}
    else {assert!(remaining.unwrap()["requestAt"].is_u64());}
    drop(db);crate::wallet::storage_close(g).unwrap();let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();assert!(enhance(g,"enhancement_requests",json!({})).unwrap()["requests"].as_array().unwrap().iter().find(|r|r["address"]==request["address"]&&r["outputStatus"]=="unspent").unwrap()["requestAt"].is_null()==ordinary);crate::wallet::storage_close(g).unwrap();
}
