use super::*;
fn invoke(g:u32,operation:&str,input:Value)->std::result::Result<Value,String> {
    crate::wallet::pczt_build::pczt_build_call(g,operation,&input.to_string()).map(|v|serde_json::from_str(&v).unwrap())
}
const WORDS:&str="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
fn prepared(post_zip212:bool)->(String,u32,Value) {let (path,g,plan,_)=prepared_signer(post_zip212,false,false);(path,g,plan)}
pub(super) fn scan_fixture(with_signer:bool,internal:bool)->Value {
        let p=crate::Document::parse(PARAMS).unwrap();let mut import=fixture(10);
        let key=if with_signer {
            let seed=bip39::Mnemonic::parse(WORDS).unwrap().to_seed("");
            zcash_keys::keys::UnifiedSpendingKey::from_seed(&p,&seed,zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key()
        } else {UnifiedFullViewingKey::decode(&p,import["viewingKey"].as_str().unwrap()).unwrap()};
        import["viewingKey"]=json!(key.encode(&p));
        let state=TreeState{network:"regtest".into(),height:39998,hash:"07".repeat(32),time:1,sapling_tree:"000000".into(),orchard_tree:"000000".into(),ironwood_tree:"000000".into()};
        import["birthday"]["firstScanHeight"]=json!(39999);import["birthday"].as_object_mut().unwrap().remove("recoverUntilExclusive");
        import["birthday"]["priorTreeState"]=json!(hex::encode(state.encode_to_vec()));
        let mut block=policy_block(&key);block.height=39999;block.hash=vec![9;32];
        if internal {
            use zcash_note_encryption::Domain;
            let dfvk=key.sapling().unwrap();
            let note=sapling::Note::from_parts(dfvk.change_address().1,sapling::value::NoteValue::from_raw(50000),sapling::Rseed::AfterZip212([42;32]));
            let encryptor=sapling::note_encryption::sapling_note_encryption(Some(dfvk.to_internal_fvk().ovk),note.clone(),[0;512],&mut rand_core::UnwrapErr(getrandom::SysRng));
            block.vtx[0].outputs[0]=zcash_client_backend::proto::compact_formats::CompactSaplingOutput{cmu:note.cmu().to_bytes().to_vec(),ephemeral_key:sapling::note_encryption::SaplingDomain::epk_bytes(encryptor.epk()).0.to_vec(),ciphertext:encryptor.encrypt_note_plaintext()[..52].to_vec()};
        }
        // ZIP 218 requires an anchor behind the tip, independently of confirmation counts.
        let confirmation=zcash_client_backend::proto::compact_formats::CompactBlock {
            height:40000,hash:vec![8;32],prev_hash:block.hash.clone(),time:2,
            chain_metadata:block.chain_metadata.clone(),..Default::default()
        };
        json!({"import":import,"target":{"height":40000,"hash":"08".repeat(32)},"batches":[{"priorTreeState":hex::encode(state.encode_to_vec()),"blocks":[hex::encode(block.encode_to_vec()),hex::encode(confirmation.encode_to_vec())]}]})
}
pub(super) fn pczt_fixture()->Value {
    json!({"mnemonic":WORDS,"accountIndex":0,"external":scan_fixture(true,false),"internal":scan_fixture(true,true),"publicWallet":public_wallet_funds(&serde_json::from_str(include_str!("../public-wallet-funding.json")).unwrap())})
}
fn prepared_signer(post_zip212:bool,with_signer:bool,internal:bool)->(String,u32,Value,Option<u32>) {prepared_proving(post_zip212,with_signer,internal,false)}
fn prepared_proving(post_zip212:bool,with_signer:bool,internal:bool,ironwood:bool)->(String,u32,Value,Option<u32>) {prepared_mode(post_zip212,with_signer,internal,ironwood,"transfer")}
fn prepared_mode(post_zip212:bool,with_signer:bool,internal:bool,ironwood:bool,mode:&str)->(String,u32,Value,Option<u32>) {
    let fixture=if post_zip212{scan_fixture(with_signer,internal)}else{confirmed_scan_fixture()};
    let (path,g)=open();
    let (account,token)=if with_signer {
        let input=json!({"accountIndex":0,"birthday":fixture["import"]["birthday"]});
        let result:Value=serde_json::from_str(&crate::wallet::signer::signer_create_account(g,"account_import_hd",&input.to_string(),WORDS.as_bytes().to_vec(),vec![]).unwrap()).unwrap();
        (result["account"].clone(),Some(result["signerToken"].as_u64().unwrap() as u32))
    }else{let mut import=fixture["import"].clone();if mode.starts_with("view-only"){import["viewOnly"]=json!(true);}(call(g,"account_import",import).unwrap(),None)};
    let scan=|operation:&str,input:Value|crate::wallet::scan::scan_call(g,operation,&input.to_string()).map(|s|serde_json::from_str::<Value>(&s).unwrap()).unwrap();
    let mut revision=scan("scan_plan",json!({"target":fixture["target"]}))["revision"].clone();
    for data in fixture["batches"].as_array().unwrap(){let mut input=data.clone();input["target"]=fixture["target"].clone();input["revision"]=revision;revision=scan("scan_ingest_batch",input)["revision"].clone();}
    let t=call(g,"address_next",json!({"accountId":account["id"],"request":{"format":"transparent"}})).unwrap();
    let s=call(g,"address_next",json!({"accountId":account["id"],"request":{"format":"unified","transparent":"omit","sapling":if ironwood{"omit"}else{"require"},"ironwood":if ironwood{"require"}else{"omit"}}})).unwrap();
    let state:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();
    let mut input=json!({"revision":state["revision"],"accountId":account["id"],"payments":[{"to":t["address"],"amount":"10000"},{"to":s["address"],"amount":"10000","memo":hex::encode(zcash_protocol::memo::MemoBytes::empty().as_array())}],
        "policy":{"spendPools":["sapling"],"transparent":"disallow","changePool":if ironwood{"ironwood"}else{"sapling"},"feeRule":"zip317-standard","confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":false},"expiry":{"kind":"offset","blocks":40},"lockExpiryBlocks":20}});
    if mode=="tex" {input["payments"]=json!([{"to":zcash_keys::address::Address::Tex([4;20]).encode(&crate::Document::parse(PARAMS).unwrap()),"amount":"10000"}]);}
    if mode=="shield"||mode=="fixture"||mode=="view-only-shield" {
        crate::wallet::DOMAIN.with(|domain| {
            let mut domain=domain.borrow_mut();let db=&mut domain.active.iter_mut().find(|a|a.generation==g).unwrap().wallet;
            let zcash_keys::address::Address::Transparent(address)=zcash_keys::address::Address::decode(db.params(),t["address"].as_str().unwrap()).unwrap() else {panic!()};
            let id=zcash_client_sqlite::AccountUuid::from_uuid(uuid::Uuid::parse_str(account["id"].as_str().unwrap()).unwrap());
            let mut parent_id=[33;32];
            if mode=="fixture" {
                let coinbase=zcash_transparent::bundle::TxIn::coinbase(39900.into(),None).unwrap();
                let parent=zcash_primitives::transaction::TransactionData::<zcash_primitives::transaction::Authorized>::from_parts(zcash_primitives::transaction::TxVersion::V5,zcash_protocol::consensus::BranchId::for_height(db.params(),39900.into()),0,0.into(),Some(zcash_transparent::bundle::Bundle{vin:vec![zcash_transparent::bundle::TxIn::from_parts(coinbase.prevout().clone(),coinbase.script_sig().into(),coinbase.sequence())],vout:vec![zcash_transparent::bundle::TxOut::new(zcash_protocol::value::Zatoshis::const_from_u64(70000),address.script().into())],authorization:zcash_transparent::bundle::Authorized}),None,None,None).freeze().unwrap();
                parent_id=*parent.txid().as_ref();let mut bytes=vec![];parent.write(&mut bytes).unwrap();input["fundingParent"]=json!({"raw":hex::encode(bytes),"txid":parent.txid().to_string(),"minedHeight":39900});
            }
            let utxo=zcash_client_backend::wallet::WalletTransparentOutput::from_parts(zcash_transparent::bundle::OutPoint::new(parent_id,0),zcash_transparent::bundle::TxOut::new(zcash_protocol::value::Zatoshis::const_from_u64(70000),address.script().into()),Some(40000u32.into()),Some(id),Some(TransparentKeyScope::EXTERNAL),None).unwrap();
            db.put_received_transparent_utxo(&utxo).unwrap();
        });
        input.as_object_mut().unwrap().remove("payments");input["kind"]=json!("shield");input["threshold"]=json!("10000");input["policy"]["spendPools"]=json!(["transparent"]);input["policy"]["transparent"]=json!("allow-owned");
    }
    if mode=="fixture"||mode.starts_with("view-only"){return(path,g,input,token);}
    let plan:Value=serde_json::from_str(&crate::wallet::proposal::proposal_call(g,"proposal_create",&input.to_string()).unwrap()).unwrap();
    (path,g,plan,token)
}
fn request(plan:&Value)->Value {json!({"operationId":plan["operationId"],"proposalId":plan["proposalId"],"reviewCommitment":plan["reviewCommitment"]})}
#[test]
fn pczt_build_atomic_exact_outputs_and_retained_reopen() {
    let (path,g,plan)=prepared(true);let input=request(&plan);
    let mut forged=input.clone();forged["reviewCommitment"]=json!("00".repeat(32));
    assert_eq!(invoke(g,"pczt_build",forged).unwrap_err(),"PCZT_ASSOCIATION_MISMATCH");
    let conn=rusqlite::Connection::open(&path).unwrap();
    let before=policy_rows(&conn,&["addresses","ext_wallet_pczt","ext_wallet_revision"]);
    conn.execute_batch("CREATE TRIGGER build_fail BEFORE INSERT ON ext_wallet_pczt BEGIN SELECT RAISE(ABORT,'synthetic artifact failure'); END").unwrap();
    assert_eq!(invoke(g,"pczt_build",input.clone()).unwrap_err(),"STORAGE_ERROR");
    conn.execute_batch("DROP TRIGGER build_fail").unwrap();
    assert_eq!(policy_rows(&conn,&["addresses","ext_wallet_pczt","ext_wallet_revision"]),before);
    assert_eq!(invoke(g,"pczt_get_artifact",json!({"operationId":plan["operationId"]})).unwrap(),Value::Null);
    let artifact=invoke(g,"pczt_build",input.clone()).unwrap();
    assert_eq!(artifact["outputs"].as_array().unwrap().len(),3);
    assert_eq!(artifact["outputs"][0]["address"],plan["steps"][0]["outputs"][0]["address"]);
    assert_eq!(artifact["outputs"][1]["address"],plan["steps"][0]["outputs"][1]["address"]);
    assert_eq!(artifact["outputs"][1]["memo"],Value::Null,"explicit empty memo is native empty semantics");
    assert_eq!(artifact["outputs"][2]["kind"],"change");assert!(artifact["outputs"][2]["address"].as_str().is_some());
    // Pinned decrypt_diversifier misses internal scope; native change derivation proves ownership.
    let p=crate::Document::parse(PARAMS).unwrap();
    let key=UnifiedFullViewingKey::decode(&p,fixture(10)["viewingKey"].as_str().unwrap()).unwrap();
    let zcash_keys::address::Address::Sapling(change)=zcash_keys::address::Address::decode(&p,artifact["outputs"][2]["address"].as_str().unwrap()).unwrap() else {panic!("Sapling change")};
    assert_eq!(key.sapling().unwrap().diversified_change_address(*change.diversifier()),Some(change));
    assert_eq!(artifact["proofsComplete"],false);assert_eq!(artifact["authorizationComplete"],false);
    assert_eq!(invoke(g,"pczt_build",input.clone()).unwrap(),artifact,"idempotent build does not rebuild random effects");
    drop(conn);crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(invoke(g,"pczt_get_artifact",json!({"operationId":plan["operationId"]})).unwrap(),artifact);
    assert_eq!(invoke(g,"pczt_build",input).unwrap(),artifact,"retained bytes survive new owner revision");
    crate::wallet::storage_close(g).unwrap();
}
#[test]
fn pczt_build_rejects_stale_and_multistep_without_artifact() {
    let (path,g,plan)=prepared(true);
    call(g,"address_next",json!({"accountId":plan["accountId"],"request":{"format":"transparent"}})).unwrap();
    assert_eq!(invoke(g,"pczt_build",request(&plan)).unwrap_err(),"STALE_PROPOSAL");
    let conn=rusqlite::Connection::open(&path).unwrap();
    let encoded:Vec<u8>=conn.query_row("SELECT plan FROM ext_wallet_proposals",[],|r|r.get(0)).unwrap();
    let mut wire=zcash_client_backend::proto::proposal::Proposal::decode(&encoded[..]).unwrap();wire.steps.push(wire.steps[0].clone());
    let encoded=wire.encode_to_vec();conn.execute("UPDATE ext_wallet_proposals SET plan=?1",[&encoded]).unwrap();
    let policy:String=conn.query_row("SELECT policy FROM ext_wallet_proposals",[],|r|r.get(0)).unwrap();let policy:Value=serde_json::from_str(&policy).unwrap();
    let p=crate::Document::parse(PARAMS).unwrap();
    let review=crate::wallet::proposal::review(&wire,&p,plan["accountId"].as_str().unwrap(),plan["operationId"].as_str().unwrap(),&policy,plan["revision"].as_str().unwrap()).unwrap();
    let bound=crate::wallet::proposal::bind_review(review,&encoded,PARAMS,&[3;32],&policy);
    assert_eq!(invoke(g,"pczt_build",request(&bound)).unwrap_err(),"PCZT_MULTI_STEP_UNSUPPORTED");
    assert_eq!(conn.query_row("SELECT count(*) FROM ext_wallet_pczt",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    drop(conn);crate::wallet::storage_close(g).unwrap();
}

#[test]
fn pczt_build_preserves_native_zip212_output_precondition() {
    let (_,g,plan)=prepared(false);
    assert_eq!(invoke(g,"pczt_build",request(&plan)).unwrap_err(),"ROLE_PRECONDITION");
    assert_eq!(invoke(g,"pczt_get_artifact",json!({"operationId":plan["operationId"]})).unwrap(),Value::Null);
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn pczt_build_real_retained_signer_authorizes_after_wallet_close() {
    for internal in [false,true] {
    let (_path,g,plan,token)=prepared_signer(true,true,internal);let token=token.unwrap();
    let artifact=invoke(g,"pczt_build",request(&plan)).unwrap();
    let bytes=hex::decode(artifact["bytes"].as_str().unwrap()).unwrap();
    let original=pczt::Pczt::parse(&bytes).unwrap();
    pczt::roles::verifier::Verifier::new(original.clone()).with_sapling::<(),_>(|bundle|{assert!(bundle.spends().iter().any(|s|s.proof_generation_key().is_none()));Ok(())}).unwrap();
    let other:Value=serde_json::from_str(&crate::wallet::signer::signer_create_account(g,"account_import_hd",&json!({"accountIndex":0,"birthday":"fullScan"}).to_string(),WORDS.as_bytes().to_vec(),b"foreign".to_vec()).unwrap()).unwrap();
    let other=other["signerToken"].as_u64().unwrap() as u32;
    crate::wallet::storage_close(g).unwrap();
    assert_eq!(crate::wallet::signer::signer_authorize(other,PARAMS,&[3;32],40001,plan["branchId"].as_u64().unwrap() as u32,&bytes,4194304).unwrap_err(),"SIGNER_MISMATCH");
    crate::wallet::signer::signer_release(other).unwrap();
    let signed=crate::wallet::signer::signer_authorize(token,PARAMS,&[3;32],40001,plan["branchId"].as_u64().unwrap() as u32,&bytes,4194304).unwrap();
    let signed=pczt::Pczt::parse(&signed).unwrap();
    let mut role=pczt::roles::signer::Signer::new(signed.clone()).unwrap();
    pczt::roles::verifier::Verifier::new(signed).with_sapling::<(),_>(|bundle|{for (index,spend) in bundle.spends().iter().enumerate(){role.apply_sapling_signature(index,spend.spend_auth_sig().clone().unwrap()).unwrap();}Ok(())}).unwrap();
    assert_eq!(original.serialize().unwrap(),bytes,"authorization does not mutate retained artifact");
    crate::wallet::signer::signer_release(token).unwrap();
    }
}

#[test]
fn pczt_import_retains_versions_and_rolls_back_invalid_returns() {
    let(path,g,plan,token)=prepared_signer(true,true,false);let token=token.unwrap();
    let original=invoke(g,"pczt_build",request(&plan)).unwrap();
    let bytes=hex::decode(original["bytes"].as_str().unwrap()).unwrap();
    let signed=crate::wallet::signer::signer_authorize(token,PARAMS,&[3;32],40001,plan["branchId"].as_u64().unwrap() as u32,&bytes,4194304).unwrap();
    let import=|g,bytes:&[u8]|crate::wallet::pczt_build::pczt_import_call(g,plan["operationId"].as_str().unwrap(),bytes,4194304).map(|s|serde_json::from_str::<Value>(&s).unwrap());
    let conn=rusqlite::Connection::open(&path).unwrap();
    let before=policy_rows(&conn,&["ext_wallet_pczt","ext_wallet_pczt_artifacts","ext_wallet_revision"]);
    let mut changed=serde_json::to_value(pczt::v2::Pczt::try_from(pczt::Pczt::parse(&signed).unwrap()).unwrap()).unwrap();
    changed["transparent"]["outputs"][0]["value"]=json!(1);
    let changed=serde_json::from_value::<pczt::v2::Pczt>(changed).unwrap().serialize();
    assert_eq!(import(g,&changed).unwrap_err(),"PCZT_ASSOCIATION_MISMATCH");
    let mut signature=vec![];
    pczt::roles::verifier::Verifier::new(pczt::Pczt::parse(&signed).unwrap()).with_sapling::<(),_>(|bundle|{let bytes:[u8;64]=bundle.spends()[0].spend_auth_sig().clone().unwrap().into();signature=bytes.to_vec();Ok(())}).unwrap();
    let mut invalid_signed=signed.clone();let at=invalid_signed.windows(64).position(|part|part==signature).unwrap();invalid_signed[at+63]^=1;
    assert_eq!(import(g,&invalid_signed).unwrap_err(),"INVALID_PCZT");
    assert_eq!(crate::wallet::pczt_build::pczt_import_call(g,&"00".repeat(32),&signed,4194304).unwrap_err(),"OPERATION_NOT_FOUND");
    conn.execute_batch("CREATE TRIGGER import_fail BEFORE INSERT ON ext_wallet_pczt_artifacts BEGIN SELECT RAISE(ABORT,'synthetic import failure'); END").unwrap();
    assert_eq!(import(g,&signed).unwrap_err(),"STORAGE_ERROR");
    conn.execute_batch("DROP TRIGGER import_fail").unwrap();
    assert_eq!(policy_rows(&conn,&["ext_wallet_pczt","ext_wallet_pczt_artifacts","ext_wallet_revision"]),before);
    let reduced=crate::standalone_pczt::parse_standalone_pczt(PARAMS,&[3;32],40001,plan["branchId"].as_u64().unwrap() as u32,&signed,4194304).unwrap().redact("zakura-signer-full/1").unwrap().serialize().unwrap();
    assert!(reduced.len()<signed.len());
    assert_eq!(crate::wallet::pczt_build::pczt_import_call(g,plan["operationId"].as_str().unwrap(),&reduced,reduced.len() as u32).unwrap_err(),"RESOURCE_LIMIT");
    assert_eq!(policy_rows(&conn,&["ext_wallet_pczt","ext_wallet_pczt_artifacts","ext_wallet_revision"]),before);
    let accepted=import(g,&signed).unwrap();assert_eq!(accepted["authorizationComplete"],true);assert_ne!(accepted["artifactId"],original["artifactId"]);
    let after=policy_rows(&conn,&["ext_wallet_pczt","ext_wallet_pczt_artifacts","ext_wallet_revision"]);
    assert_eq!(import(g,&signed).unwrap(),accepted);assert_eq!(policy_rows(&conn,&["ext_wallet_pczt","ext_wallet_pczt_artifacts","ext_wallet_revision"]),after);
    crate::wallet::signer::signer_release(token).unwrap();drop(conn);crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(invoke(g,"pczt_get_artifact",json!({"operationId":plan["operationId"]})).unwrap(),accepted);
    for artifact in [original,accepted]{assert_eq!(invoke(g,"pczt_get_artifact",json!({"operationId":plan["operationId"],"artifactId":artifact["artifactId"]})).unwrap(),artifact);}
    crate::wallet::storage_close(g).unwrap();
}

#[test]
#[ignore = "requires locally qualified canonical Sapling parameters and real proving"]
fn pczt_prove_real_sapling_retains_and_verifies() { prove_retained(false,false); }
#[test]
#[ignore = "requires locally qualified parameters and real Sapling/Ironwood proving"]
fn pczt_prove_real_ironwood_retains_and_verifies() { prove_retained(true,false); }
#[test]
#[ignore = "requires canonical assets and real finalize proof fixture"]
fn pczt_finalize_real_sapling_atomic() { prove_retained(false,true); }
#[test]
#[ignore = "requires canonical assets and real finalize proof fixture"]
fn pczt_finalize_real_ironwood_atomic() { prove_retained(true,true); }
fn prove_retained(ironwood:bool,finalize:bool) {
    let root=std::env::var("PCZT_PROVING_PARAMETERS").unwrap();
    let spend=std::fs::read(format!("{root}/sapling-spend.params")).unwrap();
    let output=std::fs::read(format!("{root}/sapling-output.params")).unwrap();
    let(path,g,plan,token)=prepared_proving(true,true,false,ironwood);let token=token.unwrap();
    let original=invoke(g,"pczt_build",request(&plan)).unwrap();
    let bytes=hex::decode(original["bytes"].as_str().unwrap()).unwrap();
    let signed=crate::wallet::signer::signer_authorize(token,PARAMS,&[3;32],40001,plan["branchId"].as_u64().unwrap() as u32,&bytes,4194304).unwrap();
    let retained:Value=serde_json::from_str(&crate::wallet::pczt_build::pczt_import_call(g,plan["operationId"].as_str().unwrap(),&signed,4194304).unwrap()).unwrap();
    let prove=|spend:&[u8],output:&[u8]|crate::wallet::pczt_prove::pczt_prove_call(g,plan["operationId"].as_str().unwrap(),retained["artifactId"].as_str().unwrap(),spend,output,4194304);
    let conn=rusqlite::Connection::open(&path).unwrap();let before=policy_rows(&conn,&["ext_wallet_pczt","ext_wallet_pczt_artifacts","ext_wallet_revision"]);
    assert_eq!(prove(&spend[..spend.len()-1],&output).unwrap_err(),"ASSET_INTEGRITY");
    assert_eq!(prove(&[],&output).unwrap_err(),"PROVING_MATERIAL_REQUIRED");
    let mut corrupt=output.clone();corrupt[0]^=1;assert_eq!(prove(&spend,&corrupt).unwrap_err(),"ASSET_INTEGRITY");
    assert_eq!(retained["requiresSaplingProofs"],true);assert_eq!(retained["requiresIronwoodProof"],ironwood);
    assert_eq!(policy_rows(&conn,&["ext_wallet_pczt","ext_wallet_pczt_artifacts","ext_wallet_revision"]),before);
    let proven:Value=serde_json::from_str(&prove(&spend,&output).unwrap()).unwrap();
    assert_eq!(proven["proofsComplete"],true);assert_eq!(proven["requiresSaplingProofs"],false);assert_eq!(proven["requiresIronwoodProof"],false);assert_ne!(proven["artifactId"],retained["artifactId"]);
    let value=pczt::Pczt::parse(&hex::decode(proven["bytes"].as_str().unwrap()).unwrap()).unwrap();
    assert!(!value.sapling().spends().is_empty());assert!(!value.sapling().outputs().is_empty());
    assert_eq!(!value.ironwood().actions().is_empty(),ironwood);
    let spend_vk=sapling::circuit::SpendParameters::read(&spend[..],false).unwrap().verifying_key();
    let output_vk=sapling::circuit::OutputParameters::read(&output[..],false).unwrap().verifying_key();
    pczt::roles::tx_extractor::TransactionExtractor::new(value).with_sapling(&spend_vk,&output_vk).extract().unwrap();
    assert_eq!(invoke(g,"pczt_get_artifact",json!({"operationId":plan["operationId"],"artifactId":original["artifactId"]})).unwrap(),original);
    let finalized=if finalize {
        let call=|spend:&[u8],output:&[u8]|crate::wallet::pczt_finalize::pczt_finalize_call(g,plan["operationId"].as_str().unwrap(),proven["artifactId"].as_str().unwrap(),spend,output,4194304);
        let tables=["transactions","sent_notes","sapling_received_note_spends","orchard_received_note_spends","ironwood_received_note_spends","ext_wallet_finalized","ext_wallet_revision"];
        let before=policy_rows(&conn,&tables);
        conn.execute_batch("CREATE TRIGGER finalize_fail BEFORE INSERT ON ext_wallet_finalized BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
        assert!(call(&spend,&output).is_err());conn.execute_batch("DROP TRIGGER finalize_fail").unwrap();
        assert_eq!(policy_rows(&conn,&tables),before,"backend storage and outbox insertion roll back together");
        assert_eq!(serde_json::from_str::<Value>(&crate::wallet::pczt_finalize::finalized_get(g,plan["operationId"].as_str().unwrap()).unwrap()).unwrap()["transactions"],json!([]));
        let finalized=call(&spend,&output).unwrap();
        assert_eq!(call(&[],&[]).unwrap(),finalized,"already committed exact bytes need no extraction or assets");
        let txid:Vec<u8>=conn.query_row("SELECT txid FROM ext_wallet_finalized",[],|r|r.get(0)).unwrap();
        conn.execute("UPDATE ext_wallet_finalized SET txid=zeroblob(32)",[]).unwrap();
        assert_eq!(crate::wallet::pczt_finalize::finalized_get(g,plan["operationId"].as_str().unwrap()).unwrap_err(),"STORAGE_ERROR");
        conn.execute("UPDATE ext_wallet_finalized SET txid=?1",[txid]).unwrap();
        if !ironwood{payment_real_journal(g,&path,&plan,&serde_json::from_str(&finalized).unwrap());}
        Some(finalized)
    }else{None};
    drop(conn);crate::wallet::storage_close(g).unwrap();let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(invoke(g,"pczt_get_artifact",json!({"operationId":plan["operationId"]})).unwrap(),proven);
    if let Some(finalized)=finalized {
        let mut old:Value=serde_json::from_str(&finalized).unwrap();let mut reopened:Value=serde_json::from_str::<Value>(&crate::wallet::pczt_finalize::finalized_get(g,plan["operationId"].as_str().unwrap()).unwrap()).unwrap()["transactions"][0].clone();
        let current:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();assert_eq!(reopened["revision"],current["revision"]);
        old.as_object_mut().unwrap().remove("revision");reopened.as_object_mut().unwrap().remove("revision");assert_eq!(reopened,old);
        if !ironwood {let state=payment(g,"payment_reconcile",json!({"operationId":plan["operationId"],"wallTimeMs":3000000})).unwrap();assert_eq!(state["state"]["steps"][0]["attempts"].as_array().unwrap().len(),2);let conn=rusqlite::Connection::open(&path).unwrap();assert_eq!(conn.query_row("SELECT automatic_count FROM ext_wallet_submission",[],|r|r.get::<_,i64>(0)).unwrap(),1);assert_eq!(conn.query_row("SELECT max_attempts FROM ext_wallet_submission",[],|r|r.get::<_,i64>(0)).unwrap(),1);}
    }
    crate::wallet::storage_close(g).unwrap();crate::wallet::signer::signer_release(token).unwrap();
    if finalize && !ironwood { payment_expiry_branch_edges(&path,&plan); }
}

fn payment(g:u32,command:&str,input:Value)->std::result::Result<Value,String>{
    crate::wallet::payment::payment_call(g,command,&input.to_string()).map(|s|serde_json::from_str(&s).unwrap())
}
#[test]
fn payment_migration_enumerates_unfinalized_and_preserves_identity(){
    let(path,g,plan)=prepared(true);
    let id=&plan["operationId"];
    let state=payment(g,"payment_get",json!({"operationId":id})).unwrap();
    assert_eq!(state["state"]["phase"],"proposed");assert_eq!(state["state"]["missing"],json!(["artifact","finalizedBytes"]));
    assert_eq!(state["state"]["lockExpiryHeight"],plan["lockExpiryHeight"]);assert_eq!(state["state"]["lockExpiryHeight"],40021);assert_eq!(state["state"]["steps"][0]["expiry"]["height"],40041);assert_eq!(state["state"]["steps"][0]["expiry"]["reached"],Value::Null);
    let conn=rusqlite::Connection::open(&path).unwrap();let original_policy:String=conn.query_row("SELECT policy FROM ext_wallet_proposals",[],|r|r.get(0)).unwrap();let mut disabled:Value=serde_json::from_str(&original_policy).unwrap();disabled["expiry"]=json!({"kind":"disabled"});conn.execute("UPDATE ext_wallet_proposals SET policy=?1",[disabled.to_string()]).unwrap();
    let disabled=payment(g,"payment_get",json!({"operationId":id})).unwrap();assert_eq!(disabled["state"]["steps"][0]["expiry"],json!({"height":null,"reached":false,"confirmedUnminedAt":null}));conn.execute("UPDATE ext_wallet_proposals SET policy=?1",[original_policy]).unwrap();drop(conn);
    let page=payment(g,"payment_list",json!({"afterSequence":"0","limit":1})).unwrap();assert_eq!(page["items"][0]["operationId"],*id);
    let high=page["highWater"].clone();payment(g,"payment_recovery_position",json!({"afterSequence":high})).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();let identity:Vec<u8>=conn.query_row("SELECT identity FROM ext_wallet_submission_meta",[],|r|r.get(0)).unwrap();drop(conn);
    crate::wallet::storage_close(g).unwrap();let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();assert_eq!(conn.query_row("SELECT identity FROM ext_wallet_submission_meta",[],|r|r.get::<_,Vec<u8>>(0)).unwrap(),identity);drop(conn);
    assert_eq!(payment(g,"payment_list",json!({"afterSequence":"0","limit":200})).unwrap()["observationPosition"],high);
    crate::wallet::storage_close(g).unwrap();
    // An older database has no submission records: migration must not invent consent.
    let conn=rusqlite::Connection::open(&path).unwrap();conn.execute_batch("DROP TABLE ext_wallet_attempts; DROP TABLE ext_wallet_submission; DROP TABLE ext_wallet_submission_meta;").unwrap();
    // Closed-DB inventory fixture: native retained plan shape, no txid/artifact/consent.
    for sequence in 2u32..=205 {
        let mut operation=[0;32];operation[..4].copy_from_slice(&sequence.to_le_bytes());
        conn.execute("INSERT INTO ext_wallet_proposals SELECT ?1,?2,account,plan,policy,revision FROM ext_wallet_proposals WHERE sequence=1",rusqlite::params![sequence,operation]).unwrap();
    }
    drop(conn);
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let migrated=payment(g,"payment_reconcile",json!({"operationId":id,"wallTimeMs":1000})).unwrap();assert!(migrated["state"]["steps"][0]["attempts"].as_array().unwrap().is_empty());
    let first=payment(g,"payment_list",json!({"afterSequence":"0","limit":200})).unwrap();assert_eq!(first["items"].as_array().unwrap().len(),200);
    for row in first["items"].as_array().unwrap(){payment(g,"payment_reconcile",json!({"operationId":row["operationId"],"wallTimeMs":1000})).unwrap();}
    payment(g,"payment_recovery_position",json!({"afterSequence":"200"})).unwrap();
    let tail=payment(g,"payment_list",json!({"afterSequence":"200","highWater":first["highWater"],"limit":200})).unwrap();assert_eq!(tail["items"].as_array().unwrap().len(),5);
    for row in tail["items"].as_array().unwrap(){payment(g,"payment_reconcile",json!({"operationId":row["operationId"],"wallTimeMs":1000})).unwrap();}
    crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(payment(g,"payment_list",json!({"afterSequence":"0","limit":1})).unwrap()["observationPosition"],"200","recovery rotation survives native database reopen");
    crate::wallet::storage_close(g).unwrap();
}
// Reuse real finalized bytes; only the isolated synthetic chain-evidence tables
// change. No transaction/proof is edited or regenerated for these dispatch gates.
fn payment_expiry_branch_edges(path:&str,plan:&Value) {
    for (tip,expected) in [(40041u32,"TRANSACTION_EXPIRED"),(98u32,"PAYMENT_BLOCKED")] {
        let fork=format!("{path}-edge-{tip}");std::fs::copy(path,&fork).unwrap();
        let conn=rusqlite::Connection::open(&fork).unwrap();
        conn.execute("INSERT INTO blocks SELECT ?1,hash,time,sapling_tree,sapling_commitment_tree_size,orchard_commitment_tree_size,sapling_output_count,orchard_action_count,ironwood_commitment_tree_size,ironwood_action_count FROM blocks WHERE height=40000",[tip]).unwrap();
        conn.execute("DELETE FROM scan_queue",[]).unwrap();
        conn.execute("INSERT INTO scan_queue(block_range_start,block_range_end,priority) VALUES(20,?1,0)",[tip+1]).unwrap();drop(conn);
        let g=crate::wallet::initialize_path(&fork,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        let conn=rusqlite::Connection::open(&fork).unwrap();
        let stored:Value=serde_json::from_str(&crate::wallet::pczt_finalize::finalized_get(g,plan["operationId"].as_str().unwrap()).unwrap()).unwrap();
        // Clear only old observation evidence, retaining original bytes, consent,
        // retry counters and attempts; the new observation is natively checked.
        conn.execute("UPDATE ext_wallet_submission SET observation=NULL",[]).unwrap();
        let observed=payment(g,"payment_observe",json!({"operationId":plan["operationId"],"stepIndex":0,"wallTimeMs":3000001,"observation":{"sourceId":"fixture","observedAt":"2026-09-13T00:00:00.000Z","txid":stored["transactions"][0]["txid"],"state":"notSeen","inclusion":null,"tip":{"height":tip,"hash":"08".repeat(32)},"priorInclusion":null}})).unwrap();
        let tables=["ext_wallet_submission","ext_wallet_attempts","ext_wallet_revision","ext_wallet_finalized"];let before=policy_rows(&conn,&tables);
        assert_eq!(payment(g,"payment_attempt_begin",json!({"operationId":plan["operationId"],"stepIndex":0,"sourceId":"fixture","routeBinding":"01".repeat(32),"mode":"explicit","origin":"broadcast","wallTimeMs":3000002,"monotonicElapsedMs":1000,"observationSequence":observed["observationSequence"],"maximum":2097152})).unwrap_err(),expected);
        assert_eq!(policy_rows(&conn,&tables),before,"unsafe dispatch leaves exact bytes and attempt state untouched");
        drop(conn);crate::wallet::storage_close(g).unwrap();std::fs::remove_file(fork).unwrap();
    }
}
fn payment_real_journal(g:u32,path:&str,plan:&Value,finalized:&Value){
    let operation=&plan["operationId"];
    let observe=|g|payment(g,"payment_observe",json!({"operationId":operation,"stepIndex":0,"wallTimeMs":1000,"observation":{"sourceId":"fixture","observedAt":"2026-09-13T00:00:00.000Z","txid":finalized["txid"],"state":"notSeen","inclusion":null,"tip":{"height":40000,"hash":"08".repeat(32)},"priorInclusion":null}})).unwrap();
    let mut begin=json!({"operationId":operation,"stepIndex":0,"sourceId":"fixture","routeBinding":"01".repeat(32),"mode":"automatic","wallTimeMs":1000,"monotonicElapsedMs":1000,"observationSequence":observe(g)["observationSequence"],"policy":{"maxAttempts":2,"minIntervalMs":100},"maximum":2097152});
    assert_eq!(payment(g,"payment_attempt_begin",begin.clone()).unwrap(),Value::Null,"finalization does not grant consent");
    begin["mode"]=json!("explicit");begin["origin"]=json!("broadcast");
    let conn=rusqlite::Connection::open(path).unwrap();let tables=["ext_wallet_submission","ext_wallet_attempts","ext_wallet_revision"];let before=policy_rows(&conn,&tables);
    let exact_size=finalized["bytes"].as_str().unwrap().len()/2;
    let mut too_small=begin.clone();too_small["maximum"]=json!(exact_size-1);assert_eq!(payment(g,"payment_attempt_begin",too_small).unwrap_err(),"RESOURCE_LIMIT");assert_eq!(policy_rows(&conn,&tables),before);
    conn.execute_batch("CREATE TRIGGER attempt_fail BEFORE INSERT ON ext_wallet_attempts BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
    assert_eq!(payment(g,"payment_attempt_begin",begin.clone()).unwrap_err(),"STORAGE_ERROR");assert_eq!(policy_rows(&conn,&tables),before);
    conn.execute_batch("DROP TRIGGER attempt_fail").unwrap();
    begin["maximum"]=json!(exact_size);
    let started=payment(g,"payment_attempt_begin",begin.clone()).unwrap();assert_eq!(started["bytes"],finalized["bytes"]);assert_eq!(started["txid"],finalized["txid"]);
    let reconciled=payment(g,"payment_reconcile",json!({"operationId":operation,"wallTimeMs":1001})).unwrap();assert_eq!(reconciled["state"]["steps"][0]["attempts"][0]["outcome"],"unknown");
    begin["mode"]=json!("automatic");begin.as_object_mut().unwrap().remove("origin");begin["observationSequence"]=observe(g)["observationSequence"].clone();begin["wallTimeMs"]=json!(1000000);begin["monotonicElapsedMs"]=json!(99);
    assert!(payment(g,"payment_attempt_begin",begin.clone()).unwrap().is_null(),"wall clock jump cannot bypass monotonic interval");
    begin["monotonicElapsedMs"]=json!(100);let mut foreign=begin.clone();foreign["routeBinding"]=json!("02".repeat(32));assert!(payment(g,"payment_attempt_begin",foreign).unwrap().is_null());
    let retry=payment(g,"payment_attempt_begin",begin.clone()).unwrap();assert_eq!(retry["bytes"],started["bytes"]);
    assert_eq!(payment(g,"payment_attempt_finish",json!({"operationId":operation,"attemptId":retry["attemptId"],"outcome":"acknowledged","txid":"00".repeat(32),"wallTimeMs":1000001})).unwrap_err(),"PROTOCOL_MISMATCH");
    payment(g,"payment_attempt_finish",json!({"operationId":operation,"attemptId":retry["attemptId"],"outcome":"acknowledged","txid":finalized["txid"],"wallTimeMs":1000001})).unwrap();
    begin["observationSequence"]=observe(g)["observationSequence"].clone();begin["wallTimeMs"]=json!(2000000);begin["policy"]["maxAttempts"]=json!(1);
    assert!(payment(g,"payment_attempt_begin",begin.clone()).unwrap().is_null());begin["policy"]["maxAttempts"]=json!(100);assert!(payment(g,"payment_attempt_begin",begin).unwrap().is_null(),"later policy cannot replenish lifetime budget");
    let latest=payment(g,"payment_get",json!({"operationId":operation})).unwrap();assert_eq!(latest["state"]["phase"],"observing","ack is not inclusion");assert_eq!(latest["state"]["steps"][0]["attempts"].as_array().unwrap().len(),2);
    let mut mined=json!({"operationId":operation,"stepIndex":0,"wallTimeMs":2000001,"observation":{"sourceId":"fixture","observedAt":"2026-09-13T00:00:00.000Z","txid":finalized["txid"],"state":"mined","inclusion":{"height":40000,"blockHash":"08".repeat(32),"confirmations":1},"tip":{"height":40000,"hash":"08".repeat(32)},"priorInclusion":null}});
    let included=payment(g,"payment_observe",mined.clone()).unwrap();assert_eq!(included["state"]["phase"],"complete");
    mined["observation"]["inclusion"]["height"]=json!(40001);assert_eq!(payment(g,"payment_observe",mined).unwrap_err(),"PROTOCOL_MISMATCH");
    let uncertain=observe(g);assert_eq!(uncertain["state"]["phase"],"observing");assert_eq!(uncertain["state"]["steps"][0]["observation"]["priorInclusion"]["height"],40000);
    // A retained endpoint observation is rechecked against current native block identity.
    let original_hash:Vec<u8>=conn.query_row("SELECT hash FROM blocks WHERE height=40000",[],|r|r.get(0)).unwrap();conn.execute("UPDATE blocks SET hash=zeroblob(32) WHERE height=40000",[]).unwrap();
    let uncertain=payment(g,"payment_get",json!({"operationId":operation})).unwrap();assert_eq!(uncertain["state"]["steps"][0]["expiry"]["reached"],Value::Null);
    conn.execute("UPDATE blocks SET hash=?1 WHERE height=40000",[original_hash]).unwrap();
    drop(conn);
}

#[test]
#[ignore = "requires canonical parameters and real fused proving"]
fn fused_send_real_transfer_shield_and_multistep() {
    let root=std::env::var("PCZT_PROVING_PARAMETERS").unwrap();
    let spend=std::fs::read(format!("{root}/sapling-spend.params")).unwrap();let output=std::fs::read(format!("{root}/sapling-output.params")).unwrap();
    for mode in ["transfer","shield","tex"] {
        let(path,g,plan,token)=prepared_mode(true,true,false,false,mode);let token=token.unwrap();
        let call=|generation,token,spend:&[u8],output:&[u8]|crate::wallet::fused_send::fused_send_call(generation,plan["operationId"].as_str().unwrap(),plan["proposalId"].as_str().unwrap(),plan["reviewCommitment"].as_str().unwrap(),token,spend,output,4194304);
        let conn=rusqlite::Connection::open(&path).unwrap();
        let tables=["transactions","sent_notes","sapling_received_note_spends","transparent_received_output_spends","ext_wallet_finalized","ext_wallet_revision","addresses"];
        let before=policy_rows(&conn,&tables);
        assert_eq!(call(g,0,&spend,&output).unwrap_err(),"STALE_HANDLE");
        assert_eq!(policy_rows(&conn,&tables),before);
        conn.execute_batch(&format!("CREATE TRIGGER fused_fail BEFORE INSERT ON ext_wallet_finalized WHEN NEW.step={} BEGIN SELECT RAISE(ABORT,'fixture'); END",if mode=="tex"{1}else{0})).unwrap();
        assert!(call(g,token,&spend,&output).is_err());conn.execute_batch("DROP TRIGGER fused_fail").unwrap();
        assert_eq!(policy_rows(&conn,&tables),before,"all native effects and exact-byte rows roll back");
        let result=call(g,token,&spend,&output).unwrap();let value:Value=serde_json::from_str(&result).unwrap();
        assert_eq!(value["transactions"].as_array().unwrap().len(),if mode=="tex"{2}else{1});
        for tx in value["transactions"].as_array().unwrap(){assert_eq!(tx["artifactId"],Value::Null);assert!(tx["bytes"].as_str().unwrap().len()>100);}
        crate::wallet::signer::signer_release(token).unwrap();assert_eq!(call(g,0,&[],&[]).unwrap(),result,"retry uses stored bytes without authority or assets");
        if mode=="tex"{payment_multistep(g,&path,&plan,&value);}
        drop(conn);crate::wallet::storage_close(g).unwrap();let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
        if mode=="tex"{let db=rusqlite::Connection::open(&path).unwrap();assert_eq!(db.query_row("SELECT count(*) FROM ext_wallet_submission WHERE max_attempts=1 AND min_interval=500",[],|r|r.get::<_,i64>(0)).unwrap(),2);}
        let reopened:Value=serde_json::from_str(&call(g,0,&[],&[]).unwrap()).unwrap();
        for (old,new) in value["transactions"].as_array().unwrap().iter().zip(reopened["transactions"].as_array().unwrap()) {assert_eq!(old["bytes"],new["bytes"]);assert_eq!(old["txid"],new["txid"]);}
        crate::wallet::storage_close(g).unwrap();
    }
}

#[test]
fn fused_signer_lookup_accepts_ironwood_only_account() {
    let(path,g)=open();let p=crate::Document::parse(PARAMS).unwrap();
    let seed=bip39::Mnemonic::parse(WORDS).unwrap().to_seed("");let ufvk=zcash_keys::keys::UnifiedSpendingKey::from_seed(&p,&seed,zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key();
    let mut input=fixture(10);input["viewingKey"]=json!(ufvk.encode(&p));input["enabledPools"]=json!(["ironwood"]);
    let account=call(g,"account_import",input).unwrap();
    crate::wallet::DOMAIN.with(|domain|{let mut domain=domain.borrow_mut();let db=&mut domain.active.iter_mut().find(|a|a.generation==g).unwrap().wallet;
        let found=db.get_account_for_ufvk(&ufvk).unwrap().expect("native full authority resolves Ironwood-only stored account");assert_eq!(found.id(),zcash_client_sqlite::AccountUuid::from_uuid(uuid::Uuid::parse_str(account["id"].as_str().unwrap()).unwrap()));
    });crate::wallet::storage_close(g).unwrap();let _=path;
}

fn payment_multistep(g:u32,path:&str,plan:&Value,finalized:&Value){
    let id=&plan["operationId"];let txs=&finalized["transactions"];
    let read=payment(g,"payment_get",json!({"operationId":id})).unwrap();
    assert_eq!(read["state"]["missing"],json!([]));assert_eq!(read["state"]["steps"][1]["blockedBy"],json!([0]));
    let observe=|index,mined|payment(g,"payment_observe",json!({"operationId":id,"stepIndex":index,"wallTimeMs":1000,"observation":{"sourceId":"fixture","observedAt":"2026-09-13T00:00:00.000Z","txid":txs[index]["txid"],"state":if mined{"mined"}else{"notSeen"},"inclusion":if mined{json!({"height":40000,"blockHash":"08".repeat(32),"confirmations":1})}else{Value::Null},"tip":{"height":40000,"hash":"08".repeat(32)},"priorInclusion":null}})).unwrap();
    observe(0,false);let state=observe(1,false);
    let mut begin=json!({"operationId":id,"stepIndex":1,"sourceId":"fixture","routeBinding":"01".repeat(32),"mode":"explicit","origin":"send","wallTimeMs":1000,"monotonicElapsedMs":1000,"observationSequence":state["observationSequences"][1],"policy":{"maxAttempts":2,"minIntervalMs":100},"maximum":2097152});
    assert_eq!(payment(g,"payment_attempt_begin",begin.clone()).unwrap_err(),"PAYMENT_BLOCKED");
    begin["stepIndex"]=json!(0);begin["observationSequence"]=state["observationSequences"][0].clone();
    let parent=payment(g,"payment_attempt_begin",begin.clone()).unwrap();
    let mut child_request=begin.clone();child_request["stepIndex"]=json!(1);child_request["observationSequence"]=state["observationSequences"][1].clone();
    assert_eq!(payment(g,"payment_attempt_begin",child_request.clone()).unwrap_err(),"PAYMENT_BLOCKED","outstanding parent cannot release child");
    payment(g,"payment_attempt_finish",json!({"operationId":id,"attemptId":parent["attemptId"],"outcome":"acknowledged","txid":txs[0]["txid"],"wallTimeMs":1001})).unwrap();
    begin["stepIndex"]=json!(1);begin["observationSequence"]=state["observationSequences"][1].clone();
    assert_eq!(payment(g,"payment_attempt_begin",begin.clone()).unwrap_err(),"PAYMENT_BLOCKED","ack does not unlock child");
    let mined=observe(0,true);assert_eq!(mined["state"]["steps"][1]["blockedBy"],json!([]));
    let mut automatic=begin.clone();automatic["mode"]=json!("automatic");automatic.as_object_mut().unwrap().remove("origin");
    assert!(payment(g,"payment_attempt_begin",automatic).unwrap().is_null(),"recovery never first-dispatches child");
    let db=rusqlite::Connection::open(path).unwrap();let hash:Vec<u8>=db.query_row("SELECT hash FROM blocks WHERE height=40000",[],|r|r.get(0)).unwrap();
    db.execute("UPDATE blocks SET hash=zeroblob(32) WHERE height=40000",[]).unwrap();
    assert_eq!(payment(g,"payment_get",json!({"operationId":id})).unwrap()["state"]["steps"][1]["blockedBy"],json!([0]));
    db.execute("UPDATE blocks SET hash=?1 WHERE height=40000",[hash]).unwrap();
    let mempool=payment(g,"payment_observe",json!({"operationId":id,"stepIndex":0,"wallTimeMs":1002,"observation":{"sourceId":"fixture","observedAt":"2026-09-13T00:00:00.000Z","txid":txs[0]["txid"],"state":"mempool","inclusion":null,"tip":{"height":40000,"hash":"08".repeat(32)},"priorInclusion":null}})).unwrap();assert_eq!(mempool["state"]["steps"][1]["blockedBy"],json!([]));
    let child=payment(g,"payment_attempt_begin",begin.clone()).unwrap();assert_eq!(child["bytes"],txs[1]["bytes"]);
    payment(g,"payment_reconcile",json!({"operationId":id,"wallTimeMs":1002,"policy":{"maxAttempts":1,"minIntervalMs":500}})).unwrap();
    begin["observationSequence"]=json!("0");assert_eq!(payment(g,"payment_attempt_begin",begin).unwrap_err(),"RECOVERY_REQUIRED");
    assert_eq!(db.query_row("SELECT count(*) FROM ext_wallet_submission WHERE max_attempts=1 AND min_interval=500",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    let state=payment(g,"payment_get",json!({"operationId":id})).unwrap();assert_eq!(state["state"]["steps"][0]["attempts"].as_array().unwrap().len(),1);assert_eq!(state["state"]["steps"][1]["attempts"].as_array().unwrap().len(),1);
}

#[test]
#[ignore = "generates source-bound synthetic funding with canonical proving parameters"]
fn generate_public_wallet_funding() {
    let(path,g,mut input,token)=prepared_mode(true,true,false,false,"fixture");
    let p=crate::Document::parse(PARAMS).unwrap();let seed=bip39::Mnemonic::parse(WORDS).unwrap().to_seed("");
    let receiver=zcash_keys::keys::UnifiedSpendingKey::from_seed(&p,&seed,zip32::AccountId::try_from(1).unwrap()).unwrap().to_unified_full_viewing_key();
    let ua=receiver.default_address(UnifiedAddressRequest::AllAvailableKeys).unwrap().0;
    let t=json!({"address":zcash_keys::address::Address::Transparent(*ua.transparent().unwrap()).encode(&p)});
    let s=json!({"address":zcash_keys::address::Address::Sapling(receiver.sapling().unwrap().default_address().1).encode(&p)});
    let parent=input.as_object_mut().unwrap().remove("fundingParent").unwrap();
    input.as_object_mut().unwrap().remove("kind");input.as_object_mut().unwrap().remove("threshold");
    input["policy"]["spendPools"]=json!(["sapling","transparent"]);input["policy"]["transparent"]=json!("allow-owned");
    input["payments"]=json!([{"to":t["address"],"amount":"40000"},{"to":s["address"],"amount":"40000"}]);
    input["revision"]=serde_json::from_str::<Value>(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap()["revision"].clone();
    let plan:Value=serde_json::from_str(&crate::wallet::proposal::proposal_call(g,"proposal_create",&input.to_string()).unwrap()).unwrap();
    let root=std::env::var("PCZT_PROVING_PARAMETERS").unwrap();
    let result:Value=serde_json::from_str(&crate::wallet::fused_send::fused_send_call(g,plan["operationId"].as_str().unwrap(),plan["proposalId"].as_str().unwrap(),plan["reviewCommitment"].as_str().unwrap(),token.unwrap(),&std::fs::read(format!("{root}/sapling-spend.params")).unwrap(),&std::fs::read(format!("{root}/sapling-output.params")).unwrap(),4194304).unwrap()).unwrap();
    assert_eq!(result["transactions"].as_array().unwrap().len(),1);
    let funding=json!({"warning":"SYNTHETIC TEST AUTHORITY ONLY","parent":parent,"raw":result["transactions"][0]["bytes"],"txid":result["transactions"][0]["txid"],"transparent":t["address"],"sapling":s["address"]});
    std::fs::write(format!("{}/public-wallet-funding.json",std::env::var("WALLET_TEST_ROOT").unwrap()),funding.to_string()).unwrap();
    crate::wallet::signer::signer_release(token.unwrap()).unwrap();crate::wallet::storage_close(g).unwrap();let _=path;
    let _=public_wallet_funds(&funding);
}

pub(super) fn public_wallet_funds(funding:&Value)->Value {
    use zcash_client_backend::proto::compact_formats::{CompactBlock,CompactTx,ChainMetadata};
    let p=crate::Document::parse(PARAMS).unwrap();let raw=hex::decode(funding["raw"].as_str().unwrap()).unwrap();
    let tx=zcash_primitives::transaction::Transaction::read(&raw[..],zcash_protocol::consensus::BranchId::for_height(&p,40001.into())).unwrap();
    assert_eq!(tx.txid().to_string(),funding["txid"]);
    let mut compact=CompactTx{index:1,txid:tx.txid().as_ref().to_vec(),..Default::default()};
    if let Some(bundle)=tx.sapling_bundle(){compact.spends=bundle.shielded_spends().iter().map(Into::into).collect();compact.outputs=bundle.shielded_outputs().iter().map(Into::into).collect();}
    assert!(tx.orchard_bundle().is_none()&&tx.ironwood_bundle().is_none());
    let block=CompactBlock{height:40001,hash:vec![8;32],prev_hash:vec![7;32],time:1,chain_metadata:Some(ChainMetadata{sapling_commitment_tree_size:compact.outputs.len() as u32,orchard_commitment_tree_size:0,ironwood_commitment_tree_size:0}),vtx:vec![compact],..Default::default()};
    let prior=TreeState{network:"regtest".into(),height:40000,hash:"07".repeat(32),time:1,sapling_tree:"000000".into(),orchard_tree:"000000".into(),ironwood_tree:"000000".into()};
    let mut final_tree=prior.clone();final_tree.height=40001;final_tree.hash="08".repeat(32);
    let mut sapling_tree=prior.sapling_tree().unwrap();for output in &block.vtx[0].outputs{let node=zcash_primitives::merkle_tree::HashSer::read(&output.cmu[..]).unwrap();sapling_tree.append(node).unwrap();}
    let mut tree_bytes=vec![];zcash_primitives::merkle_tree::write_commitment_tree(&sapling_tree,&mut tree_bytes).unwrap();final_tree.sapling_tree=hex::encode(tree_bytes);
    let mut import=scan_fixture(true,false)["import"].clone();let seed=bip39::Mnemonic::parse(WORDS).unwrap().to_seed("");import["viewingKey"]=json!(zcash_keys::keys::UnifiedSpendingKey::from_seed(&p,&seed,zip32::AccountId::try_from(1).unwrap()).unwrap().to_unified_full_viewing_key().encode(&p));import["birthday"]["firstScanHeight"]=json!(40001);import["birthday"]["priorTreeState"]=json!(hex::encode(prior.encode_to_vec()));
    let(path,g)=open();let account=call(g,"account_import",import.clone()).unwrap();
    for _ in 0..2 {call(g,"address_next",json!({"accountId":account["id"],"request":{"format":"transparent"}})).unwrap();call(g,"address_next",json!({"accountId":account["id"],"request":{"format":"unified","transparent":"omit","sapling":"require","ironwood":"omit"}})).unwrap();}
    let target=json!({"height":40001,"hash":"08".repeat(32)});
    let plan:Value=serde_json::from_str(&crate::wallet::scan::scan_call(g,"scan_plan",&json!({"target":target}).to_string()).unwrap()).unwrap();
    crate::wallet::scan::scan_call(g,"scan_ingest_batch",&json!({"target":target,"revision":plan["revision"],"priorTreeState":hex::encode(prior.encode_to_vec()),"blocks":[hex::encode(block.encode_to_vec())]}).to_string()).unwrap();
    for _ in 0..16 {
        let pending:Value=serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap();
        let Some(request)=pending["requests"].as_array().unwrap().first() else{break};
        if request["kind"]=="address"&&request["outputStatus"]=="unspent"{break;}
        let result=if request["kind"]=="enhancement" {let (raw,height)=if request["txid"]==funding["txid"]{(&funding["raw"],40001)}else{assert_eq!(request["txid"],funding["parent"]["txid"]);(&funding["parent"]["raw"],39900)};json!({"transactions":[{"bytes":raw,"minedHeight":height}]})}
        else if request["kind"]=="status" {let height=if request["txid"]==funding["txid"]{40001}else{assert_eq!(request["txid"],funding["parent"]["txid"]);39900};json!({"status":"mined","height":height})}
        else if request["kind"]=="address" {let end=request["endExclusive"].as_u64().unwrap_or_else(||panic!("unhandled funding request {request}"));let contains=request["start"].as_u64().unwrap_or(0)<=40001&&end>40001;json!({"transactions":if contains{json!([{"bytes":funding["raw"],"minedHeight":40001}])}else{json!([])},"complete":true,"asOfHeight":end-1})}
        else{panic!("unexpected funding request {request}")};
        crate::wallet::enhancement::enhancement_call(g,"enhancement_apply",&json!({"revision":pending["revision"],"request":request,"result":result}).to_string()).unwrap();
    }
    let pending:Value=serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap();assert!(pending["requests"].as_array().unwrap().iter().all(|r|r["kind"]=="address"&&r["outputStatus"]=="unspent"));
    let state:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();assert_eq!(state["scanComplete"],true);assert_eq!(state["fullyScannedHeight"],40001);
    crate::wallet::storage_close(g).unwrap();
    json!({"database":hex::encode(std::fs::read(path).unwrap()),"accountId":account["id"],"accountIndex":1,"unspentAddresses":pending["requests"].as_array().unwrap().iter().map(|r|r["address"].clone()).collect::<Vec<_>>(),"target":target,"treeState":hex::encode(final_tree.encode_to_vec()),"block":hex::encode(block.encode_to_vec()),"import":import,"raw":funding["raw"],"txid":funding["txid"],"parent":funding["parent"],"tex":zcash_keys::address::Address::Tex([4;20]).encode(&p)})
}

#[test]
fn public_wallet_funding_fixture(){
    let data=public_wallet_funds(&serde_json::from_str(include_str!("../public-wallet-funding.json")).unwrap());
    let(path,g)=open();crate::wallet::storage_close(g).unwrap();std::fs::write(&path,hex::decode(data["database"].as_str().unwrap()).unwrap()).unwrap();let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    let balance=call(g,"account_balance",json!({"accountId":data["accountId"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":false}})).unwrap();assert_eq!(balance["amounts"]["transparent"]["regular"]["spendable"],"40000");assert_eq!(balance["amounts"]["sapling"]["spendable"],"0");assert_eq!(balance["amounts"]["sapling"]["pendingSpendability"],"40000");
    let initial:Value=serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap();assert!(!initial["requests"].as_array().unwrap().is_empty());
    for request in initial["requests"].as_array().unwrap(){
        let current:Value=serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap();
        crate::wallet::enhancement::enhancement_call(g,"enhancement_apply",&json!({"revision":current["revision"],"request":request,"result":{"transactions":[],"asOfHeight":40001,"asOfHash":"08".repeat(32),"complete":true}}).to_string()).unwrap();
    }
    let after:Value=serde_json::from_str(&crate::wallet::enhancement::enhancement_call(g,"enhancement_requests","{}").unwrap()).unwrap();assert!(after["requests"].as_array().unwrap().iter().all(|r|r["requestAt"].is_u64()));
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn payment_abandon_releases_only_owned_unbuilt_inputs() {
    let (path,g,plan)=prepared(true);let operation=&plan["operationId"];
    let conn=rusqlite::Connection::open(&path).unwrap();
    let owner=hex::decode(operation.as_str().unwrap()).unwrap();
    assert!(conn.query_row("SELECT count(*) FROM sapling_received_notes WHERE lock_owner=?1",[&owner],|r|r.get::<_,u32>(0)).unwrap()>0);
    // An unrelated native note lock remains owned by its distinct operation.
    assert!(conn.execute("UPDATE orchard_received_notes SET lock_owner=?1,lock_expiry_height=50000",[vec![99u8;32]]).unwrap()>0);
    let other=policy_rows(&conn,&["orchard_received_notes"]);
    let tables=["sapling_received_notes","ext_wallet_abandoned","ext_wallet_revision","ext_wallet_proposals"];
    let before=policy_rows(&conn,&tables);
    conn.execute_batch("CREATE TRIGGER abandon_failure BEFORE INSERT ON ext_wallet_abandoned BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
    assert_eq!(payment(g,"payment_abandon",json!({"operationId":operation})).unwrap_err(),"STORAGE_ERROR");
    assert_eq!(policy_rows(&conn,&tables),before,"marker failure rolls back native unlocks");
    conn.execute_batch("DROP TRIGGER abandon_failure").unwrap();
    // Change the revision without rebuilding the original retained plan.
    call(g,"address_next",json!({"accountId":plan["accountId"],"request":{"format":"transparent"}})).unwrap();
    let abandoned=payment(g,"payment_abandon",json!({"operationId":operation})).unwrap();
    assert_eq!(abandoned["state"]["phase"],"abandoned");assert_eq!(abandoned["state"]["missing"],json!([]));
    assert_eq!(conn.query_row("SELECT count(*) FROM sapling_received_notes WHERE lock_owner=?1",[&owner],|r|r.get::<_,u32>(0)).unwrap(),0);
    assert_eq!(policy_rows(&conn,&["orchard_received_notes"]),other);
    assert_eq!(payment(g,"payment_abandon",json!({"operationId":operation})).unwrap(),abandoned,"repeat is a revision-stable no-op");
    assert_eq!(crate::wallet::proposal::proposal_call(g,"proposal_get",&json!({"operationId":operation}).to_string()).unwrap_err(),"ROLE_PRECONDITION");
    assert_eq!(invoke(g,"pczt_build",json!({"operationId":operation,"proposalId":plan["proposalId"],"reviewCommitment":plan["reviewCommitment"]})).unwrap_err(),"ROLE_PRECONDITION");
    assert_eq!(payment(g,"payment_abandon",json!({"operationId":"00".repeat(32)})).unwrap_err(),"OPERATION_NOT_FOUND");
    drop(conn);crate::wallet::storage_close(g).unwrap();
    let g=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(payment(g,"payment_get",json!({"operationId":operation})).unwrap()["state"]["phase"],"abandoned");
    assert_eq!(payment(g,"payment_reconcile",json!({"operationId":operation,"wallTimeMs":1000})).unwrap()["state"]["missing"],json!([]));
    crate::wallet::storage_close(g).unwrap();
}

#[test]
fn payment_abandon_rejects_retained_pczt() {
    let(path,g,plan)=prepared(true);let operation=&plan["operationId"];
    invoke(g,"pczt_build",json!({"operationId":operation,"proposalId":plan["proposalId"],"reviewCommitment":plan["reviewCommitment"]})).unwrap();
    let conn=rusqlite::Connection::open(&path).unwrap();let tables=["ext_wallet_pczt","ext_wallet_abandoned","ext_wallet_revision","sapling_received_notes"];
    let before=policy_rows(&conn,&tables);
    assert_eq!(payment(g,"payment_abandon",json!({"operationId":operation})).unwrap_err(),"ROLE_PRECONDITION");
    assert_eq!(policy_rows(&conn,&tables),before);drop(conn);crate::wallet::storage_close(g).unwrap();
}

#[test]
fn payment_abandon_keeps_idempotency_terminal() {
    let(path,g,mut input,token)=prepared_mode(true,true,false,false,"fixture");input.as_object_mut().unwrap().remove("fundingParent");input["idempotencyKey"]=json!("abandoned-shield");
    let create=|g,op,input:&Value|crate::wallet::proposal::proposal_call(g,op,&input.to_string()).map(|s|serde_json::from_str::<Value>(&s).unwrap());
    let plan=create(g,"proposal_create",&input).unwrap();
    payment(g,"payment_abandon",json!({"operationId":plan["operationId"]})).unwrap();
    assert_eq!(create(g,"proposal_create",&input).unwrap_err(),"ROLE_PRECONDITION");
    let mut lookup=input.clone();lookup.as_object_mut().unwrap().remove("revision");
    assert_eq!(create(g,"proposal_lookup_intent",&lookup).unwrap_err(),"ROLE_PRECONDITION");
    let operation=plan["operationId"].as_str().unwrap();
    assert_eq!(crate::wallet::pczt_build::pczt_import_call(g,operation,&[0],1).unwrap_err(),"ROLE_PRECONDITION");
    assert_eq!(crate::wallet::fused_send::fused_send_call(g,operation,plan["proposalId"].as_str().unwrap(),plan["reviewCommitment"].as_str().unwrap(),0,&[],&[],4194304).unwrap_err(),"ROLE_PRECONDITION");
    let state:Value=serde_json::from_str(&crate::wallet::sync::sync_call(g,"scan_state","{}").unwrap()).unwrap();
    input["revision"]=state["revision"].clone();input["idempotencyKey"]=json!("new-shield");
    assert_ne!(create(g,"proposal_create",&input).unwrap()["operationId"],plan["operationId"],"released funds remain selectable for new work");
    crate::wallet::storage_close(g).unwrap();crate::wallet::signer::signer_release(token.unwrap()).unwrap();let _=path;
}

#[test]
fn view_only_account_scans_without_marks_and_cannot_propose(){
    for (mode,refusal) in [("view-only","INSUFFICIENT_FUNDS"),("view-only-shield","NOTHING_TO_SHIELD")] {
        let (_path,g,input,_)=prepared_mode(true,false,false,false,mode);
        assert_eq!(crate::wallet::proposal::proposal_call(g,"proposal_create",&input.to_string()).unwrap_err(),refusal,"{mode}");
        crate::wallet::DOMAIN.with(|domain| {
            use zcash_client_backend::data_api::WalletCommitmentTrees;
            let mut domain=domain.borrow_mut();let db=&mut domain.active.iter_mut().find(|a|a.generation==g).unwrap().wallet;
            assert!(db.with_sapling_tree_mut(|tree|tree.marked_positions()).unwrap().is_empty(),"the real scan path keeps no view-only witness: {mode}");
        });
        let balance=call(g,"account_balance",json!({"accountId":input["accountId"],"confirmations":{"trusted":1,"untrusted":1,"allowZeroConfirmationShielding":false}})).unwrap();
        for pool in [&balance["amounts"]["sapling"],&balance["amounts"]["transparent"]["regular"]] {
            assert_eq!(pool["spendable"],"0");assert_eq!(pool["locked"],"0");
        }
        assert_ne!(balance["amounts"]["sapling"]["pendingSpendability"],"0","view-only value is reported as pending, not hidden");
    }
}
