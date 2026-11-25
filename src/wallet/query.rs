//! Local read projections over the upstream documented views; never input selection.
use super::accounts::{fields,string,Failure,Result};
use serde_json::{json,Value};
use rusqlite::{params,OptionalExtension};
use wasm_bindgen::prelude::*;
use zcash_client_backend::data_api::{WalletRead,wallet::ConfirmationsPolicy};
use zcash_client_sqlite::ExtensionTransaction;

// Includes spent pools even when the transaction has no change back to that pool.
const POOLS:&str="WITH account_pools AS (
 SELECT transaction_id,account_id,pool FROM v_received_outputs
 UNION SELECT transaction_id,from_account_id,output_pool FROM sent_notes
 UNION SELECT transaction_id,account_id,pool FROM v_received_output_spends
) ";
const MAX_DETAIL:usize=6*1024*1024;
const HISTORY:&str="SELECT json_object(
 'accountId',lower(hex(v.account_uuid)),'txid',lower(hex(v.txid)),
 'balanceDelta',CAST(v.account_balance_delta AS TEXT),'totalReceived',CAST(v.total_received AS TEXT),
 'totalSpent',CAST(v.total_spent AS TEXT),'fee',CAST(v.fee_paid AS TEXT),
 'minedHeight',v.mined_height,'transactionIndex',v.tx_index,'blockTime',v.block_time,
 'expiryHeight',v.expiry_height,'expiredAtMaxScannedHeight',v.expired_unmined,
 'isShielding',v.is_shielding,'poolCrossing',v.pool_crossing_value IS NOT NULL,
 'pools',(SELECT json_group_array(pool) FROM (SELECT DISTINCT ap.pool FROM account_pools ap
 JOIN accounts a ON a.id=ap.account_id JOIN transactions t ON t.id_tx=ap.transaction_id
 WHERE a.uuid=v.account_uuid AND t.txid=v.txid ORDER BY ap.pool)),
 '_height',COALESCE(v.mined_height,4294967295),'_index',COALESCE(v.tx_index,-1)) AS item FROM v_transactions v ";
