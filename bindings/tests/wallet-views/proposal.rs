use super::*;
fn propose(g:u32,op:&str,input:Value)->std::result::Result<Value,String>{
    crate::wallet::proposal::proposal_call(g,op,&input.to_string()).map(|s|serde_json::from_str(&s).unwrap())
}
#[test]
fn proposal_retains_native_selection_locks_and_reopens() {
    let fixture=confirmed_scan_fixture();
    let (path,g)=open();
    let (_,other)=open();
    let account=call(g,"account_import",fixture["import"].clone()).unwrap();
    let scan=|op:&str,v:Value|crate::wallet::scan::scan_call(g,op,&v.to_string()).map(|s|serde_json::from_str::<Value>(&s).unwrap()).unwrap();
    let mut revision=scan("scan_plan",json!({"target":fixture["target"]}))["revision"].clone();
    for data in fixture["batches"].as_array().unwrap(){let mut input=data.clone();input["target"]=fixture["target"].clone();input["revision"]=revision;revision=scan("scan_ingest_batch",input)["revision"].clone();}
    let address=call(g,"address_next",json!({"accountId":account["id"],"request":{"format":"transparent"}})).unwrap();
    let state=crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap();
    revision=serde_json::from_str::<Value>(&state).unwrap()["revision"].clone();
    let mut input=json!({"revision":revision,"accountId":account["id"],"payments":[{"to":address["address"],"amount":"10000"}],
        "policy":{"spendPools":["sapling"],"transparent":"disallow","changePool":"sapling","feeRule":"zip317-standard","confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":false},"expiry":{"kind":"offset","blocks":40},"lockExpiryBlocks":20}});
    let mut excessive=input.clone();excessive["payments"][0]["amount"]=json!("1000000");
    assert_eq!(propose(g,"proposal_create",excessive).unwrap_err(),"INSUFFICIENT_FUNDS");
    let mut capped=input.clone();capped["maxFee"]=json!("1");
    assert_eq!(propose(g,"proposal_create",capped).unwrap_err(),"FEE_LIMIT_EXCEEDED");
    let mut wrong_pool=input.clone();wrong_pool["policy"]["changePool"]=json!("ironwood");
    assert_eq!(propose(g,"proposal_create",wrong_pool).unwrap_err(),"UNSUPPORTED_POOL");
    let mut legacy=input.clone();legacy["policy"]["spendPools"]=json!(["orchard"]);
    assert_eq!(propose(g,"proposal_create",legacy).unwrap_err(),"INVALID_ARGUMENT");
    assert_eq!(propose(g,"proposal_list",json!({"afterSequence":"0","limit":200})).unwrap()["items"],json!([]));
    let mut retry=input.clone();retry["idempotencyKey"]=json!("retained-transfer");
    let mut lookup=retry.clone();lookup.as_object_mut().unwrap().remove("revision");
    assert_eq!(propose(g,"proposal_lookup_intent",lookup.clone()).unwrap(),Value::Null);
    let plan=propose(g,"proposal_create",retry.clone()).unwrap();
    assert_eq!(propose(g,"proposal_lookup_intent",lookup).unwrap(),plan);
    // ZIP-321 literals are case-insensitive. Other parameter names are not, so `x` and `X` are
    // distinct and make a different request from `plan`'s.
    let to=address["address"].as_str().unwrap();
    for (uri,expected) in [(format!("ZCASH:{to}?AMOUNT=0.0001"),Ok(plan.clone())),(format!("zcash:{to}"),Err("INVALID_ARGUMENT".into())),
        (format!("zcash:{to}?amount=0.0001&REQ-x=1"),Err("INVALID_ARGUMENT".into())),(format!("zcash:{to}?amount=0.0001&x=1&X=2"),Err("IDEMPOTENCY_CONFLICT".into()))] {
        let mut request=retry.clone();request["payments"]=json!(uri);
        assert_eq!(propose(g,"proposal_lookup_intent",request),expected,"{uri}");
    }
    // `amounts` fills in exactly the payments without an amount.
    for (uri,amounts,expected) in [(format!("zcash:{to}"),json!({"0":"10000"}),Ok(plan.clone())),
        (format!("zcash:{to}?amount=0.0001"),json!({"0":"10000"}),Err("INVALID_ARGUMENT".into())),(format!("zcash:{to}"),json!({"1":"10000"}),Err("INVALID_ARGUMENT".into()))] {
        let mut request=retry.clone();request["payments"]=json!(uri);request["amounts"]=amounts;
        assert_eq!(propose(g,"proposal_lookup_intent",request),expected,"{uri}");
    }
    assert_eq!(propose(g,"payment_request_parse",json!({"uri":format!("zcash:{to}?label=Coffee")})).unwrap(),
        json!({"payments":[{"index":"0","address":to,"amount":null,"memo":null,"label":"Coffee","message":null}]}));
    assert_eq!(propose(g,"proposal_create",retry.clone()).unwrap(),plan,"retry ignores stale pre-commit revision and locked inputs");
    let mut conflict=retry.clone();conflict["payments"][0]["amount"]=json!("10001");
    let mut memo=retry.clone();memo["payments"][0]["memo"]=json!("00");
    // Transparent recipients reject memos at native ZIP321 admission; use policy/context
    // changes here and retain memo byte binding coverage below for native change outputs.
    assert_eq!(propose(g,"proposal_create",memo).unwrap_err(),"INVALID_ARGUMENT");
    let mut policy_conflict=retry.clone();policy_conflict["policy"]["expiry"]["blocks"]=json!(41);
    for conflict in [conflict,policy_conflict] {assert_eq!(propose(g,"proposal_create",conflict).unwrap_err(),"IDEMPOTENCY_CONFLICT");}
    assert_eq!(crate::wallet::account_lifecycle::account_lifecycle_call(g,"account_remove",&json!({"accountId":account["id"],"acknowledge":"deletes-local-history"}).to_string()).unwrap_err(),"RECOVERY_REQUIRED");
    assert_eq!(plan["steps"][0]["inputs"][0]["pool"],"sapling");
    assert_eq!(plan["steps"][0]["outputs"][0]["address"],address["address"]);
    assert_eq!(plan["steps"][0]["outputs"][1]["address"],Value::Null);
    for key in ["proposalId","reviewCommitment"] {assert_eq!(plan[key].as_str().unwrap().len(),64);assert_ne!(plan[key],plan["operationId"]);}
    assert_ne!(plan["proposalId"],plan["reviewCommitment"]);
    assert_eq!(plan["targetHeight"],102);
    assert_eq!(plan["steps"][0]["transactionVersion"],6);
    assert_eq!(plan["expiryHeight"],142);
    input["revision"]=plan["revision"].clone();
    assert_eq!(propose(g,"proposal_create",input).unwrap_err(),"INSUFFICIENT_FUNDS");
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM ext_wallet_proposals",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    let (encoded,policy):(Vec<u8>,String)=conn.query_row("SELECT plan,policy FROM ext_wallet_proposals",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    let policy:Value=serde_json::from_str(&policy).unwrap();
    let bind=|review:Value,bytes:&[u8],parameters:&[u8],genesis:&[u8],policy:&Value|crate::wallet::proposal::bind_review(review,bytes,parameters,genesis,policy);
    assert_eq!(bind(plan.clone(),&encoded,PARAMS,&[3;32],&policy),plan);
    let original=zcash_client_backend::proto::proposal::Proposal::decode(&encoded[..]).unwrap();
    let mut fee=original.clone();fee.steps[0].balance.as_mut().unwrap().fee_required+=1;
    let mut amount=original.clone();
    amount.steps[0].transaction_request=amount.steps[0].transaction_request.replace("amount=0.0001","amount=0.0002");
    assert_ne!(amount.steps[0].transaction_request,original.steps[0].transaction_request);
    let mut memo=original.clone();memo.steps[0].balance.as_mut().unwrap().proposed_change[0].memo=Some(zcash_client_backend::proto::proposal::MemoBytes{value:vec![0xf6;512]});
    let mut selected=original.clone();
    let Some(zcash_client_backend::proto::proposal::proposed_input::Value::ReceivedOutput(input))=selected.steps[0].inputs[0].value.as_mut() else {panic!("fixture selected native received output")};input.index+=1;
    for effects in [fee,amount,memo,selected] {
        let changed=bind(plan.clone(),&effects.encode_to_vec(),PARAMS,&[3;32],&policy);
        assert_ne!(changed["proposalId"],plan["proposalId"]);assert_ne!(changed["reviewCommitment"],plan["reviewCommitment"]);
    }
    let changed_parameters=std::str::from_utf8(PARAMS).unwrap().replace("\"Nu6_2\":90","\"Nu6_2\":91");
    crate::Document::parse(changed_parameters.as_bytes()).unwrap();
    let mut revision=plan.clone();revision["revision"]=json!("changed-creation-revision");
    let mut changed_policy=policy.clone();changed_policy["confirmations"]["trusted"]=json!(2);
    for changed in [bind(plan.clone(),&encoded,changed_parameters.as_bytes(),&[3;32],&policy),
        bind(plan.clone(),&encoded,PARAMS,&[4;32],&policy),bind(revision,&encoded,PARAMS,&[3;32],&policy),
        bind(plan.clone(),&encoded,PARAMS,&[3;32],&changed_policy)] {
        assert_eq!(changed["proposalId"],plan["proposalId"]);assert_ne!(changed["reviewCommitment"],plan["reviewCommitment"]);
    }
    drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(propose(g,"proposal_create",retry).unwrap(),plan,"idempotency persists across reopen");
    let discovered=propose(g,"proposal_list",json!({"afterSequence":"0","limit":1})).unwrap();
    assert_eq!(discovered["highWater"],"1");
    assert_eq!(propose(g,"proposal_get",json!({"operationId":discovered["items"][0]["operationId"]})).unwrap(),plan);
    assert_eq!(propose(g,"proposal_list",json!({"afterSequence":"1","highWater":"1","limit":1})).unwrap()["items"],json!([]));
    assert_eq!(propose(other,"proposal_list",json!({"afterSequence":"0","limit":1})).unwrap()["items"],json!([]));
    crate::wallet::storage_close(g).unwrap();
    crate::wallet::storage_close(other).unwrap();
    // Isolate the independent native lock guard from the journal guard above.
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute("DELETE FROM ext_wallet_proposal_intents",[]).unwrap();conn.execute("DELETE FROM ext_wallet_proposals",[]).unwrap();drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(crate::wallet::account_lifecycle::account_lifecycle_call(g,"account_remove",&json!({"accountId":account["id"],"acknowledge":"deletes-local-history"}).to_string()).unwrap_err(),"INPUT_LOCKED");
    assert!(call(g,"account_get",json!({"accountId":account["id"]})).unwrap().is_object());
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn proposal_schema_rejects_wrong_object_before_open() {
    let (path,g)=open();crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("DROP TABLE ext_wallet_proposals;CREATE VIEW ext_wallet_proposals AS SELECT * FROM nonexistent").unwrap();drop(conn);
    assert_eq!(crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap_err(),"SCHEMA_MISMATCH");
}

