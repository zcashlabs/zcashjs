//! Native transaction-data requests and atomic replies; no host-owned completion ledger.
use super::accounts::{fields,height,string,Failure,Result};
use serde_json::{json,Value};
use zcash_client_backend::data_api::{WalletRead,WalletWrite,TransactionDataRequest,TransactionStatus,
    TransactionStatusFilter,OutputStatusFilter,wallet::decrypt_and_store_transaction};
use zcash_keys::encoding::AddressCodec;
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::BranchId;
use zcash_client_backend::data_api::{TransactionsInvolvingAddress,
    enhance_pir::{EnhancePirRead,TransactionEnhancementWork},
    status::{TransactionStatusRead,TransactionStatusWork}};

// Preserve the host wire requests while the backend routes payload and status separately.
enum Request {
    Enhancement(zcash_protocol::TxId),
    GetStatus(zcash_protocol::TxId),
    TransactionsInvolvingAddress(TransactionsInvolvingAddress),
}

fn project(request:&Request,p:&crate::Document)->Result<Value> {
    Ok(match request {
        Request::Enhancement(id)=>json!({"kind":"enhancement","txid":id.to_string()}),
        Request::GetStatus(id)=>json!({"kind":"status","txid":id.to_string()}),
        Request::TransactionsInvolvingAddress(r)=>json!({"kind":"address","address":r.address().encode(p),
            "start":u32::from(r.block_range_start()),"endExclusive":r.block_range_end().map(u32::from),
            "requestAt":r.request_at().map(|t|t.duration_since(std::time::UNIX_EPOCH).ok().and_then(|d|u64::try_from(d.as_millis()).ok()).filter(|ms|*ms<=9_007_199_254_740_991).ok_or(())).transpose().map_err(|_|Failure::from("BACKEND_ERROR"))?,
            "txStatus":match r.tx_status_filter(){TransactionStatusFilter::Mined=>"mined",TransactionStatusFilter::Mempool=>"mempool",TransactionStatusFilter::All=>"all"},
            "outputStatus":match r.output_status_filter(){OutputStatusFilter::Unspent=>"unspent",OutputStatusFilter::All=>"all"}}),
    })
}
fn transaction(value:&Value,p:&crate::Document)->Result<(Transaction,Option<zcash_protocol::consensus::BlockHeight>)> {
    fields(value,&["bytes","minedHeight"])?;
    let encoded=string(value,"bytes")?;
    if encoded.is_empty()||encoded.len()>4*1024*1024{return Err("RESOURCE_LIMIT".into());}
    let raw=hex::decode(encoded).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    if hex::encode(&raw)!=encoded{return Err("INVALID_ARGUMENT".into());}
    let mined=match value.get("minedHeight") {Some(Value::Null)=>None,Some(_)=>Some(height(value,"minedHeight")?.into()),None=>return Err("INVALID_ARGUMENT".into())};
    let branches=if let Some(h)=mined {vec![BranchId::for_height(p,h)]}else{
        std::iter::once(0.into()).chain(p.heights.iter().flatten().copied()).map(|h|BranchId::for_height(p,h)).collect()
    };
    for branch in branches {
        if crate::transaction_id(&raw,u32::from(branch)).is_ok() {
            let tx=Transaction::read(&raw[..],branch).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
            return Ok((tx,mined));
        }
    }
    Err("INVALID_ARGUMENT".into())
}
fn execute(generation:u32,operation:&str,input:&Value)->Result<Value> {
    fields(input,if operation=="enhancement_requests" {&[]}else{&["revision","request","result"]})?;
    super::DOMAIN.with(|domain|{
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        let p=active.wallet.params().clone();
        let mut completed=None;
        let result=active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
            let revision=super::revision::read(ext)?;
            if operation!="enhancement_requests"&&string(input,"revision")?!=revision{return Err("STALE_REVISION".into());}
            let mut requests=Vec::new();
            for work in db.transaction_enhancement_work()? {
                match work {
                    TransactionEnhancementWork::Public(r)=>requests.push(Request::Enhancement(r.txid())),
                    TransactionEnhancementWork::Private(_)=>return Err("METHOD_NOT_SUPPORTED".into()),
                }
            }
            for work in db.transaction_status_work()? {
                match work {
                    TransactionStatusWork::Public(r)=>requests.push(Request::GetStatus(r.txid())),
                    TransactionStatusWork::Private(_)=>return Err("METHOD_NOT_SUPPORTED".into()),
                }
            }
            requests.extend(db.transaction_data_requests()?.into_iter().map(|request|match request {
                TransactionDataRequest::TransactionsInvolvingAddress(r)=>Request::TransactionsInvolvingAddress(r),
            }));
            // A new account's birthday is not a scanned block that can bind a UTXO reply.
            let unspent_ready=db.chain_height()?.map(|height|db.get_block_hash(height)).transpose()?.flatten().is_some();
            if !unspent_ready {
                requests.retain(|request|!matches!(request,Request::TransactionsInvolvingAddress(r)
                    if matches!(r.tx_status_filter(),TransactionStatusFilter::All)
                    && matches!(r.output_status_filter(),OutputStatusFilter::Unspent)&&r.block_range_end().is_none()));
            }
            let mut ordinary=std::collections::BTreeMap::new();
            // Upstream requests discover ephemeral returns and spends of known outputs,
            // not initial deposits to ordinary receivers. Poll the wallet-owned receiver
            // window once per native scan plan. Completion is owner-local: reopening,
            // replanning or rewinding must query again, including at the same height.
            if unspent_ready {
                for account in db.get_account_ids()? {
                    let mut receivers=db.get_transparent_receivers(account,true,false)?
                        .into_keys().collect::<Vec<_>>();
                    receivers.sort_by_key(|address|address.encode(&p));
                    for address in receivers {
                        let encoded=address.encode(&p);
                        let key=format!("{}:{encoded}",account.expose_uuid());
                        if active.transparent_checks.contains(&key){continue;}
                        ordinary.insert(encoded,key);
                        let TransactionDataRequest::TransactionsInvolvingAddress(request)=TransactionDataRequest::transactions_involving_address(
                            address,0.into(),None,None,
                            TransactionStatusFilter::All,OutputStatusFilter::Unspent,
                        );
                        requests.push(Request::TransactionsInvolvingAddress(request));
                        if requests.len()+active.transparent_checks.len()>1024{return Err("RESOURCE_LIMIT".into());}
                    }
                }
            }
            if requests.len()+active.transparent_checks.len()>1024{return Err("RESOURCE_LIMIT".into());}
            if operation=="enhancement_requests" {
                return Ok(json!({"revision":revision,"requests":requests.iter().map(|r|project(r,&p)).collect::<Result<Vec<_>>>()?}));
            }
            let requested=input.get("request").ok_or(Failure::from("INVALID_ARGUMENT"))?;
            let mut matching=None;
            for request in requests {if project(&request,&p)?==*requested{matching=Some(request);break;}}
            let request=matching.ok_or(Failure::from("STALE_REVISION"))?;
            let tip=db.chain_height()?;
            let result=input.get("result").ok_or(Failure::from("INVALID_ARGUMENT"))?;
            if result.get("status").is_some() {
                fields(result,&["status","height"])?;
                let status=match string(result,"status")? {
                    "notRecognized" if result.get("height").is_none()=>TransactionStatus::TxidNotRecognized,
                    "notInMainChain" if result.get("height").is_none()=>TransactionStatus::NotInMainChain,
                    "mined"=>{
                        let h=height(result,"height")?;
                        if tip.is_none_or(|t|h>u32::from(t)){return Err("CHAIN_MISMATCH".into());}
                        TransactionStatus::Mined(h.into())
                    },
                    _=>return Err("INVALID_ARGUMENT".into()),
                };
                match request {
                    Request::GetStatus(id)=>db.set_transaction_status(id,status)?,
                    Request::Enhancement(id) if !matches!(status,TransactionStatus::Mined(_))=>db.notify_transaction_enhancement_not_found(id)?,
                    _=>return Err("INVALID_ARGUMENT".into()),
                }
            }else{
                fields(result,if matches!(request,Request::TransactionsInvolvingAddress(_)){&["transactions","asOfHeight","asOfHash","complete"]}else{&["transactions"]})?;
                let transactions=result.get("transactions").and_then(Value::as_array).ok_or(Failure::from("INVALID_ARGUMENT"))?;
                let unspent=matches!(&request,Request::TransactionsInvolvingAddress(r) if matches!(r.tx_status_filter(),TransactionStatusFilter::All)&&matches!(r.output_status_filter(),OutputStatusFilter::Unspent)&&r.block_range_end().is_none());
                if transactions.len()>if unspent{1000}else{16}{return Err("RESOURCE_LIMIT".into());}
                let total=transactions.iter().try_fold(0usize,|sum,v|->Result<usize>{let scripts=if let Some(outputs)=v.get("unspentOutputs"){outputs.as_array().ok_or(Failure::from("INVALID_ARGUMENT"))?.iter().try_fold(0usize,|n,o|->Result<usize>{Ok(n+string(o,"script")?.len())})?}else{0};Ok(sum+string(v,"bytes")?.len()+scripts)})?;
                if total>4*1024*1024{return Err("RESOURCE_LIMIT".into());}
                match request {
                    Request::Enhancement(id)=>{
                        if transactions.len()!=1{return Err("INVALID_ARGUMENT".into());}
                        let (tx,mined)=transaction(&transactions[0],&p)?;
                        if mined.is_some_and(|h|tip.is_none_or(|t|h>t)){return Err("CHAIN_MISMATCH".into());}
                        if tx.txid()!=id{return Err("CHAIN_MISMATCH".into());}
                        if let Some(known)=db.get_tx_height(id)? {if Some(known)!=mined{return Err("CHAIN_MISMATCH".into());}}
                        decrypt_and_store_transaction(&p,db,&tx,mined)?;
                    },
                    Request::TransactionsInvolvingAddress(r)=>{
                        if matches!(r.tx_status_filter(),TransactionStatusFilter::All)&&matches!(r.output_status_filter(),OutputStatusFilter::Unspent)&&r.block_range_end().is_none() {
                            let as_of=height(result,"asOfHeight")?;let hash=string(result,"asOfHash")?;
                            let expected=hex::decode(hash).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                            if expected.len()!=32||hex::encode(&expected)!=hash{return Err("INVALID_ARGUMENT".into());}
                            if tip.map(u32::from)!=Some(as_of)||db.get_block_hash(as_of.into())?.is_none_or(|h|h.0.as_slice()!=expected.as_slice()){return Err("CHAIN_MISMATCH".into());}
                            let complete=result.get("complete").and_then(Value::as_bool).ok_or(Failure::from("INVALID_ARGUMENT"))?;
                            if !complete{return Err("INVALID_ARGUMENT".into());}
                            let mut count=0;let mut seen=std::collections::BTreeSet::new();
                            for item in transactions {
                                fields(item,&["txid","bytes","minedHeight","unspentOutputs"])?;
                                let(tx,mined)=transaction(&json!({"bytes":item["bytes"],"minedHeight":item["minedHeight"]}),&p)?;
                                if tx.txid().to_string()!=string(item,"txid")?{return Err("CHAIN_MISMATCH".into());}
                                if mined.is_some_and(|h|h<r.block_range_start()||u32::from(h)>as_of){return Err("CHAIN_MISMATCH".into());}
                                if let Some(known)=db.get_tx_height(tx.txid())?{if Some(known)!=mined{return Err("CHAIN_MISMATCH".into());}}
                                let outputs=item["unspentOutputs"].as_array().ok_or(Failure::from("INVALID_ARGUMENT"))?;
                                if outputs.is_empty(){return Err("INVALID_ARGUMENT".into());}count+=outputs.len();if count>1000{return Err("RESOURCE_LIMIT".into());}
                                let mut positive=vec![];
                                for output in outputs {
                                    fields(output,&["outputIndex","script","value"])?;let index=height(output,"outputIndex")?;
                                    if !seen.insert((tx.txid().to_string(),index)){return Err("INVALID_ARGUMENT".into());}
                                    let native=tx.transparent_bundle().and_then(|b|b.vout.get(index as usize)).ok_or(Failure::from("CHAIN_MISMATCH"))?;
                                    let value=string(output,"value")?;
                                    if native.value().into_u64().to_string()!=value||hex::encode(&native.script_pubkey().0.0)!=string(output,"script")?||native.recipient_address()!=Some(r.address()){return Err("CHAIN_MISMATCH".into());}
                                    let output=zcash_client_backend::wallet::WalletTransparentOutput::from_parts(zcash_transparent::bundle::OutPoint::new(*tx.txid().as_ref(),index),native.clone(),mined,None,None,None).ok_or(Failure::from("CHAIN_MISMATCH"))?;positive.push(output);
                                }
                                decrypt_and_store_transaction(&p,db,&tx,mined)?;
                                for output in positive{db.put_received_transparent_utxo(&output)?;}
                            }
                            // This is scheduling, not a claim that omitted outputs were spent or unspent.
                            if let Some(key)=ordinary.get(&r.address().encode(&p)) {
                                completed=Some(key.clone());
                            } else {
                                db.schedule_next_check(&r.address(),24*60*60)?;
                            }
                        } else {
                        // Other supported spend-search requests are mined/all with a finite range.
                        if !matches!(r.tx_status_filter(),TransactionStatusFilter::Mined)||!matches!(r.output_status_filter(),OutputStatusFilter::All){return Err("METHOD_NOT_SUPPORTED".into());}
                        let end=r.block_range_end().ok_or(Failure::from("METHOD_NOT_SUPPORTED"))?;
                        let complete=result.get("complete").and_then(Value::as_bool).ok_or(Failure::from("INVALID_ARGUMENT"))?;
                        let as_of=height(result,"asOfHeight")?;
                        if u32::from(end).checked_sub(1)!=Some(as_of)||db.chain_height()?.is_none_or(|tip|as_of>u32::from(tip)){return Err("CHAIN_MISMATCH".into());}
                        for item in transactions {
                            let (tx,mined)=transaction(item,&p)?;
                            if mined.is_none_or(|h|h<r.block_range_start()||h>=end){return Err("CHAIN_MISMATCH".into());}
                            if let Some(known)=db.get_tx_height(tx.txid())? {if Some(known)!=mined{return Err("CHAIN_MISMATCH".into());}}
                            decrypt_and_store_transaction(&p,db,&tx,mined)?;
                        }
                        if complete {db.notify_address_checked(r,as_of.into())?;}
                        }
                    },
                    _=>return Err("INVALID_ARGUMENT".into()),
                }
            }
            super::revision::advance(ext)?;
            Ok(json!({"revision":super::revision::read(ext)?}))
        })?;
        // Cache only committed replies; failed validation or commits remain pending.
        if let Some(key)=completed {active.transparent_checks.insert(key);}
        Ok(result)
    })
}
pub fn enhancement_call(generation:u32,operation:&str,input:&str)->std::result::Result<String,String> {
    if !matches!(operation,"enhancement_requests"|"enhancement_apply"){return Err("INVALID_ARGUMENT".into());}
    if input.len()>4*1024*1024+262144{return Err("RESOURCE_LIMIT".into());}
    let value=serde_json::from_str(input).map_err(|_|"INVALID_ARGUMENT".to_string())?;
    execute(generation,operation,&value).map(|v|v.to_string()).map_err(|e|e.0)
}
