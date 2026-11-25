//! Bounded persistent scanning using upstream inline or parallel cached scanning.
//! Adapted from SDK qualification/scanner/src/lib.rs at a61dccd; upstream owns
//! trial decryption, nullifiers, scan ranges, tree writes and account policy.
//! scan_plan admits a caller-observed target, mutates the native tip and returns
//! its revision. It does not verify remote consensus or establish sync completion.
//! Batches carry that exact target/revision; successful batches advance revision.
//! Reopen or unrelated mutations require replanning. Hashes use protocol byte order;
//! TreeState uses its upstream protobuf/display-order representation unchanged.
use super::accounts::{birthday, fields, height, string, Failure, Result};
use prost::Message;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use zcash_client_backend::{data_api::{WalletRead, WalletWrite}, proto::compact_formats::CompactBlock};
#[cfg(not(feature = "wallet-threaded"))]
use zcash_client_backend::scanning::{scan_block, Nullifiers, ScanningKeys};

// Hex JSON is private transport, not an additional compact-block encoding.
const MAX_BLOCK_BYTES: usize = 2 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 2 * MAX_BLOCK_BYTES + 140000;

fn execute(generation: u32, operation: &str, v: &Value) -> Result<Value> {
    super::DOMAIN.with(|domain| {
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        if !matches!(operation,"scan_plan"|"scan_ingest_batch") {return Err("INVALID_ARGUMENT".into());}
        fields(v,if operation=="scan_plan" {&["target"]} else {&["revision","target","priorTreeState","blocks"]})?;
        let target=v.get("target").ok_or(Failure::from("INVALID_ARGUMENT"))?;
        fields(target,&["height","hash"])?;
        let target_height=height(target,"height")?;
        if target_height==u32::MAX {return Err("INVALID_ARGUMENT".into());}
        let target_hash=hex::decode(string(target,"hash")?).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
        if target_hash.len()!=32 || hex::encode(&target_hash)!=string(target,"hash")? {return Err("INVALID_ARGUMENT".into());}
        if operation=="scan_plan" {
            let result=active.wallet.transactionally_with_extension(|db,ext| -> Result<Value> {
                if db.get_block_hash(target_height.into())?.is_some_and(|h|target_hash!=h.0) {return Err("CHAIN_MISMATCH".into());}
                // A finite historical target does not rewind the wallet's independently known tip.
                if db.chain_height()?.is_none_or(|h|u32::from(h)<=target_height) {db.update_chain_tip(target_height.into())?;}
                super::creation::pending(ext,target_height,&target_hash)?;
                let ranges=db.suggest_scan_ranges()?;
                if ranges.len()>1024 {return Err("RESOURCE_LIMIT".into());}
                let ranges=ranges.iter().map(|r| -> Result<Value> {
                    let start=u32::from(r.block_range().start);
                    let prior=start.checked_sub(1).ok_or(Failure::from("INVALID_ARGUMENT"))?;
                    Ok(json!({"start":start,"endExclusive":u32::from(r.block_range().end),
                        "priority":format!("{:?}",r.priority()),"priorState":{"height":prior,
                        "hash":db.get_block_hash(prior.into())?.map(|h|hex::encode(h.0))}}))
                }).collect::<Result<Vec<_>>>()?;
                super::revision::advance(ext)?;
                Ok(json!({"revision":super::revision::read(ext)?,"target":target,"ranges":ranges}))
            })?;
            active.scan_plan=Some((result["revision"].as_str().unwrap().to_owned(),target.clone()));
            active.transparent_checks.clear();
            return Ok(result);
        }
        let expected=string(v,"revision")?;
        if !active.scan_plan.as_ref().is_some_and(|(revision,point)|revision==expected && point==target) {return Err("STALE_REVISION".into());}
        let raw=v.get("blocks").and_then(Value::as_array).ok_or(Failure::from("INVALID_ARGUMENT"))?;
        if raw.is_empty() || raw.len()>16 {return Err("RESOURCE_LIMIT".into());}
        let mut bytes=0usize;
        let mut blocks=Vec::with_capacity(raw.len());
        for encoded in raw {
            let encoded=encoded.as_str().ok_or(Failure::from("INVALID_ARGUMENT"))?;
            bytes=bytes.checked_add(encoded.len()).ok_or(Failure::from("RESOURCE_LIMIT"))?;
            if bytes>2*MAX_BLOCK_BYTES {return Err("RESOURCE_LIMIT".into());}
            let raw=hex::decode(encoded).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
            let block=CompactBlock::decode(raw.as_slice()).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
            if hex::encode(raw)!=encoded || !block.header.is_empty()
                || block.height>=u64::from(u32::MAX) || block.hash.len()!=32 || block.prev_hash.len()!=32
                || block.vtx.iter().any(|t|t.txid.len()!=32) {return Err("INVALID_ARGUMENT".into());}
            blocks.push(block);
        }
        let commitments:usize=blocks.iter().flat_map(|b|&b.vtx).map(|t|t.outputs.len()+t.actions.len()+t.ironwood_actions.len()).sum();
        if commitments>4096 {return Err("RESOURCE_LIMIT".into());}
        let first=blocks[0].height as u32;
        let last=blocks.last().unwrap();
        if first==0 || last.height>u64::from(target_height)
            || (last.height==u64::from(target_height) && last.hash!=target_hash)
            || blocks.windows(2).any(|b|b[1].height!=b[0].height+1 || b[1].prev_hash!=b[0].hash) {return Err("CHAIN_MISMATCH".into());}
        let p=active.wallet.params().clone();
        let result=active.wallet.transactionally_with_extension(|db,ext| -> Result<Value> {
            if super::revision::read(ext)?!=expected {return Err("STALE_REVISION".into());}
            let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
            let prior=birthday(&json!({"parameters":hex::encode(&active.bytes),"genesis":hex::encode(&genesis),
                "firstScanHeight":first,"priorTreeState":string(v,"priorTreeState")?,"source":"light-client"}),&active.bytes,&genesis,&p)?;
            let state=prior.prior_chain_state();
            if blocks[0].prev_hash!=state.block_hash().0
                || db.get_block_hash(state.block_height())?.is_some_and(|h|h!=state.block_hash())
                || db.get_block_hash(target_height.into())?.is_some_and(|h|target_hash!=h.0) {return Err("CHAIN_MISMATCH".into());}
            super::creation::invalidate(ext)?;
            #[cfg(feature = "wallet-threaded")]
            {
                crate::wallet_threads::assert_ready();
                zcash_client_backend::data_api::chain::scan_cached_blocks(&p,&ThreadedBlocks(&blocks),db,first.into(),state,blocks.len()).map_err(|_|Failure::from("SCAN_FAILED"))?;
            }
            #[cfg(not(feature = "wallet-threaded"))]
            {
            let keys=ScanningKeys::from_account_ufvks(db.get_unified_full_viewing_keys()?);
            let mut metadata=db.block_metadata(state.block_height())?;
            let mut nullifiers=Nullifiers::unspent(db)?;
            let mut scanned=Vec::with_capacity(blocks.len());
            for block in &blocks {
                let next=scan_block(&p,block.clone(),&keys,&nullifiers,metadata.as_ref()).map_err(|_|Failure::from("SCAN_FAILED"))?;
                nullifiers.update_with(&next);
                metadata=Some(next.to_block_metadata());
                scanned.push(next);
            }
            db.put_blocks(state,scanned)?;
            }
            super::view_only::drop_marks(db,ext)?;
            super::revision::advance(ext)?;
            Ok(json!({"revision":super::revision::read(ext)?,"start":first,"endExclusive":last.height+1,"blocks":blocks.len()}))
        })?;
        active.scan_plan=Some((result["revision"].as_str().unwrap().to_owned(),target.clone()));
        Ok(result)
    })
}