pub(super) fn shielding_fixture() -> Value {
    let fixture=confirmed_scan_fixture();let (path,g)=open();
    let account=call(g,"account_import",fixture["import"].clone()).unwrap();
    let scan=|op:&str,v:Value|crate::wallet::scan::scan_call(g,op,&v.to_string()).map(|s|serde_json::from_str::<Value>(&s).unwrap()).unwrap();
    let mut revision=scan("scan_plan",json!({"target":fixture["target"]}))["revision"].clone();
    for data in fixture["batches"].as_array().unwrap(){let mut input=data.clone();input["target"]=fixture["target"].clone();input["revision"]=revision;revision=scan("scan_ingest_batch",input)["revision"].clone();}
    let address=call(g,"address_next",json!({"accountId":account["id"],"request":{"format":"transparent"}})).unwrap();
    let account_id=zcash_client_sqlite::AccountUuid::from_uuid(uuid::Uuid::parse_str(account["id"].as_str().unwrap()).unwrap());
    crate::wallet::DOMAIN.with(|domain| {
        let mut d=domain.borrow_mut();let db=&mut d.active.iter_mut().find(|a|a.generation==g).unwrap().wallet;
        let zcash_keys::address::Address::Transparent(t)=zcash_keys::address::Address::decode(db.params(),address["address"].as_str().unwrap()).unwrap() else{panic!()};
        let output=zcash_client_backend::wallet::WalletTransparentOutput::from_parts(
            zcash_transparent::bundle::OutPoint::new([33;32],0),
            zcash_transparent::bundle::TxOut::new(zcash_protocol::value::Zatoshis::const_from_u64(70_000),t.script().into()),
            Some(100u32.into()),Some(account_id),Some(TransparentKeyScope::EXTERNAL),None).unwrap();
        db.put_received_transparent_utxo(&output).unwrap();
    });
    let revision:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();
    let input=json!({"kind":"shield","revision":revision["revision"],"accountId":account["id"],"threshold":"10000","idempotencyKey":"shield-1",
        "policy":{"spendPools":["sapling","transparent"],"transparent":"allow-owned","changePool":"sapling","feeRule":"zip317-standard","confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":false},"expiry":{"kind":"offset","blocks":40},"lockExpiryBlocks":20}});
    crate::wallet::storage_close(g).unwrap();
    json!({"database":hex::encode(std::fs::read(path).unwrap()),"accountId":account["id"],"input":input})
}
#[test]
fn proposal_shielding_uses_native_utxos_and_atomic_idempotency() {
    let fixture=shielding_fixture();
    let(path,g)=open();crate::wallet::storage_close(g).unwrap();
    std::fs::write(&path,hex::decode(fixture["database"].as_str().unwrap()).unwrap()).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let revision:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();
    let mut input=fixture["input"].clone();input["revision"]=revision["revision"].clone();
    for restriction in [json!({"transparent":"disallow"}),json!({"spendPools":["sapling"]})] {
        let mut forbidden=input.clone();for(key,value)in restriction.as_object().unwrap(){forbidden["policy"][key]=value.clone();}
        assert_eq!(propose(g,"proposal_create",forbidden).unwrap_err(),"UNSUPPORTED_POOL");
        let after:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();assert_eq!(after["revision"],revision["revision"]);
    }
    let mut empty=input.clone();empty["fromAddresses"]=json!([]);assert_eq!(propose(g,"proposal_create",empty).unwrap_err(),"NOTHING_TO_SHIELD");
    let mut capped=input.clone();capped["maxFee"]=json!("1");assert_eq!(propose(g,"proposal_create",capped).unwrap_err(),"FEE_LIMIT_EXCEEDED");
    assert_eq!(propose(g,"proposal_list",json!({"afterSequence":"0","limit":1})).unwrap()["items"],json!([]));
    // Inject a failure at the final mapping insert, after native locks, journal
    // insertion and revision advance, then prove the entire native transaction rolls back.
    let conn=rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_intent BEFORE INSERT ON ext_wallet_proposal_intents BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
    assert_eq!(propose(g,"proposal_create",input.clone()).unwrap_err(),"STORAGE_ERROR");
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM ext_wallet_proposals",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM ext_wallet_proposal_intents",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    let after:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();assert_eq!(after["revision"],revision["revision"]);
    conn.execute_batch("DROP TRIGGER fail_intent").unwrap();drop(conn);
    let plan=propose(g,"proposal_create",input.clone()).unwrap();
    assert_eq!(plan["steps"][0]["inputs"][0]["pool"],"transparent");
    assert_eq!(plan["steps"][0]["outputs"][0]["pool"],"sapling");
    assert_eq!(plan["steps"][0]["outputs"][0]["address"],Value::Null);
    assert_eq!(propose(g,"proposal_create",input.clone()).unwrap(),plan);
    let mut exhausted=input.clone();exhausted["revision"]=plan["revision"].clone();exhausted["idempotencyKey"]=json!("new-shield");
    assert_eq!(propose(g,"proposal_create",exhausted).unwrap_err(),"NOTHING_TO_SHIELD");
    for field in ["threshold","maxFee"] {let mut changed=input.clone();changed[field]=json!("20000");assert_eq!(propose(g,"proposal_create",changed).unwrap_err(),"IDEMPOTENCY_CONFLICT");}
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(propose(g,"proposal_create",input).unwrap(),plan);
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn proposal_intent_table_migrates_without_replanning_and_rejects_wrong_schema() {
    let(path,g)=open();crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();conn.execute_batch("DROP TABLE ext_wallet_proposal_intents").unwrap();drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(propose(g,"proposal_list",json!({"afterSequence":"0","limit":1})).unwrap()["items"],json!([]));
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();conn.execute_batch("DROP TABLE ext_wallet_proposal_intents;CREATE VIEW ext_wallet_proposal_intents AS SELECT * FROM missing").unwrap();drop(conn);
    assert_eq!(crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap_err(),"SCHEMA_MISMATCH");
}
