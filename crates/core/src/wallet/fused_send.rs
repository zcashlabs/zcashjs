//! Execute an exact retained plan with worker-owned authority; never select or retry a spend.
use super::accounts::{Failure,Result};
use prost::Message;
use rusqlite::OptionalExtension;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use zcash_client_backend::{data_api::{Account,WalletRead,wallet::{create_proposed_transactions,SpendingKeys}},proto::proposal as wire,wallet::OvkPolicy};

pub fn fused_send_call(generation:u32,operation_id:&str,proposal_id:&str,review_commitment:&str,token:u32,spend:&[u8],output:&[u8],maximum:u32)->std::result::Result<String,String>{
    for id in [operation_id,proposal_id,review_commitment] {if id.len()!=64||!id.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("INVALID_ARGUMENT".into());}}
    if maximum==0||maximum>4194304{return Err("RESOURCE_LIMIT".into());}
    let operation=hex::decode(operation_id).map_err(|_|"INVALID_ARGUMENT")?;
    super::DOMAIN.with(|domain|->Result<Value>{
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some(){return Err("DOMAIN_INVALID".into());}
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        let p=active.wallet.params().clone();let parameters=active.bytes.clone();
        active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
            super::payment::require_active(ext,&operation)?;
            let (encoded,policy,account,revision)=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END,CASE WHEN length(policy)<=16384 THEN policy END,account,revision FROM ext_wallet_proposals WHERE operation=?1",[&operation],|r|Ok((r.get::<_,Vec<u8>>(0)?,r.get::<_,String>(1)?,r.get::<_,uuid::Uuid>(2)?,r.get::<_,String>(3)?))).optional()?.ok_or(Failure::from("OPERATION_NOT_FOUND"))?;
            let wire=wire::Proposal::decode(&encoded[..]).map_err(|_|Failure::from("STORAGE_ERROR"))?;
            if wire.steps.is_empty()||wire.steps.len()>16{return Err("RESOURCE_LIMIT".into());}
            let policy:Value=serde_json::from_str(&policy).map_err(|_|Failure::from("STORAGE_ERROR"))?;
            let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
            let review=super::proposal::bind_review(super::proposal::review(&wire,&p,&account.to_string(),operation_id,&policy,&revision)?,&encoded,&parameters,&genesis,&policy);
            if review["proposalId"]!=proposal_id||review["reviewCommitment"]!=review_commitment{return Err("PCZT_ASSOCIATION_MISMATCH".into());}
            let branch=zcash_protocol::consensus::BranchId::for_height(&p,wire.min_target_height.into());
            let (count,size):(i64,i64)=ext.query_row("SELECT COUNT(*),COALESCE(SUM(length(bytes)),0) FROM ext_wallet_finalized WHERE operation=?1",[&operation],|r|Ok((r.get(0)?,r.get(1)?)))?;
            if count!=0 {
                if count!=wire.steps.len() as i64{return Err("STORAGE_ERROR".into());}
                if size>i64::from(maximum){return Err("RESOURCE_LIMIT".into());}
                return super::pczt_finalize::read_all(ext,&p,operation_id);
            }
            if super::revision::read(ext)?!=revision||db.chain_height()?.map(u32::from).and_then(|h|h.checked_add(1))!=Some(wire.min_target_height){return Err("STALE_PROPOSAL".into());}
            let account_id=zcash_client_sqlite::AccountUuid::from_uuid(account);
            super::signer::with_spending_key(token,|key,key_parameters,key_genesis| {
                if parameters!=key_parameters||genesis!=key_genesis{return Err("NETWORK_MISMATCH".into());}
                let stored=db.get_account(account_id)?.ok_or(Failure::from("ACCOUNT_NOT_FOUND"))?;
                let ufvk=key.to_unified_full_viewing_key();
                if !stored.ufvk().is_some_and(|stored|ufvk.subsumes_ufvk(stored)){return Err("SIGNER_MISMATCH".into());}
                // The upstream fused builder resolves the account from this same authority.
                if db.get_account_for_ufvk(&ufvk)?.is_none_or(|a|a.id()!=account_id){return Err("ACCOUNT_KEY_MISMATCH".into());}
                let plan=wire.try_into_standard_proposal(&p,db).map_err(|_|Failure::from("STALE_PROPOSAL"))?;
                let expiry=review["expiryHeight"].as_u64().ok_or(Failure::from("STORAGE_ERROR"))? as u32;
                let (spend,output)=super::pczt_prove::sapling_parameters(spend,output)?;
                let keys=SpendingKeys::from_unified_spending_key(key.clone());
                let ids=create_proposed_transactions::<_,_,std::convert::Infallible,_,std::convert::Infallible,_>(db,&p,&spend,&output,&keys,OvkPolicy::Sender,&plan,Some(expiry.into())).map_err(|_|Failure::from("ROLE_PRECONDITION"))?;
                let mut transactions=vec![];let mut size=0usize;
                for (step,txid) in ids.iter().enumerate(){
                    let tx=db.get_transaction(*txid)?.ok_or(Failure::from("STORAGE_ERROR"))?;let mut bytes=vec![];tx.write(&mut bytes).map_err(|_|Failure::from("STORAGE_ERROR"))?;
                    size=size.checked_add(bytes.len()).ok_or(Failure::from("RESOURCE_LIMIT"))?;if size>maximum as usize{return Err("RESOURCE_LIMIT".into());}
                    let digest=Sha256::digest(&bytes).to_vec();let txid=txid.as_ref().to_vec();
                    ext.execute("INSERT INTO ext_wallet_finalized VALUES(?1,?2,NULL,?3,?4,?5)",rusqlite::params![operation,step as u32,txid,bytes,digest])?;
                    transactions.push((step as u32,(None,txid,bytes,digest)));
                }
                super::revision::advance(ext)?;let revision=super::revision::read(ext)?;
                let transactions=transactions.into_iter().map(|(step,row)|super::pczt_finalize::project(operation_id,step,row,revision.clone(),branch)).collect::<Result<Vec<_>>>()?;
                Ok(json!({"operationId":operation_id,"revision":revision,"transactions":transactions}))
            })
        })
    }).map(|v|v.to_string()).map_err(|e|e.0)
}
