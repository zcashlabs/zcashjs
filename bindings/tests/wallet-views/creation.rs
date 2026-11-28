use super::*;
fn complete(g:u32, height:u32) -> Value {
    complete_target(g,height,&"07".repeat(32))
}
fn complete_target(g:u32,height:u32,hash:&str) -> Value {
    let mut tree=TreeState::decode(hex::decode(fixture(40)["birthday"]["priorTreeState"].as_str().unwrap()).unwrap().as_slice()).unwrap();
    tree.height=height.into();
    tree.hash=hex::encode(hex::decode(hash).unwrap().into_iter().rev().collect::<Vec<_>>());
    if height>=100 {tree.ironwood_tree="000000".into();}
    let target=json!({"height":height,"hash":hash});
    let plan:Value=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap()).unwrap();
    json!({"revision":plan["revision"],"target":target,"treeState":hex::encode(tree.encode_to_vec())})
}
pub(super) fn ready(g:u32) {
    let input=complete(g,99);
    crate::wallet::sync::sync_call(g,"scan_complete",&input.to_string()).unwrap();
}
#[test]
fn creation_defers_unspent_discovery_until_a_scanned_tip_can_bind_the_reply() {
    let (_,g)=open();
    let prior=complete(g,99);
    crate::wallet::sync::sync_call(g,"scan_complete",&prior.to_string()).unwrap();
    hd(g,"account_create_hd",40,json!({})).unwrap();
    let requests=||->Value {serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap()};
    assert_eq!(requests()["requests"],json!([]),"a birthday checkpoint is not a scanned UTXO observation point");
    let same=complete(g,99);
    crate::wallet::sync::sync_call(g,"scan_complete",&same.to_string()).unwrap();
    let target=json!({"height":100,"hash":"08".repeat(32)});
    let plan:Value=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap()).unwrap();
    let block=zcash_client_backend::proto::compact_formats::CompactBlock {
        height:100,hash:vec![8;32],prev_hash:vec![7;32],
        chain_metadata:Some(zcash_client_backend::proto::compact_formats::ChainMetadata {
            sapling_commitment_tree_size:0,orchard_commitment_tree_size:0,ironwood_commitment_tree_size:0
        }),..Default::default()
    };
    crate::wallet::scan::scan_call(g,"scan_ingest_batch",&json!({"revision":plan["revision"],"target":target,
        "priorTreeState":prior["treeState"],"blocks":[hex::encode(block.encode_to_vec())]}).to_string()).unwrap();
    assert!(requests()["requests"].as_array().unwrap().iter().any(|r|r["kind"]=="address"&&r["outputStatus"]=="unspent"));
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn creation_empty_completion_reopen_and_newer_target_freshness() {
    let (path,g)=open();
    let before=std::fs::read(&path).unwrap();
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"SYNC_REQUIRED");
    assert_eq!(std::fs::read(&path).unwrap(),before);
    let input=complete(g,99);
    let mut bad=input.clone();bad["treeState"]=json!("00");
    assert_eq!(crate::wallet::sync::sync_call(g,"scan_complete",&bad.to_string()).unwrap_err(),"INVALID_BIRTHDAY");
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"SYNC_REQUIRED");
    crate::wallet::sync::sync_call(g,"scan_complete",&input.to_string()).unwrap();
    complete(g,99); // An identical watch target preserves completed creation state.
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let created=hd(g,"account_create_hd",40,json!({})).unwrap();
    assert_eq!(created["accountIndex"],0);
    assert_eq!(created["birthdayHeight"],100);
    complete_target(g,99,&"08".repeat(32));
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"SYNC_REQUIRED");
    ready(g);
    let newer=complete(g,100);
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"SYNC_REQUIRED");
    let old=complete(g,99);
    assert_eq!(crate::wallet::sync::sync_call(g,"scan_complete",&old.to_string()).unwrap_err(),"SYNC_REQUIRED"); // No retained block in this empty-start fixture.
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"SYNC_REQUIRED");
    // The newer account's unscanned range prevents declaring an endpoint tree complete.
    let mut newer=newer;newer["revision"]=old["revision"].clone();
    assert_eq!(crate::wallet::sync::sync_call(g,"scan_complete",&newer.to_string()).unwrap_err(),"SYNC_REQUIRED");
    assert_eq!(call(g,"account_list",json!({})).unwrap().as_array().unwrap().len(),1);
    assert_eq!(hd(g,"account_create_hd",41,json!({"birthday":"fullScan"})).unwrap_err(),"INVALID_ARGUMENT");
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn creation_scanned_frontiers_and_rewind_invalidation() {
    let fixture=full_scan_fixture();
    let (_,g)=open();call(g,"account_import",fixture["import"].clone()).unwrap();
    let target=fixture["target"].clone();
    let mut plan:Value=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap()).unwrap();
    for batch in fixture["batches"].as_array().unwrap() {
        let mut batch=batch.clone();batch["target"]=target.clone();batch["revision"]=plan["revision"].clone();
        plan=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_ingest_batch",&batch.to_string()).unwrap()).unwrap();
    }
    let input=complete_target(g,100,target["hash"].as_str().unwrap()); // Empty frontiers disagree with the real encrypted three-pool scan.
    assert_eq!(crate::wallet::sync::sync_call(g,"scan_complete",&input.to_string()).unwrap_err(),"CHAIN_MISMATCH");
    let block=zcash_client_backend::proto::compact_formats::CompactBlock::decode(hex::decode(fixture["batches"][6]["blocks"][3].as_str().unwrap()).unwrap().as_slice()).unwrap();
    let mut tree=TreeState::decode(hex::decode(input["treeState"].as_str().unwrap()).unwrap().as_slice()).unwrap();
    let mut sapling_tree=tree.sapling_tree().unwrap();
    let mut orchard_tree=tree.orchard_tree().unwrap();
    let mut ironwood_tree=tree.ironwood_tree().unwrap();
    for tx in block.vtx {
        for output in tx.outputs {sapling_tree.append(sapling::Node::from_bytes(output.cmu.as_slice().try_into().unwrap()).unwrap()).unwrap();}
        for action in tx.actions {orchard_tree.append(orchard::tree::MerkleHashOrchard::from_bytes(&action.cmx.as_slice().try_into().unwrap()).unwrap()).unwrap();}
        for action in tx.ironwood_actions {ironwood_tree.append(orchard::tree::MerkleHashOrchard::from_bytes(&action.cmx.as_slice().try_into().unwrap()).unwrap()).unwrap();}
    }
    let mut raw=Vec::new();zcash_primitives::merkle_tree::write_commitment_tree(&sapling_tree,&mut raw).unwrap();tree.sapling_tree=hex::encode(raw);
    let mut raw=Vec::new();zcash_primitives::merkle_tree::write_commitment_tree(&orchard_tree,&mut raw).unwrap();tree.orchard_tree=hex::encode(raw);
    let mut raw=Vec::new();zcash_primitives::merkle_tree::write_commitment_tree(&ironwood_tree,&mut raw).unwrap();tree.ironwood_tree=hex::encode(raw);
    let mut populated=input.clone();populated["treeState"]=json!(hex::encode(tree.encode_to_vec()));
    crate::wallet::sync::sync_call(g,"scan_complete",&populated.to_string()).unwrap();
    // Ordinary empty blocks need no upstream checkpoint, but are valid sync targets.
    let mut previous=target["hash"].as_str().unwrap().to_owned();
    for height in 101..=102u32 {
        let mut hash=vec![0x31;32];hash[0]=(height-100) as u8;
        let next=json!({"height":height,"hash":hex::encode(&hash)});
        let plan:Value=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":next}).to_string()).unwrap()).unwrap();
        let empty=zcash_client_backend::proto::compact_formats::CompactBlock{height:height.into(),hash,prev_hash:hex::decode(&previous).unwrap(),chain_metadata:block.chain_metadata.clone(),..Default::default()};
        crate::wallet::scan::scan_call(g,"scan_ingest_batch",&json!({"revision":plan["revision"],"target":next,"priorTreeState":hex::encode(tree.encode_to_vec()),"blocks":[hex::encode(empty.encode_to_vec())]}).to_string()).unwrap();
        previous=next["hash"].as_str().unwrap().to_owned();tree.height=height.into();tree.hash=hex::encode(hex::decode(&previous).unwrap().into_iter().rev().collect::<Vec<_>>());
    }
    crate::wallet::DOMAIN.with(|d|d.borrow_mut().active.first_mut().unwrap().wallet.transactionally_with_extension(|_,ext|->Result<()> {
        for prefix in ["sapling","orchard","ironwood"] {assert_eq!(ext.query_row(&format!("SELECT COUNT(*) FROM {prefix}_tree_checkpoints WHERE checkpoint_id=102"),[],|r|r.get::<_,u32>(0))?,0);}
        Ok(())
    })).unwrap();
    let mut suffix=complete_target(g,102,&previous);suffix["treeState"]=json!(hex::encode(tree.encode_to_vec()));
    let mut bad=suffix.clone();let mut wrong_tree=tree.clone();wrong_tree.sapling_tree="000000".into();bad["treeState"]=json!(hex::encode(wrong_tree.encode_to_vec()));
    assert_eq!(crate::wallet::sync::sync_call(g,"scan_complete",&bad.to_string()).unwrap_err(),"CHAIN_MISMATCH");
    let completed:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_complete",&suffix.to_string()).unwrap()).unwrap();
    crate::wallet::sync::sync_call(g,"scan_rewind",&json!({"revision":completed["revision"],"requestedPoint":target}).to_string()).unwrap();
    let reset=complete_target(g,100,target["hash"].as_str().unwrap());populated["revision"]=reset["revision"].clone();
    crate::wallet::sync::sync_call(g,"scan_complete",&populated.to_string()).unwrap();
    let historical=complete(g,99); // 99 is retained as a block, but native rewind needs checkpoint96.
    crate::wallet::sync::sync_call(g,"scan_complete",&historical.to_string()).unwrap();
    crate::wallet::DOMAIN.with(|d|d.borrow_mut().active.first_mut().unwrap().wallet.transactionally_with_extension(|_,ext|->Result<()> {
        let (height,tree)=ext.query_row("SELECT height,tree FROM ext_wallet_creation_snapshot WHERE id=1",[],|r|Ok((r.get::<_,u32>(0)?,r.get::<_,Vec<u8>>(1)?)))?;
        assert_eq!(height,100);assert_eq!(hex::encode(tree),populated["treeState"].as_str().unwrap());Ok(())
    })).unwrap();
    complete(g,101); // A newly known pending target cannot be satisfied by historical completion.
    let historical=complete(g,99);
    let completed:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_complete",&historical.to_string()).unwrap()).unwrap();
    assert_eq!(hd(g,"account_create_hd",41,json!({})).unwrap_err(),"SYNC_REQUIRED");
    let rewind=json!({"revision":completed["revision"],"requestedPoint":{"height":99,"hash":"07".repeat(32)}});
    let result:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_rewind",&rewind.to_string()).unwrap()).unwrap();
    assert_eq!(result["point"]["height"],96);
    let input=complete_target(g,96,result["point"]["hash"].as_str().unwrap());
    crate::wallet::sync::sync_call(g,"scan_complete",&input.to_string()).unwrap();
    assert_eq!(hd(g,"account_create_hd",41,json!({})).unwrap()["birthdayHeight"],97);
    let revision:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();
    crate::wallet::sync::sync_call(g,"scan_rewind",&json!({"revision":revision["revision"],"requestedPoint":result["point"]}).to_string()).unwrap();
    assert_eq!(hd(g,"account_create_hd",42,json!({})).unwrap_err(),"SYNC_REQUIRED");
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn creation_completion_revision_failure_rolls_back_and_legacy_open_is_not_sync() {
    let (path,g)=open();let mut input=complete(g,99);
    crate::wallet::DOMAIN.with(|d|d.borrow_mut().active.first_mut().unwrap().wallet.transactionally_with_extension(|_,ext|->Result<()> {
        ext.execute("UPDATE ext_wallet_revision SET sequence=9223372036854775807",[])?;Ok(())
    })).unwrap();
    let state:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();input["revision"]=state["revision"].clone();
    let before=std::fs::read(&path).unwrap();
    assert_eq!(crate::wallet::sync::sync_call(g,"scan_complete",&input.to_string()).unwrap_err(),"STORAGE_ERROR");
    assert_eq!(std::fs::read(&path).unwrap(),before);
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"SYNC_REQUIRED");
    crate::wallet::storage_close(g).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();conn.execute_batch("DROP TABLE ext_wallet_creation_snapshot").unwrap();drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap_err(),"SYNC_REQUIRED");
    ready(g);assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap()["accountIndex"],0);
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn creation_pre_sapling_completion_reopen_and_freshness() {
    for target in [0,16] {
        let (path,g)=open();
        let hash=if target==0 {"03".repeat(32)}else{"07".repeat(32)};
        let input=complete_target(g,target,&hash);
        crate::wallet::sync::sync_call(g,"scan_complete",&input.to_string()).unwrap();
        let state:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();
        assert!(state["tipHeight"].is_null());
        crate::wallet::storage_close(g).unwrap();
        let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        assert_eq!(hd(g,"account_create_hd",40,json!({})).unwrap()["birthdayHeight"],target+1);
        complete(g,17);
        let old=complete_target(g,target,&hash);
        assert_eq!(crate::wallet::sync::sync_call(g,"scan_complete",&old.to_string()).unwrap_err(),"SYNC_REQUIRED");
        assert_eq!(hd(g,"account_create_hd",41,json!({})).unwrap_err(),"SYNC_REQUIRED");
        crate::wallet::storage_close(g).unwrap();
    }
}
