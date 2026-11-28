//! Exact finalized transaction association, atomically committed with native wallet effects.
use super::accounts::{Failure,Result};
use rusqlite::OptionalExtension;
use prost::Message;
use zcash_protocol::consensus::BranchId;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use zcash_client_backend::data_api::WalletRead;
pub(super) const TABLE:&str="ext_wallet_finalized";
pub(super) const SQL:&str="CREATE TABLE ext_wallet_finalized(operation BLOB NOT NULL REFERENCES ext_wallet_proposals(operation) CHECK(typeof(operation)='blob' AND length(operation)=32),step INTEGER NOT NULL CHECK(step>=0 AND step<=4294967295),artifact TEXT CHECK(artifact IS NULL OR (typeof(artifact)='text' AND length(artifact)=64)),txid BLOB NOT NULL CHECK(typeof(txid)='blob' AND length(txid)=32),bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes)>0 AND length(bytes)<=4194304),digest BLOB NOT NULL CHECK(typeof(digest)='blob' AND length(digest)=32),PRIMARY KEY(operation,step))";
pub(super) fn initialize(conn:&mut rusqlite::Connection)->std::result::Result<(),String>{
    if !conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[TABLE],|r|r.get::<_,bool>(0)).map_err(|_|"STORAGE_INIT_FAILED")?{conn.execute_batch(SQL).map_err(|_|"STORAGE_INIT_FAILED")?;}Ok(())
}
fn id(text:&str)->Result<Vec<u8>>{if text.len()!=64{return Err("INVALID_ARGUMENT".into());}let bytes=hex::decode(text).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;if hex::encode(&bytes)!=text{return Err("INVALID_ARGUMENT".into());}Ok(bytes)}
type Row=(Option<String>,Vec<u8>,Vec<u8>,Vec<u8>);
pub(super) fn project(operation:&str,step:u32,row:Row,revision:String,branch:BranchId)->Result<Value>{
    let(artifact,txid,bytes,digest)=row;
    if txid.len()!=32||artifact.as_ref().is_some_and(|a|a.len()!=64)||digest!=Sha256::digest(&bytes).as_slice(){return Err("STORAGE_ERROR".into());}
    let mut reader=&bytes[..];let transaction=zcash_primitives::transaction::Transaction::read(&mut reader,branch).map_err(|_|Failure::from("STORAGE_ERROR"))?;
    if !reader.is_empty()||transaction.consensus_branch_id()!=branch||transaction.txid().as_ref()!=txid.as_slice(){return Err("STORAGE_ERROR".into());}
    Ok(json!({"operationId":operation,"stepIndex":step,"artifactId":artifact,"txid":zcash_protocol::TxId::from_bytes(txid.try_into().map_err(|_|Failure::from("STORAGE_ERROR"))?).to_string(),"bytes":hex::encode(bytes),"exactBytesSha256":hex::encode(digest),"revision":revision}))
}
pub(super) fn read_step(ext:&zcash_client_sqlite::ExtensionTransaction<'_>,parameters:&crate::Document,operation_id:&str,step:u32)->Result<Value>{
    let operation=id(operation_id)?;
    let row=ext.query_row("SELECT artifact,txid,CASE WHEN length(bytes)<=4194304 THEN bytes END,digest FROM ext_wallet_finalized WHERE operation=?1 AND step=?2",rusqlite::params![operation,step],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    if let Some(row)=row {
        let plan:Vec<u8>=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END FROM ext_wallet_proposals WHERE operation=?1",[&operation],|r|r.get(0))?;
        let plan=zcash_client_backend::proto::proposal::Proposal::decode(&plan[..]).map_err(|_|Failure::from("STORAGE_ERROR"))?;
        project(operation_id,step,row,super::revision::read(ext)?,BranchId::for_height(parameters,plan.min_target_height.into()))
    }else{Ok(Value::Null)}
}
pub(super) fn read_all(ext:&zcash_client_sqlite::ExtensionTransaction<'_>,parameters:&crate::Document,operation_id:&str)->Result<Value>{
    let operation=id(operation_id)?;
    let(count,size):(i64,i64)=ext.query_row("SELECT COUNT(*),COALESCE(SUM(length(bytes)),0) FROM ext_wallet_finalized WHERE operation=?1",[&operation],|r|Ok((r.get(0)?,r.get(1)?)))?;
    if count>16||size>4194304{return Err("RESOURCE_LIMIT".into());}
    let mut transactions=vec![];
    if count>0 {
        let plan:Vec<u8>=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END FROM ext_wallet_proposals WHERE operation=?1",[&operation],|r|r.get(0))?;
        let plan=zcash_client_backend::proto::proposal::Proposal::decode(&plan[..]).map_err(|_|Failure::from("STORAGE_ERROR"))?;
        if plan.steps.len()>16||plan.steps.len() as i64!=count{return Err("STORAGE_ERROR".into());}
        for step in 0..count as u32 {let row=read_step(ext,parameters,operation_id,step)?;if row.is_null(){return Err("STORAGE_ERROR".into());}transactions.push(row);}
    }
    Ok(json!({"operationId":operation_id,"revision":super::revision::read(ext)?,"transactions":transactions}))
}
pub fn finalized_get(generation:u32,operation_id:&str)->std::result::Result<String,String>{
    id(operation_id).map_err(|e|e.0)?;
    super::DOMAIN.with(|domain|->Result<Value>{
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some(){return Err("DOMAIN_INVALID".into());}
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        let parameters=active.wallet.params().clone();
        active.wallet.transactionally_with_extension(|_,ext|->Result<Value>{
            read_all(ext,&parameters,operation_id)
        })
    }).map(|v|v.to_string()).map_err(|e|e.0)
}
pub fn pczt_finalize_call(generation:u32,operation_id:&str,artifact_id:&str,spend:&[u8],output:&[u8],maximum:u32)->std::result::Result<String,String>{
    let operation=id(operation_id).map_err(|e|e.0)?;id(artifact_id).map_err(|e|e.0)?;
    if maximum==0||maximum>4194304{return Err("RESOURCE_LIMIT".into());}
    // Never regenerate randomized binding signatures for an already committed operation.
    let prior:Value=serde_json::from_str(&finalized_get(generation,operation_id)?).map_err(|_|"STORAGE_ERROR")?;
    if let Some(value)=prior["transactions"].as_array().and_then(|v|v.first()) {if prior["transactions"].as_array().unwrap().len()!=1||value["artifactId"]!=artifact_id{return Err("PCZT_ASSOCIATION_MISMATCH".into());}if value["bytes"].as_str().ok_or("STORAGE_ERROR")?.len()/2>maximum as usize{return Err("RESOURCE_LIMIT".into());}return Ok(value.to_string());}
    let retained=super::pczt_build::pczt_build_call(generation,"pczt_get_artifact",&json!({"operationId":operation_id,"artifactId":artifact_id}).to_string())?;
    let retained:Value=serde_json::from_str(&retained).map_err(|_|"STORAGE_ERROR")?;
    let bytes=hex::decode(retained["bytes"].as_str().ok_or("NOT_FINALIZED")?).map_err(|_|"STORAGE_ERROR")?;
    if bytes.len()>maximum as usize{return Err("RESOURCE_LIMIT".into());}
    let value=pczt::Pczt::parse(&bytes).map_err(|_|"STORAGE_ERROR")?;
    let value=super::pczt_import::combine(value.clone(),value).map_err(|e|e.0)?;
    // Locked backend unconditionally re-finalizes inputs and cannot consume scriptSig-only
    // or mixed finalized inputs. Preserve this explicit gap; never reconstruct signatures.
    let mut finalized_input=false;
    pczt::roles::verifier::Verifier::new(value.clone()).with_transparent::<(),_>(|bundle|{finalized_input=bundle.inputs().iter().any(|i|i.script_sig().is_some());Ok(())}).map_err(|_|"INVALID_PCZT")?;
    if finalized_input{return Err("METHOD_NOT_SUPPORTED".into());}
    let branch=BranchId::try_from(*value.global().consensus_branch_id()).map_err(|_|"STORAGE_ERROR")?;
    let keys=if !value.sapling().spends().is_empty()||!value.sapling().outputs().is_empty(){let(s,o)=super::pczt_prove::sapling_parameters(spend,output).map_err(|e|e.0)?;Some((s.verifying_key(),o.verifying_key()))}else{None};
    super::DOMAIN.with(|domain|->Result<Value>{
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some(){return Err("DOMAIN_INVALID".into());}
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        let parameters=active.wallet.params().clone();
        active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
            let txid=zcash_client_backend::data_api::wallet::extract_and_store_transaction_from_pczt::<_,std::convert::Infallible>(db,&parameters,value,keys.as_ref().map(|(s,o)|(s,o)),None).map_err(|_|Failure::from("ROLE_PRECONDITION"))?;
            let transaction=db.get_transaction(txid)?.ok_or(Failure::from("STORAGE_ERROR"))?;let mut bytes=vec![];transaction.write(&mut bytes).map_err(|_|Failure::from("STORAGE_ERROR"))?;
            if bytes.len()>maximum as usize{return Err("RESOURCE_LIMIT".into());}
            let digest=Sha256::digest(&bytes).to_vec();let txid_bytes=txid.as_ref().to_vec();
            ext.execute("INSERT INTO ext_wallet_finalized VALUES(?1,0,?2,?3,?4,?5)",rusqlite::params![operation,artifact_id,txid_bytes,bytes,digest])?;
            super::revision::advance(ext)?;
            project(operation_id,0,(Some(artifact_id.into()),txid_bytes,bytes,digest),super::revision::read(ext)?,branch)
        })
    }).map(|v|v.to_string()).map_err(|e|e.0)
}