#[wasm_bindgen]
pub fn scan_call(generation:u32, operation:&str, input:&str)->std::result::Result<String,String> {
    if input.len()>MAX_INPUT_BYTES {return Err("RESOURCE_LIMIT".into());}
    let value=serde_json::from_str(input).map_err(|_|"INVALID_ARGUMENT".to_string())?;
    execute(generation,operation,&value).map(|v|v.to_string()).map_err(|e|e.0)
}

#[cfg(feature = "wallet-threaded")]
struct ThreadedBlocks<'a>(&'a [CompactBlock]);
#[cfg(feature = "wallet-threaded")]
impl zcash_client_backend::data_api::chain::BlockSource for ThreadedBlocks<'_> {
    type Error = std::convert::Infallible;
    fn with_blocks<F,E>(&self, from:Option<zcash_protocol::consensus::BlockHeight>, limit:Option<usize>, mut visit:F)
        -> std::result::Result<(),zcash_client_backend::data_api::chain::error::Error<E,Self::Error>>
        where F:FnMut(CompactBlock)->std::result::Result<(),zcash_client_backend::data_api::chain::error::Error<E,Self::Error>> {
        for block in self.0.iter().filter(|b|from.is_none_or(|h|b.height>=u64::from(u32::from(h)))).take(limit.unwrap_or(self.0.len())) { visit(block.clone())?; }
        Ok(())
    }
}
