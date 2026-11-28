//! Wallet-wide scan reads and native rewind; no network scheduler or history reconstruction.
use super::accounts::{fields, height, string, Failure, Result};
use serde_json::{json, Value};
use zcash_client_backend::data_api::{WalletRead, WalletWrite, WalletCommitmentTrees, wallet::ConfirmationsPolicy};
use zcash_client_sqlite::error::SqliteClientError;

fn execute(generation: u32, operation: &str, input: &Value) -> Result<Value> {
    super::DOMAIN.with(|domain| {
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        match operation {
            "scan_complete" => {
                fields(input,&["revision","target","treeState"])?;
                let target=input.get("target").ok_or(Failure::from("INVALID_ARGUMENT"))?;
                fields(target,&["height","hash"])?;
                let target_height=height(target,"height")?;
                if target_height==u32::MAX {return Err("INVALID_ARGUMENT".into());}
                let target_hash=hex::decode(string(target,"hash")?).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                if target_hash.len()!=32 || hex::encode(&target_hash)!=string(target,"hash")? {return Err("INVALID_ARGUMENT".into());}
                let tree=hex::decode(string(input,"treeState")?).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                let p=active.wallet.params().clone();
                active.wallet.transactionally_with_extension(|db,ext| -> Result<Value> {
                    if super::revision::read(ext)?!=string(input,"revision")? {return Err("STALE_REVISION".into());}
                    let pending=ext.query_row("SELECT height,hash FROM ext_wallet_creation_snapshot WHERE id=1",[],|r|Ok((r.get::<_,Option<u32>>(0)?,r.get::<_,Option<Vec<u8>>>(1)?)))?;
                    let tip=super::creation::tip_for_target(db.chain_height()?.map(u32::from),target_height,&p)?;
                    if target_height>tip {return Err("SYNC_REQUIRED".into());}
                    let current=target_height==tip;
                    if current && pending!=(Some(target_height),Some(target_hash.clone())) {return Err("SYNC_REQUIRED".into());}
                    if db.suggest_scan_ranges()?.iter().any(|r|u32::from(r.block_range().start)<=target_height) {return Err("SYNC_REQUIRED".into());}
                    let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
                    let birthday=super::accounts::birthday(&json!({"parameters":hex::encode(&active.bytes),"genesis":hex::encode(&genesis),
                        "firstScanHeight":target_height+1,"priorTreeState":hex::encode(&tree),"source":"light-client"}),&active.bytes,&genesis,&p)?;
                    let known=db.get_block_hash(target_height.into())?;
                    if birthday.prior_chain_state().block_hash().0.as_slice()!=target_hash
                        || known.is_some_and(|h|h.0.as_slice()!=target_hash) {return Err("CHAIN_MISMATCH".into());}
                    if !current && known.is_none() {return Err("SYNC_REQUIRED".into());}
                    // Historical coverage uses its retained block identity; pruned tree checkpoints
                    // cannot prevent completing a target whose creation snapshot is not being stored.
                    if current && db.block_fully_scanned()?.is_some() {
                        let height=target_height.into();
                        let state=birthday.prior_chain_state();
                        // Empty blocks need not have upstream checkpoints. Verify the exact
                        // scanned block's tree prefixes, excluding any later tree material.
                        let metadata=db.block_metadata(height)?.ok_or(Failure::from("SYNC_REQUIRED"))?;
                        use incrementalmerkletree::Address;
                        let sapling=db.with_sapling_tree_mut(|tree|metadata.sapling_tree_size().map(|size|tree.root(Address::from_parts(sapling::NOTE_COMMITMENT_TREE_DEPTH.into(),0),u64::from(size).into())).transpose()).map_err(|_|Failure::from("SYNC_REQUIRED"))?;
                        let orchard=db.with_orchard_tree_mut(|tree|metadata.orchard_tree_size().map(|size|tree.root(Address::from_parts((orchard::NOTE_COMMITMENT_TREE_DEPTH as u8).into(),0),u64::from(size).into())).transpose()).map_err(|_|Failure::from("SYNC_REQUIRED"))?;
                        let ironwood=db.with_ironwood_tree_mut(|tree|metadata.ironwood_tree_size().map(|size|tree.root(Address::from_parts((orchard::NOTE_COMMITMENT_TREE_DEPTH as u8).into(),0),u64::from(size).into())).transpose()).map_err(|_|Failure::from("SYNC_REQUIRED"))?.flatten();
                        use zcash_protocol::consensus::{Parameters,NetworkUpgrade};
                        if [(p.is_nu_active(NetworkUpgrade::Sapling,height),sapling.map(|r|r==state.final_sapling_tree().root())),
                            (p.is_nu_active(NetworkUpgrade::Nu5,height),orchard.map(|r|r==state.final_orchard_tree().root())),
                            (p.is_nu_active(NetworkUpgrade::Nu6_3,height),ironwood.map(|r|r==state.final_ironwood_tree().root()))]
                            .into_iter().any(|(active,matches)|active&&matches!=Some(true)) {return Err("CHAIN_MISMATCH".into());}
                    }
                    if current {ext.execute("UPDATE ext_wallet_creation_snapshot SET tree=?1 WHERE id=1",[tree])?;}
                    super::revision::advance(ext)?;
                    Ok(json!({"revision":super::revision::read(ext)?}))
                })
            }
            "scan_state" => {
                fields(input,&[])?;
                active.wallet.transactionally_with_extension(|db,ext| -> Result<Value> {
                    // Scan completeness is upstream-owned and independent of per-account amount projection.
                    let summary=db.get_wallet_summary(ConfirmationsPolicy::MIN)?;
                    Ok(json!({"revision":super::revision::read(ext)?,
                        "tipHeight":db.chain_height()?.map(u32::from),
                        "fullyScannedHeight":db.block_fully_scanned()?.map(|b|u32::from(b.block_height())),
                        "maxScannedHeight":db.block_max_scanned()?.map(|b|u32::from(b.block_height())),
                        "scanComplete":summary.as_ref().map(|s|s.is_synced())}))
                })
            }
            "scan_block_hash" => {
                fields(input,&["height"])?;
                let height=height(input,"height")?;
                active.wallet.transactionally_with_extension(|db,ext| -> Result<Value> {
                    Ok(json!({"revision":super::revision::read(ext)?,
                        "point":db.get_block_hash(height.into())?.map(|hash|json!({"height":height,"hash":hex::encode(hash.0)}))}))
                })
            }
            "scan_rewind" => {
                fields(input,&["revision","requestedPoint"])?;
                let revision=string(input,"revision")?;
                if revision.len()>128 {return Err("INVALID_ARGUMENT".into());}
                let point=input.get("requestedPoint").ok_or(Failure::from("INVALID_ARGUMENT"))?;
                fields(point,&["height","hash"])?;
                let requested=height(point,"height")?;
                if requested==u32::MAX {return Err("INVALID_ARGUMENT".into());}
                let hash=string(point,"hash")?;
                let bytes=hex::decode(hash).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                if bytes.len()!=32 || hex::encode(&bytes)!=hash {return Err("INVALID_ARGUMENT".into());}
                let result=active.wallet.transactionally_with_extension(|db,ext| -> Result<Value> {
                    if super::revision::read(ext)?!=revision {return Err("STALE_REVISION".into());}
                    let known=db.get_block_hash(requested.into())?.ok_or(Failure::from("RECOVERY_REQUIRED"))?;
                    if known.0.as_slice()!=bytes {return Err("CHAIN_MISMATCH".into());}
                    let actual=db.truncate_to_height(requested.into()).map_err(|error|match error {
                        SqliteClientError::RequestedRewindInvalid {..} | SqliteClientError::TruncateCommitmentTree {..} => Failure::from("RECOVERY_REQUIRED"),
                        other=>Failure::from(other),
                    })?;
                    let hash=db.get_block_hash(actual)?.ok_or(Failure::from("RECOVERY_REQUIRED"))?;
                    ext.execute("UPDATE ext_wallet_creation_snapshot SET height=NULL,hash=NULL,tree=NULL WHERE id=1",[])?;
                    super::revision::advance(ext)?;
                    Ok(json!({"revision":super::revision::read(ext)?,"point":{"height":u32::from(actual),"hash":hex::encode(hash.0)}}))
                })?;
                active.scan_plan=None;
                active.transparent_checks.clear();
                Ok(result)
            }
            _=>Err("INVALID_ARGUMENT".into()),
        }
    })
}

pub fn sync_call(generation:u32, operation:&str, input:&str)->std::result::Result<String,String> {
    if input.len()>if operation=="scan_complete" {132096}else{1024} {return Err("RESOURCE_LIMIT".into());}
    let value=serde_json::from_str(input).map_err(|_|"INVALID_ARGUMENT".to_string())?;
    execute(generation,operation,&value).map(|v|v.to_string()).map_err(|e|e.0)
}
