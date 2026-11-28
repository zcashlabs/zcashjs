//! Native account correspondence and deletion; no signer authority is inferred from IDs.
use super::accounts::{fields, string, Failure, Result};
use serde_json::{json, Value};
use zcash_client_backend::data_api::{Account, AccountPurpose, WalletRead, WalletWrite};
use zcash_client_sqlite::AccountUuid;
use zcash_keys::keys::UnifiedFullViewingKey;

fn execute(generation:u32,operation:&str,input:&Value)->Result<Value> {
    fields(input,match operation {"account_viewing_key"=>&["accountId"][..],"account_check_key"=>&["accountId","viewingKey"][..],"account_remove"=>&["accountId","acknowledge"],_=>return Err("INVALID_ARGUMENT".into())})?;
    let text=string(input,"accountId")?;
    let uuid=uuid::Uuid::parse_str(text).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    if uuid.to_string()!=text {return Err("INVALID_ARGUMENT".into());}
    let id=AccountUuid::from_uuid(uuid);
    super::DOMAIN.with(|domain| {
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some(){return Err("DOMAIN_INVALID".into());}
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        let p=active.wallet.params().clone();
        active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
            let account=db.get_account(id)?.ok_or(Failure::from("ACCOUNT_NOT_FOUND"))?;
            if operation=="account_viewing_key" {
                let key=account.ufvk().map(|key|key.encode(&p));
                if key.as_ref().is_some_and(|key|key.len()>4096){return Err("RESOURCE_LIMIT".into());}
                return Ok(json!(key));
            }
            if operation=="account_check_key" {
                let key=UnifiedFullViewingKey::decode(&p,string(input,"viewingKey")?).map_err(|_|Failure::from("INVALID_VIEWING_KEY"))?;
                if !account.ufvk().is_some_and(|stored|key.subsumes_ufvk(stored)){return Err("SIGNER_MISMATCH".into());}
                return Ok(json!(if account.purpose()==AccountPurpose::ViewOnly {"recovery-required"}else{"ready"}));
            }
            if string(input,"acknowledge")?!="deletes-local-history" {return Err("INVALID_ARGUMENT".into());}
            // Every retained plan is unresolved in this journal version. Later built artifacts
            // retain the same operation/account relation; deletion cannot erase their recovery.
            let pending:bool=ext.query_row("SELECT EXISTS(SELECT 1 FROM ext_wallet_proposals WHERE account=?1)",[uuid.as_bytes()],|r|r.get(0))?;
            if pending{return Err("RECOVERY_REQUIRED".into());}
            let next=db.chain_height()?.map(u32::from).and_then(|h|h.checked_add(1));
            let locked:bool=ext.query_row("SELECT EXISTS(SELECT 1 FROM (SELECT account_id,lock_expiry_height FROM sapling_received_notes UNION ALL SELECT account_id,lock_expiry_height FROM orchard_received_notes UNION ALL SELECT account_id,lock_expiry_height FROM ironwood_received_notes UNION ALL SELECT account_id,lock_expiry_height FROM transparent_received_outputs) r JOIN accounts a ON a.id=r.account_id WHERE a.uuid=?1 AND r.lock_expiry_height IS NOT NULL AND (?2 IS NULL OR r.lock_expiry_height>=?2))",rusqlite::params![uuid.as_bytes(),next],|r|r.get(0))?;
            if locked{return Err("INPUT_LOCKED".into());}
            db.delete_account(id)?;
            ext.execute("DELETE FROM ext_viewing_addresses WHERE account_uuid=?1",[uuid.as_bytes()])?;
            ext.execute("DELETE FROM ext_viewing_accounts WHERE account_uuid=?1",[uuid.as_bytes()])?;
            super::revision::advance(ext)?;
            Ok(Value::Null)
        })
    })
}
pub fn account_lifecycle_call(generation:u32,operation:&str,input:&str)->std::result::Result<String,String> {
    if input.len()>160000{return Err("INVALID_ARGUMENT".into());}
    let value=serde_json::from_str(input).map_err(|_|"INVALID_ARGUMENT".to_string())?;
    execute(generation,operation,&value).map(|v|v.to_string()).map_err(|e|e.0)
}