fn rows(ext:&ExtensionTransaction<'_>,sql:&str,args:impl rusqlite::Params)->Result<Vec<Value>> {
    let text:String=ext.query_row(sql,args,|r|r.get(0))?;
    serde_json::from_str(&text).map_err(|_|Failure::from("STORAGE_ERROR"))
}
fn uuid(hex:&str)->Result<String> {
    uuid::Uuid::parse_str(hex).map(|u|u.to_string()).map_err(|_|Failure::from("STORAGE_ERROR"))
}
fn txid(hex:&str)->Result<String> {
    let mut bytes=hex::decode(hex).map_err(|_|Failure::from("STORAGE_ERROR"))?;
    if bytes.len()!=32{return Err("STORAGE_ERROR".into());} bytes.reverse();Ok(hex::encode(bytes))
}
fn input_txid(value:&Value)->Result<Vec<u8>> {
    let text=string(value,"txid")?;
    let mut raw=hex::decode(text).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    if raw.len()!=32||hex::encode(&raw)!=text{return Err("INVALID_ARGUMENT".into());}raw.reverse();Ok(raw)
}
fn pool(code:i64)->Result<&'static str> {
    match code {0=>Ok("transparent"),2=>Ok("sapling"),3=>Ok("legacyOrchard"),4=>Ok("ironwood"),_=>Err("UNSUPPORTED_POOL".into())}
}
fn amount(value:&Value,signed:bool)->Result<()> {
    let n=value.as_str().and_then(|s|s.parse::<i64>().ok()).ok_or(Failure::from("STORAGE_ERROR"))?;
    let valid=if signed {zcash_protocol::value::ZatBalance::from_i64(n).is_ok()}
        else {zcash_protocol::value::Zatoshis::from_nonnegative_i64(n).is_ok()};
    if !valid{return Err("STORAGE_ERROR".into());}Ok(())
}
fn history(mut value:Value)->Result<Value> {
    for key in ["balanceDelta","totalReceived","totalSpent","fee"] {if !value[key].is_null(){amount(&value[key],key=="balanceDelta")?;}}
    value["accountId"]=json!(uuid(string(&value,"accountId")?)?);
    value["txid"]=json!(txid(string(&value,"txid")?)?);
    for key in ["expiredAtMaxScannedHeight","isShielding","poolCrossing"] {
        if !value[key].is_null(){value[key]=json!(value[key].as_i64().ok_or(Failure::from("STORAGE_ERROR"))?!=0);}
    }
    let mut pools=vec![];let mut legacy=false;
    for code in value["pools"].as_array().ok_or(Failure::from("STORAGE_ERROR"))? {
        let name=pool(code.as_i64().ok_or(Failure::from("STORAGE_ERROR"))?)?;
        if name=="legacyOrchard"{legacy=true;}else{pools.push(name);}
    }
    value["pools"]=json!(pools);value["unsupportedLegacy"]=if legacy{json!("legacyOrchard")}else{Value::Null};
    value.as_object_mut().unwrap().remove("_height");value.as_object_mut().unwrap().remove("_index");
    Ok(value)
}
fn memo(value:&Value)->Result<Value> {
    use zcash_protocol::memo::{Memo,MemoBytes};
    if value.is_null(){return Ok(json!({"kind":"unknown"}));}
    let raw=hex::decode(value.as_str().ok_or(Failure::from("STORAGE_ERROR"))?).map_err(|_|Failure::from("STORAGE_ERROR"))?;
    let bytes=MemoBytes::from_bytes(&raw).map_err(|_|Failure::from("STORAGE_ERROR"))?;
    Ok(match Memo::try_from(&bytes) {
        Ok(Memo::Empty)=>json!({"kind":"empty"}),
        Ok(Memo::Text(text))=>json!({"kind":"text","text":text.to_string()}),
        _=>json!({"kind":"binary","bytes":hex::encode(bytes.as_array())}),
    })
}
fn execute(generation:u32,operation:&str,input:&Value)->Result<Value> {
    if !matches!(operation,"wallet_notes"|"wallet_utxos") { fields(input,match operation {"wallet_history"=>&["accountId","cursor","limit"],"wallet_transaction"=>&["txid"],_=>return Err("INVALID_ARGUMENT".into())})?; }
    super::DOMAIN.with(|domain| {
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
            let revision=super::revision::read(ext)?;
            let summary=db.get_wallet_summary(ConfirmationsPolicy::MIN)?;
            let scan=json!({"revision":revision,"tipHeight":db.chain_height()?.map(u32::from),
                "fullyScannedHeight":db.block_fully_scanned()?.map(|b|u32::from(b.block_height())),
                "maxScannedHeight":db.block_max_scanned()?.map(|b|u32::from(b.block_height())),
                "scanComplete":summary.as_ref().map(|s|s.is_synced())});
            if matches!(operation,"wallet_notes"|"wallet_utxos") {return super::inventory::read(ext,operation,input,scan);}
            if operation=="wallet_history" {
                let account=string(input,"accountId")?;
                let id=uuid::Uuid::parse_str(account).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                if id.to_string()!=account{return Err("INVALID_ARGUMENT".into());}
                if !ext.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE uuid=?1)",[id.as_bytes()],|r|r.get::<_,bool>(0))? {return Err("ACCOUNT_NOT_FOUND".into());}
                let limit=match input.get("limit"){None=>50,Some(v)=>v.as_u64().filter(|n|(1..=200).contains(n)).ok_or(Failure::from("INVALID_ARGUMENT"))?};
                let (mut h,mut index,mut key)=(4294967296i64,i64::MAX,String::new());
                if let Some(cursor)=input.get("cursor") {
                    let text=cursor.as_str().filter(|s|s.len()<=1024).ok_or(Failure::from("INVALID_ARGUMENT"))?;
                    let raw=hex::decode(text).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                    let c:Value=serde_json::from_slice(&raw).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                    fields(&c,&["kind","revision","accountId","height","index","key"])?;
                    if c["kind"]!="history/1"||c["accountId"]!=account{return Err("INVALID_ARGUMENT".into());}
                    if c["revision"]!=revision{return Err("CURSOR_STALE".into());}
                    h=c["height"].as_i64().filter(|h|(0..=4294967295).contains(h)).ok_or(Failure::from("INVALID_ARGUMENT"))?;
                    index=c["index"].as_i64().filter(|i|(-1..=4294967295).contains(i)).ok_or(Failure::from("INVALID_ARGUMENT"))?;
                    key=string(&c,"key")?.to_owned();
                    if key.len()!=64||hex::decode(&key).is_err()||key.to_ascii_lowercase()!=key{return Err("INVALID_ARGUMENT".into());}
                }
                let sql=format!("{POOLS} SELECT json_group_array(json(item)) FROM ({HISTORY}
                  WHERE v.account_uuid=?1 AND (COALESCE(v.mined_height,4294967295)<?2 OR (COALESCE(v.mined_height,4294967295)=?2 AND
                  (COALESCE(v.tx_index,-1)<?3 OR (COALESCE(v.tx_index,-1)=?3 AND lower(hex(v.txid))>?4))))
                  ORDER BY COALESCE(v.mined_height,4294967295) DESC,COALESCE(v.tx_index,-1) DESC,v.txid ASC LIMIT ?5)");
                let mut items=rows(ext,&sql,params![id.as_bytes(),h,index,key,limit+1])?;
                let next=if items.len()>limit as usize {
                    items.pop();let last=items.last().unwrap();
                    json!(hex::encode(json!({"kind":"history/1","revision":revision,"accountId":account,
                        "height":last["_height"],"index":last["_index"],"key":last["txid"]}).to_string()))
                }else{Value::Null};
                return Ok(json!({"items":items.into_iter().map(history).collect::<Result<Vec<_>>>()?,"nextCursor":next,"scan":scan,"historyComplete":"unknown"}));
            }
            let id=input_txid(input)?;
            let record=ext.query_row("SELECT id_tx,length(raw),CASE WHEN raw IS NULL THEN NULL WHEN length(raw)<=2097152 THEN lower(hex(raw)) END FROM transactions WHERE txid=?1",[&id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<usize>>(1)?,r.get::<_,Option<String>>(2)?))).optional()?;
            let Some((row,length,raw))=record else{return Ok(Value::Null)};
            if length.is_some_and(|n|n>2097152){return Err("RESOURCE_LIMIT".into());}
            // Bound native JSON/string and relationship allocation before aggregating rows.
            let cost:i64=ext.query_row("SELECT
              (SELECT COUNT(*)*2048 FROM v_transactions WHERE txid=?1)+
              (SELECT COALESCE(SUM(512+6*COALESCE(length(CAST(to_address AS BLOB)),0)+2*COALESCE(length(memo),0)),0) FROM v_tx_outputs WHERE transaction_id=?2)+
              (SELECT COUNT(*)*40 FROM v_received_outputs WHERE transaction_id=?2)+
              (SELECT COUNT(*)*80 FROM sent_notes WHERE transaction_id=?2)",params![&id,row],|r|r.get(0))?;
            if cost<0 || cost as usize+2*length.unwrap_or(0)>MAX_DETAIL{return Err("RESOURCE_LIMIT".into());}
            let sql=format!("{POOLS} SELECT json_group_array(json(item)) FROM ({HISTORY} WHERE v.txid=?1 ORDER BY v.account_uuid LIMIT 1025)");
            let accounts=rows(ext,&sql,[&id])?;
            if accounts.len()>1024{return Err("RESOURCE_LIMIT".into());}
            let sql="SELECT json_group_array(json(item)) FROM (SELECT json_object(
              'txid',lower(hex(o.txid)),'pool',o.output_pool,'outputIndex',o.output_index,
              'value',CAST(o.value AS TEXT),'address',o.to_address,'isChange',o.is_change,
              '_recordedChange',EXISTS(SELECT 1 FROM v_received_outputs r WHERE r.transaction_id=o.transaction_id AND r.pool=o.output_pool AND r.output_index=o.output_index AND r.pool!=0 AND r.is_change IS NOT NULL),
              'memo',CASE WHEN o.memo IS NULL THEN NULL WHEN length(o.memo)<=512 THEN lower(hex(o.memo)) ELSE 'invalid' END,
              'receivingAccountIds',(SELECT json_group_array(uuid) FROM (SELECT DISTINCT lower(hex(a.uuid)) uuid FROM accounts a JOIN (SELECT r.account_id FROM v_received_outputs r WHERE r.transaction_id=o.transaction_id AND r.pool=o.output_pool AND r.output_index=o.output_index UNION SELECT s.to_account_id FROM sent_notes s WHERE s.transaction_id=o.transaction_id AND s.output_pool=o.output_pool AND s.output_index=o.output_index) r ON a.id=r.account_id ORDER BY a.uuid)),
              'sendingAccountIds',(SELECT json_group_array(uuid) FROM (SELECT DISTINCT lower(hex(a.uuid)) uuid FROM sent_notes s JOIN accounts a ON a.id=s.from_account_id WHERE s.transaction_id=o.transaction_id AND s.output_pool=o.output_pool AND s.output_index=o.output_index ORDER BY a.uuid))) item
              FROM v_tx_outputs o WHERE o.transaction_id=?1 ORDER BY o.output_pool,o.output_index LIMIT 4097)";
            let mut outputs=rows(ext,sql,[row])?;
            if outputs.len()>4096{return Err("RESOURCE_LIMIT".into());}
            for output in &mut outputs {
                if !output["value"].is_null(){amount(&output["value"],false)?;}
                output["txid"]=json!(txid(string(output,"txid")?)?);
                output["pool"]=json!(pool(output["pool"].as_i64().ok_or(Failure::from("STORAGE_ERROR"))?)?);
                output["addressSource"]=json!(if output["address"].is_null(){"unknown"}else{"recorded"});
                output["memo"]=memo(&output["memo"])?;
                if output["_recordedChange"]!=1 {output["isChange"]=Value::Null;}
                else if !output["isChange"].is_null(){output["isChange"]=json!(output["isChange"].as_i64().ok_or(Failure::from("STORAGE_ERROR"))?!=0);}
                output["changeClassification"]=json!(if output["isChange"].is_null(){"unknown"}else{"recorded"});
                output.as_object_mut().unwrap().remove("_recordedChange");
                for field in ["receivingAccountIds","sendingAccountIds"] {
                    output[field]=json!(output[field].as_array().ok_or(Failure::from("STORAGE_ERROR"))?.iter().map(|v|uuid(v.as_str().ok_or(Failure::from("STORAGE_ERROR"))?)).collect::<Result<Vec<_>>>()?);
                }
            }
            Ok(json!({"txid":string(input,"txid")?,"raw":raw,"accounts":accounts.into_iter().map(history).collect::<Result<Vec<_>>>()?,"outputs":outputs,"scan":scan}))
        })
    })
}
#[wasm_bindgen]
pub fn query_call(generation:u32,operation:&str,input:&str)->std::result::Result<String,String> {
    if input.len()>4096{return Err("RESOURCE_LIMIT".into());}
    let value=serde_json::from_str(input).map_err(|_|"INVALID_ARGUMENT".to_string())?;
    execute(generation,operation,&value).and_then(|v|{let text=v.to_string();if text.len()>MAX_DETAIL{Err("RESOURCE_LIMIT".into())}else{Ok(text)}}).map_err(|e|e.0)
}
