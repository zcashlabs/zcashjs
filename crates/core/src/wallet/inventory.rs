//! Complete local inventory, including spent rows. This is not input selection.
use super::accounts::{fields,string,Failure,Result};
use rusqlite::params;
use serde_json::{json,Value};
use zcash_client_sqlite::ExtensionTransaction;

pub(super) fn read(ext:&ExtensionTransaction<'_>, operation:&str, input:&Value, scan:Value)->Result<Value> {
    fields(input,if operation=="wallet_notes" {&["accountId","pool","spendState","locked","uneconomic","cursor","limit"]}else{&["accountId","spendState","locked","uneconomic","cursor","limit"]})?;
    let account=string(input,"accountId")?;
    let id=uuid::Uuid::parse_str(account).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    if id.to_string()!=account{return Err("INVALID_ARGUMENT".into());}
    if !ext.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE uuid=?1)",[id.as_bytes()],|r|r.get::<_,bool>(0))? {return Err("ACCOUNT_NOT_FOUND".into());}
    let pool=match input.get("pool"){None=>None,Some(Value::String(s)) if s=="sapling"=>Some(2),Some(Value::String(s)) if s=="ironwood"=>Some(4),_=>return Err("INVALID_ARGUMENT".into())};
    let spend=match input.get("spendState"){None=>None,Some(Value::String(s)) if ["unspent","pendingSpend","spent","unknown"].contains(&s.as_str())=>Some(s.as_str()),_=>return Err("INVALID_ARGUMENT".into())};
    let boolean=|key| -> Result<Option<bool>> {match input.get(key){None=>Ok(None),Some(Value::Bool(v))=>Ok(Some(*v)),_=>Err("INVALID_ARGUMENT".into())}};
    let locked=boolean("locked")?;let uneconomic=boolean("uneconomic")?;
    let limit=input.get("limit").map_or(Ok(50),|v|v.as_u64().filter(|n|(1..=200).contains(n)).ok_or(Failure::from("INVALID_ARGUMENT")))?;
    let binding=json!({"kind":operation,"accountId":account,"pool":pool,"spendState":spend,"locked":locked,"uneconomic":uneconomic});
    let mut after=(String::new(),-1i64,-1i64);
    if let Some(cursor)=input.get("cursor") {
        let raw=hex::decode(cursor.as_str().filter(|s|s.len()<=2048).ok_or(Failure::from("INVALID_ARGUMENT"))?).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
        let c:Value=serde_json::from_slice(&raw).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
        fields(&c,&["binding","revision","key","pool","index"])?;
        if c["binding"]!=binding{return Err("INVALID_ARGUMENT".into());}
        if c["revision"]!=scan["revision"]{return Err("CURSOR_STALE".into());}
        let key=string(&c,"key")?;
        if key.len()!=64||hex::decode(key).is_err()||key.to_ascii_lowercase()!=key{return Err("INVALID_ARGUMENT".into());}
        after=(key.to_owned(),c["pool"].as_i64().filter(|p|[0,2,4].contains(p)).ok_or(Failure::from("INVALID_ARGUMENT"))?,c["index"].as_i64().filter(|i|(0..=u32::MAX as i64).contains(i)).ok_or(Failure::from("INVALID_ARGUMENT"))?);
    }
    let tip=scan["tipHeight"].as_u64();
    let next=tip.and_then(|h|h.checked_add(1)).filter(|h|*h<=u32::MAX as u64);
    let complete=scan["scanComplete"]==true&&tip.is_some()&&scan["fullyScannedHeight"].as_u64().is_some_and(|h|Some(h)>=tip);
    // Pending classification uses explicit expiry only. Unknown expiry and conflicting
    // relationships remain unknown instead of copying the backend's observation heuristic.
    let sql="WITH received AS (
      SELECT r.*,n.nf AS authority,n.lock_expiry_height AS lock_height,NULL AS address,NULL AS observed FROM v_received_outputs r JOIN sapling_received_notes n ON r.pool=2 AND n.id=r.id_within_pool_table
      UNION ALL SELECT r.*,n.nf,n.lock_expiry_height,NULL,NULL FROM v_received_outputs r JOIN ironwood_received_notes n ON r.pool=4 AND n.id=r.id_within_pool_table
      UNION ALL SELECT r.*,NULL,u.lock_expiry_height,u.address,u.max_observed_unspent_height FROM v_received_outputs r JOIN transparent_received_outputs u ON r.pool=0 AND u.id=r.id_within_pool_table
    ), classified AS (
      SELECT r.*,lower(hex(t.txid)) AS key,t.mined_height,
        (SELECT COUNT(*) FROM v_received_output_spends s JOIN transactions st ON st.id_tx=s.transaction_id WHERE s.pool=r.pool AND s.received_output_id=r.id_within_pool_table AND (st.mined_height IS NOT NULL OR st.expiry_height IS NULL OR st.expiry_height=0 OR ?2 IS NULL OR st.expiry_height>=?2)) AS active_spends,
        (SELECT COUNT(*) FROM v_received_output_spends s JOIN transactions st ON st.id_tx=s.transaction_id WHERE s.pool=r.pool AND s.received_output_id=r.id_within_pool_table AND ?7 IS NOT NULL AND st.mined_height<=?7) AS mined_spends,
        (SELECT COUNT(*) FROM v_received_output_spends s JOIN transactions st ON st.id_tx=s.transaction_id WHERE s.pool=r.pool AND s.received_output_id=r.id_within_pool_table AND st.mined_height IS NULL AND (st.expiry_height=0 OR (?2 IS NOT NULL AND st.expiry_height>=?2))) AS pending_spends,
        (SELECT lower(hex(st.txid)) FROM v_received_output_spends s JOIN transactions st ON st.id_tx=s.transaction_id WHERE s.pool=r.pool AND s.received_output_id=r.id_within_pool_table AND (st.mined_height IS NOT NULL OR st.expiry_height IS NULL OR st.expiry_height=0 OR ?2 IS NULL OR st.expiry_height>=?2) ORDER BY st.txid LIMIT 1) AS spender,
        CASE WHEN r.lock_height IS NULL THEN 0 WHEN ?2 IS NULL THEN NULL ELSE r.lock_height>=?2 END AS locked,
        r.value<=?3 AS uneconomic
      FROM received r JOIN transactions t ON t.id_tx=r.transaction_id JOIN accounts a ON a.id=r.account_id
      WHERE a.uuid=?1 AND ((?4=1 AND r.pool IN (2,4) AND (?5 IS NULL OR r.pool=?5)) OR (?4=0 AND r.pool=0))
    ), inventory AS (
      SELECT *,CASE WHEN mined_spends=1 AND active_spends=1 THEN 'spent' WHEN active_spends=1 AND pending_spends=1 THEN 'pendingSpend'
        WHEN active_spends=0 AND ?6 AND mined_height<=?7 AND ((pool!=0 AND authority IS NOT NULL) OR (pool=0 AND observed>=?7)) THEN 'unspent' ELSE 'unknown' END AS state FROM classified
    ) SELECT json_group_array(json(item)) FROM (SELECT json_array(key,pool,output_index,value,mined_height,lock_height,locked,state,CASE WHEN state IN ('spent','pendingSpend') THEN spender END,CASE WHEN length(CAST(address AS BLOB))<=4096 THEN address END,uneconomic,length(CAST(address AS BLOB))) AS item
      FROM inventory WHERE (?8 IS NULL OR state=?8) AND (?9 IS NULL OR locked=?9) AND (?10 IS NULL OR uneconomic=?10)
      AND (key>?11 OR (key=?11 AND (pool>?12 OR (pool=?12 AND output_index>?13)))) ORDER BY key,pool,output_index LIMIT ?14)";
    let text:String=ext.query_row(sql,params![id.as_bytes(),next,u64::from(zcash_primitives::transaction::fees::zip317::MARGINAL_FEE),operation=="wallet_notes",pool,complete,tip,spend,locked,uneconomic,after.0,after.1,after.2,limit+1],|r|r.get(0))?;
    let rows:Vec<Value>=serde_json::from_str(&text).map_err(|_|Failure::from("STORAGE_ERROR"))?;
    let mut items=vec![];let mut keys=vec![];
    for row in rows {
        macro_rules! get { ($i:expr,$t:ty) => {serde_json::from_value::<$t>(row[$i].clone()).map_err(|_|Failure::from("STORAGE_ERROR"))?}; }
        if row[11].as_u64().is_some_and(|n|n>4096){return Err("RESOURCE_LIMIT".into());}
        let key:String=get!(0,String);let pool:i64=get!(1,i64);let index:u32=get!(2,u32);let value:i64=get!(3,i64);
        zcash_protocol::value::Zatoshis::from_nonnegative_i64(value).map_err(|_|Failure::from("STORAGE_ERROR"))?;
        let lock:Option<bool>=get!(6,Option<i64>).map(|v|v!=0);let expiry:Option<u32>=get!(5,Option<u32>);
        let display=|key:String|->Result<String>{let mut bytes=hex::decode(key).map_err(|_|Failure::from("STORAGE_ERROR"))?;if bytes.len()!=32{return Err("STORAGE_ERROR".into());}bytes.reverse();Ok(hex::encode(bytes))};
        // No per-row coinbase evidence is exposed by these views; do not infer it
        // from transaction position. Native lock owners are not SDK operation IDs.
        let mut item=json!({"accountId":account,"txid":display(key.clone())?,"outputIndex":index,"value":value.to_string(),"minedHeight":get!(4,Option<u32>),"coinbase":null,
          "lock":if lock==Some(true){json!({"operationId":null,"expiresAtHeight":expiry})}else{Value::Null},"lockKnown":lock.is_some(),"spendState":get!(7,String),"spendingTxid":get!(8,Option<String>).map(display).transpose()?,"uneconomic":get!(10,i64)!=0,"eligibility":"unknown"});
        if operation=="wallet_notes"{item["pool"]=json!(if pool==2{"sapling"}else{"ironwood"});}else{item["address"]=json!(get!(9,Option<String>));}
        items.push(item);keys.push((key,pool,index));
    }
    let cursor=if items.len()>limit as usize {items.pop();keys.pop();let(key,pool,index)=keys.last().unwrap();json!(hex::encode(json!({"binding":binding,"revision":scan["revision"],"key":key,"pool":pool,"index":index}).to_string()))}else{Value::Null};
    let legacy=operation=="wallet_notes"&&ext.query_row("SELECT EXISTS(SELECT 1 FROM orchard_received_notes n JOIN accounts a ON a.id=n.account_id WHERE a.uuid=?1)",[id.as_bytes()],|r|r.get::<_,bool>(0))?;
    Ok(json!({"items":items,"nextCursor":cursor,"scan":scan,"unsupportedLegacyRowsOmitted":legacy}))
}
