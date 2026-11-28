use super::*;

fn sync(g:u32,operation:&str,input:Value)->std::result::Result<Value,String> {
    crate::wallet::sync::sync_call(g,operation,&input.to_string()).map(|s|serde_json::from_str(&s).unwrap())
}
fn scan(g:u32,operation:&str,input:Value)->Value {
    serde_json::from_str(&crate::wallet::scan::scan_call(g,operation,&input.to_string()).unwrap()).unwrap()
}

#[test]
fn wallet_sync_empty_reads_do_not_mutate_and_reject_unknown_rewind() {
    let (path,g)=open();
    let before=std::fs::read(&path).unwrap();
    let state=sync(g,"scan_state",json!({})).unwrap();
    assert_eq!(state["tipHeight"],Value::Null);
    assert_eq!(state["fullyScannedHeight"],Value::Null);
    assert_eq!(state["maxScannedHeight"],Value::Null);
    assert_eq!(sync(g,"scan_block_hash",json!({"height":0})).unwrap(),json!({"revision":state["revision"],"point":null}));
    assert_eq!(sync(g,"scan_rewind",json!({"revision":state["revision"],"requestedPoint":{"height":0,"hash":"03".repeat(32)}})).unwrap_err(),"RECOVERY_REQUIRED");
    for (op,input) in [("scan_state",json!({"accountId":"bad"})),("scan_block_hash",json!({"height":-1})),("scan_rewind",json!({}))] {
        assert_eq!(sync(g,op,input).unwrap_err(),"INVALID_ARGUMENT");
    }
    assert_eq!(sync(g,"scan_state",json!({})).unwrap(),state);
    assert_eq!(std::fs::read(&path).unwrap(),before);
    crate::wallet::storage_close(g).unwrap();
    assert_eq!(sync(g,"scan_state",json!({})).unwrap_err(),"STALE_HANDLE");
}

#[test]
fn wallet_sync_rewind_atomic_revision_fork_replay_and_reopen() {
    // Reuse the independently asserted encrypted three-pool full-scan fixture.
    let fixture=full_scan_fixture();
    let (path,g)=open();
    let account=call(g,"account_import",fixture["import"].clone()).unwrap();
    let target=fixture["target"].clone();
    let mut revision=scan(g,"scan_plan",json!({"target":target}))["revision"].clone();
    for batch in fixture["batches"].as_array().unwrap() {
        let mut input=batch.clone();input["target"]=target.clone();input["revision"]=revision;
        revision=scan(g,"scan_ingest_batch",input)["revision"].clone();
    }
    let mut state=sync(g,"scan_state",json!({})).unwrap();assert_eq!(state["fullyScannedHeight"],100);
    let known=sync(g,"scan_block_hash",json!({"height":99})).unwrap();
    let checkpoint=sync(g,"scan_block_hash",json!({"height":96})).unwrap();
    assert_eq!(known["revision"],revision);
    assert_eq!(known["point"],json!({"height":99,"hash":"07".repeat(32)}));
    let historical=scan(g,"scan_plan",json!({"target":known["point"]}));
    assert_eq!(sync(g,"scan_state",json!({})).unwrap()["tipHeight"],100);
    let mut batch=fixture["batches"][6].clone();batch["blocks"].as_array_mut().unwrap().pop();
    batch["revision"]=historical["revision"].clone();batch["target"]=known["point"].clone();
    revision=scan(g,"scan_ingest_batch",batch)["revision"].clone();
    state=sync(g,"scan_state",json!({})).unwrap();
    assert_eq!(state["tipHeight"],100);assert_eq!(state["fullyScannedHeight"],100);
    let request=json!({"revision":revision,"requestedPoint":known["point"]});
    let mut bad=request.clone();bad["requestedPoint"]["hash"]=json!("ff".repeat(32));
    assert_eq!(sync(g,"scan_rewind",bad).unwrap_err(),"CHAIN_MISMATCH");
    let mut stale=request.clone();stale["revision"]=json!("stale");
    assert_eq!(sync(g,"scan_rewind",stale).unwrap_err(),"STALE_REVISION");
    assert_eq!(sync(g,"scan_state",json!({})).unwrap(),state);

    // Force the final revision write to fail after native truncate; the whole rewind rolls back.
    crate::wallet::DOMAIN.with(|domain| {
        domain.borrow_mut().active.first_mut().unwrap().wallet.transactionally_with_extension(|_,ext| -> Result<()> {
            ext.execute("UPDATE ext_wallet_revision SET sequence=9223372036854775807",[])?;Ok(())
        }).unwrap();
    });
    let overflow=sync(g,"scan_state",json!({})).unwrap();
    let bytes=std::fs::read(&path).unwrap();
    let mut failed=request.clone();failed["revision"]=overflow["revision"].clone();
    assert_eq!(sync(g,"scan_rewind",failed).unwrap_err(),"STORAGE_ERROR");
    assert_eq!(sync(g,"scan_state",json!({})).unwrap(),overflow);
    assert_eq!(std::fs::read(&path).unwrap(),bytes);
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let current=sync(g,"scan_state",json!({})).unwrap();
    let plan=scan(g,"scan_plan",json!({"target":target}));
    let result=sync(g,"scan_rewind",json!({"revision":plan["revision"],"requestedPoint":known["point"]})).unwrap();
    // Native retained checkpoints require rewinding farther than the requested block99.
    assert_eq!(result["point"],checkpoint["point"]);assert_eq!(result["point"]["height"],96);
    assert_ne!(result["revision"],current["revision"]);
    assert!(crate::wallet::DOMAIN.with(|domain|domain.borrow().active.first().unwrap().scan_plan.is_none()));
    assert_eq!(sync(g,"scan_block_hash",json!({"height":100})).unwrap()["point"],Value::Null);
    assert_eq!(sync(g,"scan_state",json!({})).unwrap()["fullyScannedHeight"],96);

    // Replay the same real encrypted transactions in a differently identified fork block.
    let mut block=zcash_client_backend::proto::compact_formats::CompactBlock::decode(
        hex::decode(fixture["batches"][6]["blocks"][3].as_str().unwrap()).unwrap().as_slice()).unwrap();
    block.hash=vec![9;32];
    let target=json!({"height":100,"hash":"09".repeat(32)});
    let plan=scan(g,"scan_plan",json!({"target":target}));
    let mut batch=fixture["batches"][6].clone();
    batch["blocks"][3]=json!(hex::encode(block.encode_to_vec()));
    batch["revision"]=plan["revision"].clone();batch["target"]=target.clone();
    scan(g,"scan_ingest_batch",batch);
    assert_eq!(sync(g,"scan_block_hash",json!({"height":100})).unwrap()["point"],target);
    let balance_args=json!({"accountId":account["id"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":true}});
    assert_eq!(call(g,"account_balance",balance_args.clone()).unwrap()["amounts"],fixture["expectedAmounts"]);
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(sync(g,"scan_block_hash",json!({"height":100})).unwrap()["point"],target);
    assert_eq!(call(g,"account_balance",balance_args).unwrap()["amounts"],fixture["expectedAmounts"]);
    crate::wallet::storage_close(g).unwrap();
}
