//! Retained native proposals and their native input locks, before construction/signing.
//! Effective policy and shielding defaults are supplied by the host; selection stays native.
use super::accounts::{fields, height, string, Failure, Result};
use prost::Message;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use zcash_client_backend::{data_api::{WalletRead, locking::{LockOwner, LockRequest},
    wallet::{propose_transfer, propose_shielding, ConfirmationsPolicy, input_selection::{GreedyInputSelector, SpendPolicy, TransparentSpendPolicy}}},
    fees::{StandardFeeRule, DustOutputPolicy, standard::SingleOutputChangeStrategy}, proto::proposal as wire};
use zcash_protocol::{ShieldedPool, consensus::BranchId, value::Zatoshis};

pub(super) const TABLE: &str = "ext_wallet_proposals";
pub(super) const SQL: &str = "CREATE TABLE ext_wallet_proposals(sequence INTEGER PRIMARY KEY CHECK(sequence>0),operation BLOB NOT NULL UNIQUE CHECK(typeof(operation)='blob' AND length(operation)=32),account BLOB NOT NULL CHECK(typeof(account)='blob' AND length(account)=16),plan BLOB NOT NULL CHECK(typeof(plan)='blob' AND length(plan)>0 AND length(plan)<=2097152),policy TEXT NOT NULL CHECK(typeof(policy)='text' AND length(policy)<=16384),revision TEXT NOT NULL CHECK(typeof(revision)='text' AND length(revision)<=64))";

pub(super) const INTENTS: &str = "ext_wallet_proposal_intents";
pub(super) const INTENTS_SQL: &str = "CREATE TABLE ext_wallet_proposal_intents(key TEXT PRIMARY KEY NOT NULL CHECK(length(key)=64),intent TEXT NOT NULL CHECK(length(intent)=64),operation BLOB NOT NULL UNIQUE REFERENCES ext_wallet_proposals(operation) CHECK(typeof(operation)='blob' AND length(operation)=32))";

pub(super) fn initialize(conn: &mut Connection) -> std::result::Result<(),String> {
    let exists=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[TABLE],|r|r.get::<_,bool>(0)).map_err(|_|"STORAGE_INIT_FAILED")?;
    if !exists { conn.execute_batch(SQL).map_err(|_|"STORAGE_INIT_FAILED")?; }
    let exists=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[INTENTS],|r|r.get::<_,bool>(0)).map_err(|_|"STORAGE_INIT_FAILED")?;
    if !exists { conn.execute_batch(INTENTS_SQL).map_err(|_|"STORAGE_INIT_FAILED")?; }
    Ok(())
}
// Each component has an explicit little-endian length; domains version both bindings.
pub(super) fn digest(domain:&[u8],parts:&[&[u8]])->String {
    use sha2::{Digest,Sha256};
    let mut hash=Sha256::new();
    for part in std::iter::once(domain).chain(parts.iter().copied()) {
        hash.update((part.len() as u64).to_le_bytes());hash.update(part);
    }
    hex::encode(hash.finalize())
}
pub(super) fn bind_review(mut review:Value,encoded:&[u8],parameters:&[u8],genesis:&[u8],policy:&Value)->Value {
    let proposal=digest(b"zakura-wallet-proposal/1",&[review["operationId"].as_str().unwrap().as_bytes(),encoded]);
    // Fixed-order arrays avoid depending on request object key order. All values
    // are validated native projection/policy fields, not caller review data.
    let policy=json!([policy["spendPools"],policy["transparent"],policy["changePool"],policy["feeRule"],
        policy["confirmations"]["trusted"],policy["confirmations"]["untrusted"],policy["confirmations"]["allowZeroConfirmationShielding"],
        policy["expiry"]["kind"],policy["expiry"]["blocks"],policy["lockExpiryBlocks"]]).to_string();
    let commitment=digest(b"zakura-wallet-review/1",&[proposal.as_bytes(),parameters,genesis,
        review["accountId"].as_str().unwrap().as_bytes(),review["revision"].as_str().unwrap().as_bytes(),policy.as_bytes()]);
    // The exact stored protobuf plus policy/context binds every projected effect,
    // including native input references and unresolved internal-output constraints.
    review["proposalId"]=json!(proposal);review["reviewCommitment"]=json!(commitment);review
}
fn pool(value:&str)->Result<ShieldedPool> {
    match value {"sapling"=>Ok(ShieldedPool::Sapling),"ironwood"=>Ok(ShieldedPool::Ironwood),_=>Err("INVALID_ARGUMENT".into())}
}
fn money(value:&Value,name:&str)->Result<Zatoshis> {
    let text=string(value,name)?;
    let n=text.parse::<u64>().map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    if n.to_string()!=text{return Err("INVALID_ARGUMENT".into());}
    Zatoshis::from_u64(n).map_err(|_|"INVALID_ARGUMENT".into())
}
fn pool_name(pool:i32)->Result<&'static str> {match pool {1=>Ok("transparent"),2=>Ok("sapling"),4=>Ok("ironwood"),_=>Err("UNSUPPORTED_POOL".into())}}
pub(super) fn review(plan:&wire::Proposal,p:&crate::Document,account:&str,id:&str,policy:&Value,revision:&str)->Result<Value> {
    let target=plan.min_target_height;
    let expiry=policy.get("expiry").ok_or(Failure::from("INVALID_ARGUMENT"))?;
    fields(expiry,&["kind","blocks"])?;
    let expiry_height=match string(expiry,"kind")? {"disabled" if expiry.get("blocks").is_none()=>0,"offset"=>target.checked_add(height(expiry,"blocks")?).ok_or(Failure::from("INVALID_ARGUMENT"))?,_=>return Err("INVALID_ARGUMENT".into())};
    let lock_expiry=target.checked_add(height(policy,"lockExpiryBlocks")?).ok_or(Failure::from("INVALID_ARGUMENT"))?;
    let total=plan.steps.iter().try_fold(0u64,|sum,step|sum.checked_add(step.balance.as_ref()?.fee_required)).ok_or(Failure::from("BACKEND_ERROR"))?;
    Ok(json!({"operationId":id,"accountId":account,"revision":revision,"targetHeight":target,"branchId":u32::from(BranchId::for_height(p,target.into())),"expiryHeight":expiry_height,"lockExpiryHeight":lock_expiry,"totalFee":total.to_string(),"steps":project(plan,account,expiry_height)?}))
}
#[allow(deprecated)]
fn project(plan:&wire::Proposal,account:&str,expiry:u32)->Result<Vec<Value>> {
    let mut result:Vec<Value>=Vec::new();
    let mut payment_indices=Vec::new();
    for (index,step) in plan.steps.iter().enumerate() {
        let request=zcash_client_backend::zip321::TransactionRequest::from_uri(&step.transaction_request).map_err(|_|Failure::from("BACKEND_ERROR"))?;
        let mut outputs=Vec::new();let mut indices=Vec::new();
        for (&payment_index,payment) in request.payments() {
            let pool=step.payment_output_pools.iter().find(|v|v.payment_index as usize==payment_index).ok_or(Failure::from("BACKEND_ERROR"))?;
            outputs.push(json!({"kind":"payment","accountId":null,"pool":pool_name(pool.value_pool)?,"address":payment.recipient_address().encode(),"amount":u64::from(payment.amount().ok_or(Failure::from("BACKEND_ERROR"))?).to_string(),"memo":payment.memo().map(|m|hex::encode(m.as_array())),"label":payment.label(),"message":payment.message()}));
            indices.push(payment_index);
        }
        let balance=step.balance.as_ref().ok_or(Failure::from("BACKEND_ERROR"))?;
        for change in &balance.proposed_change {
            outputs.push(json!({"kind":if change.is_ephemeral{"step-funding"}else{"change"},"accountId":account,"pool":pool_name(change.value_pool)?,"address":null,"amount":change.value.to_string(),"memo":change.memo.as_ref().map(|m|hex::encode(&m.value))}));
        }
        if outputs.len()>256||step.inputs.len()>256{return Err("RESOURCE_LIMIT".into());}
        let mut inputs=Vec::new();let mut dependencies=std::collections::BTreeSet::new();
        for input in &step.inputs {
            use wire::proposed_input::Value::*;
            let (source,pool,value)=match input.value.as_ref().ok_or(Failure::from("BACKEND_ERROR"))? {
                ReceivedOutput(r)=>{let mut hash=r.txid.clone();if hash.len()!=32{return Err("BACKEND_ERROR".into());}hash.reverse();
                    (json!({"kind":"output","txid":hex::encode(hash),"outputIndex":r.index}),pool_name(r.value_pool)?,r.value.to_string())},
                other=>{
                    let (prior,output)=match other {
                        PriorStepOutput(r)=>{let indices:&Vec<usize>=payment_indices.get(r.step_index as usize).ok_or(Failure::from("BACKEND_ERROR"))?;(r.step_index,indices.iter().position(|i|*i==r.payment_index as usize).ok_or(Failure::from("BACKEND_ERROR"))?)},
                        PriorStepChange(r)=>(r.step_index,payment_indices.get(r.step_index as usize).ok_or(Failure::from("BACKEND_ERROR"))?.len()+r.change_index as usize),
                        _=>unreachable!(),
                    };
                    let prior_output:&Value=&result.get(prior as usize).ok_or(Failure::from("BACKEND_ERROR"))?["outputs"][output];
                    let pool=match prior_output["pool"].as_str(){Some("transparent")=>"transparent",Some("sapling")=>"sapling",Some("ironwood")=>"ironwood",_=>return Err("BACKEND_ERROR".into())};
                    let value=prior_output["amount"].as_str().ok_or(Failure::from("BACKEND_ERROR"))?.to_string();
                    dependencies.insert(prior);
                    (json!({"kind":"prior-step","stepIndex":prior,"outputIndex":output}),pool,value)
                },
            };
            inputs.push(json!({"accountId":account,"source":source,"pool":pool,"value":value}));
        }
        // The native protobuf stores the complete header, including the overwintered bit.
        result.push(json!({"index":index,"dependsOn":dependencies,"transactionVersion":plan.proposed_version.ok_or(Failure::from("BACKEND_ERROR"))? & 0x7fff_ffff,"expiryHeight":expiry,"inputs":inputs,"outputs":outputs,"fee":balance.fee_required.to_string()}));
        payment_indices.push(indices);
    }
    Ok(result)
}
// ZIP-321 is ABNF, whose literals are case-insensitive (`ZCASH:`, `AMOUNT=`, `REQ-x=`);
// the pinned parser matches only lower case. Other parameter names, addresses and values keep their case.
fn lowercase_literals(uri:&str)->String {
    let Some((scheme,rest))=uri.get(..6).zip(uri.get(6..)) else {return uri.into()};
    let (address,query)=rest.split_once('?').map_or((rest,None),|(a,q)|(a,Some(q)));
    let name=|n:&str|{let lower=n.to_ascii_lowercase();
        if lower.starts_with("req-")||["address","amount","memo","label","message"].contains(&lower.split('.').next().unwrap_or_default()){lower}else{n.into()}};
    let query=query.map_or(String::new(),|q|format!("?{}",q.split('&').map(|p|p.split_once('=')
        .map_or(name(p),|(n,v)|format!("{}={v}",name(n)))).collect::<Vec<_>>().join("&")));
    format!("{}{address}{query}",scheme.to_ascii_lowercase())
}
/// A ZIP-321 request whose payments are all for this network; amounts may be absent.
#[allow(deprecated)]
fn payment_request(uri:&str,p:&crate::Document)->Result<zcash_client_backend::zip321::TransactionRequest> {
    if uri.len()>8192{return Err("RESOURCE_LIMIT".into());}
    let request=zcash_client_backend::zip321::TransactionRequest::from_uri(&lowercase_literals(uri)).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    if request.payments().is_empty()||request.payments().len()>16{return Err("RESOURCE_LIMIT".into());}
    for payment in request.payments().values() {
        zcash_keys::address::Address::try_from_zcash_address(p,payment.recipient_address().clone()).map_err(|_|Failure::from("NETWORK_MISMATCH"))?;
        if payment.amount()==Some(Zatoshis::ZERO){return Err("INVALID_ARGUMENT".into());}
    }
    Ok(request)
}
#[allow(deprecated)] // Reuse the pinned backend's ZIP321 types; no second request codec.
fn payments(input:&Value,p:&crate::Document)->Result<zcash_client_backend::zip321::TransactionRequest> {
    use zcash_client_backend::zip321::{Payment,TransactionRequest};
    // ZIP-321 payment request URI; `amounts` fills in, by payment index, exactly the payments without one.
    if let Some(Value::String(uri))=input.get("payments") {
        let request=payment_request(uri,p)?;
        let empty=serde_json::Map::new();
        let amounts=match input.get("amounts") {None=>&empty,Some(Value::Object(m))=>m,_=>return Err("INVALID_ARGUMENT".into())};
        if amounts.len()!=request.payments().values().filter(|p|p.amount().is_none()).count(){return Err("INVALID_ARGUMENT".into());}
        let mut filled=std::collections::BTreeMap::new();
        for (&index,payment) in request.payments() {
            let amount=match payment.amount() {Some(amount)=>amount,None=>money(&input["amounts"],&index.to_string())?};
            if amount==Zatoshis::ZERO{return Err("INVALID_ARGUMENT".into());}
            filled.insert(index,Payment::new(payment.recipient_address().clone(),Some(amount),payment.memo().cloned(),payment.label().cloned(),
                payment.message().cloned(),payment.other_params().to_vec()).map_err(|_|Failure::from("INVALID_ARGUMENT"))?);
        }
        return TransactionRequest::from_indexed(filled).map_err(|_|"INVALID_ARGUMENT".into());
    }
    if input.get("amounts").is_some(){return Err("INVALID_ARGUMENT".into());}
    let list=input.get("payments").and_then(Value::as_array).ok_or(Failure::from("INVALID_ARGUMENT"))?;
    if list.is_empty()||list.len()>16{return Err("RESOURCE_LIMIT".into());}
    let mut payments=Vec::new();
    for v in list {
        fields(v,&["to","amount","memo"])?;
        let address=string(v,"to")?;
        if address.len()>2048{return Err("RESOURCE_LIMIT".into());}
        let parsed=zcash_address::ZcashAddress::try_from_encoded(address).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
        zcash_keys::address::Address::try_from_zcash_address(p,parsed.clone()).map_err(|_|Failure::from("NETWORK_MISMATCH"))?;
        let amount=money(v,"amount")?;
        if amount==Zatoshis::ZERO{return Err("INVALID_ARGUMENT".into());}
        let memo=match v.get("memo") {None|Some(Value::Null)=>None,Some(Value::String(s))=>{
            if s.len()>1024{return Err("RESOURCE_LIMIT".into());}
            let bytes=hex::decode(s).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
            if hex::encode(&bytes)!=*s{return Err("INVALID_ARGUMENT".into());}
            Some(zcash_protocol::memo::MemoBytes::from_bytes(&bytes).map_err(|_|Failure::from("INVALID_ARGUMENT"))?)
        },_=>return Err("INVALID_ARGUMENT".into())};
        payments.push(Payment::new(parsed,Some(amount),memo,None,None,vec![]).map_err(|_|Failure::from("INVALID_ARGUMENT"))?);
    }
    TransactionRequest::new(payments).map_err(|_|"INVALID_ARGUMENT".into())
}

fn execute(generation:u32,operation:&str,input:&Value)->Result<Value> {
    fields(input,match operation {"proposal_create"|"proposal_lookup_intent"=>&["revision","accountId","payments","amounts","policy","maxFee","kind","threshold","fromAddresses","idempotencyKey"][..],"proposal_get"=>&["operationId"],"proposal_list"=>&["afterSequence","highWater","limit"],"payment_request_parse"=>&["uri"],_=>return Err("INVALID_ARGUMENT".into())})?;
    super::DOMAIN.with(|domain|{
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some(){return Err("STORAGE_ERROR".into());}
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        let p=active.wallet.params().clone();
        if operation=="payment_request_parse" {
            let request=payment_request(string(input,"uri")?,&p)?;
            return Ok(json!({"payments":request.payments().iter().map(|(index,payment)|json!({"index":index.to_string(),"address":payment.recipient_address().encode(),
                "amount":payment.amount().map(|a|u64::from(a).to_string()),"memo":payment.memo().map(|m|hex::encode(m.as_array())),
                "label":payment.label(),"message":payment.message()})).collect::<Vec<_>>()}));
        }
        let parameters=active.bytes.clone();
        active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
            if operation=="proposal_list" {
                let sequence=|name:&str|->Result<i64>{let s=string(input,name)?;let n=s.parse::<i64>().map_err(|_|Failure::from("INVALID_ARGUMENT"))?;if n<0||n.to_string()!=s{return Err("INVALID_ARGUMENT".into());}Ok(n)};
                let after=sequence("afterSequence")?;
                let high=if input.get("highWater").is_none(){ext.query_row("SELECT COALESCE(MAX(sequence),0) FROM ext_wallet_proposals",[],|r|r.get::<_,i64>(0))?}else{sequence("highWater")?};
                let limit=height(input,"limit")?;
                if limit==0||limit>200||after>high{return Err("INVALID_ARGUMENT".into());}
                let rows:String=ext.query_row("SELECT json_group_array(json_object('sequence',CAST(sequence AS TEXT),'operationId',lower(hex(operation)))) FROM (SELECT sequence,operation FROM ext_wallet_proposals WHERE sequence>?1 AND sequence<=?2 ORDER BY sequence LIMIT ?3)",rusqlite::params![after,high,limit],|r|r.get(0))?;
                return Ok(json!({"highWater":high.to_string(),"items":serde_json::from_str::<Value>(&rows).map_err(|_|Failure::from("STORAGE_ERROR"))?}));
            }
            if operation=="proposal_get" {
                let id=string(input,"operationId")?;
                let bytes=hex::decode(id).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
                if bytes.len()!=32||hex::encode(&bytes)!=id{return Err("INVALID_ARGUMENT".into());}
                super::payment::require_active(ext,&bytes)?;
                let row=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END,CASE WHEN length(policy)<=16384 THEN policy END,account,revision FROM ext_wallet_proposals WHERE operation=?1",[bytes],|r|Ok((r.get::<_,Vec<u8>>(0)?,r.get::<_,String>(1)?,r.get::<_,uuid::Uuid>(2)?,r.get::<_,String>(3)?))).optional()?;
                return match row {None=>Ok(Value::Null),Some((plan,policy,account,revision))=>{
                    let encoded=plan;
                    let plan=wire::Proposal::decode(&encoded[..]).map_err(|_|Failure::from("STORAGE_ERROR"))?;
                    plan.try_into_standard_proposal(&p,db).map_err(|_|Failure::from("STALE_PROPOSAL"))?;
                    let policy=serde_json::from_str(&policy).map_err(|_|Failure::from("STORAGE_ERROR"))?;
                    let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
                    Ok(bind_review(review(&plan,&p,&account.to_string(),id,&policy,&revision)?,&encoded,&parameters,&genesis,&policy))
                }};
            }
            let account_text=string(input,"accountId")?;
            let uuid=uuid::Uuid::parse_str(account_text).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
            if uuid.to_string()!=account_text{return Err("INVALID_ARGUMENT".into());}
            let account=zcash_client_sqlite::AccountUuid::from_uuid(uuid);
            if db.get_account(account)?.is_none(){return Err("ACCOUNT_NOT_FOUND".into());}
            let policy=input.get("policy").ok_or(Failure::from("INVALID_ARGUMENT"))?;
            fields(policy,&["spendPools","transparent","changePool","feeRule","confirmations","expiry","lockExpiryBlocks"])?;
            if string(policy,"feeRule")?!="zip317-standard"{return Err("INVALID_ARGUMENT".into());}
            let pools=policy.get("spendPools").and_then(Value::as_array).ok_or(Failure::from("INVALID_ARGUMENT"))?;
            if pools.is_empty()||pools.len()>3{return Err("INVALID_ARGUMENT".into());}
            let mut shielded=std::collections::BTreeSet::new();let mut transparent=false;
            for v in pools {let s=v.as_str().ok_or(Failure::from("INVALID_ARGUMENT"))?;
                if s=="transparent" {if transparent{return Err("INVALID_ARGUMENT".into());}transparent=true;}
                else if !shielded.insert(pool(s)?) {return Err("INVALID_ARGUMENT".into());}
            }
            let mut spend=SpendPolicy::shielded_pools(shielded);
            match string(policy,"transparent")? {"allow-owned" if transparent=>spend=spend.with_transparent(TransparentSpendPolicy::any_account_addr()),"allow-owned"|"disallow"=>{},_=>return Err("INVALID_ARGUMENT".into())};
            let change_pool=pool(string(policy,"changePool")?)?;
            let c=policy.get("confirmations").ok_or(Failure::from("INVALID_ARGUMENT"))?;
            fields(c,&["trusted","untrusted","allowZeroConfirmationShielding"])?;
            let confirmations=ConfirmationsPolicy::new(height(c,"trusted")?.try_into().map_err(|_|Failure::from("INVALID_ARGUMENT"))?,height(c,"untrusted")?.try_into().map_err(|_|Failure::from("INVALID_ARGUMENT"))?,c.get("allowZeroConfirmationShielding").and_then(Value::as_bool).ok_or(Failure::from("INVALID_ARGUMENT"))?).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
            let shielding=match input.get("kind") {None=>false,Some(Value::String(s)) if s=="shield"=>true,_=>return Err("INVALID_ARGUMENT".into())};
            if shielding&&(!transparent||string(policy,"transparent")?!="allow-owned"){return Err("UNSUPPORTED_POOL".into());}
            let request=if shielding {if input.get("payments").is_some()||input.get("amounts").is_some(){return Err("INVALID_ARGUMENT".into());}None}else{
                if input.get("threshold").is_some()||input.get("fromAddresses").is_some(){return Err("INVALID_ARGUMENT".into());}Some(payments(input,&p)?)};
            let threshold=if shielding {money(input,"threshold")?}else{Zatoshis::ZERO};
            let mut sources=std::collections::BTreeMap::new();
            if let Some(value)=input.get("fromAddresses") {
                let list=value.as_array().ok_or(Failure::from("INVALID_ARGUMENT"))?;
                if list.len()>256{return Err("RESOURCE_LIMIT".into());}
                for value in list {
                    let address=value.as_str().ok_or(Failure::from("INVALID_ARGUMENT"))?;
                    if address.len()>2048{return Err("RESOURCE_LIMIT".into());}
                    let Some(zcash_keys::address::Address::Transparent(t))=zcash_keys::address::Address::decode(&p,address) else{return Err("INVALID_ARGUMENT".into());};
                    sources.insert(zcash_keys::address::Address::Transparent(t).encode(&p),t);
                }
            }
            let max_fee=input.get("maxFee").map(|_|money(input,"maxFee")).transpose()?;
            // Canonical intent describes requested work, never current inputs, target,
            // revision or the random lock owner. Omitted sources stay an all-owned selector.
            let mut canonical_policy=policy.clone();
            canonical_policy["spendPools"].as_array_mut().unwrap().sort_by(|a,b|a.as_str().cmp(&b.as_str()));
            let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
            let intent=json!([account_text,if shielding{"shield"}else{"transfer"},request.as_ref().map(|r|r.to_uri()),
                if shielding{Some(u64::from(threshold).to_string())}else{None},
                if input.get("fromAddresses").is_some(){Some(sources.keys().cloned().collect::<Vec<_>>())}else{None},
                canonical_policy,max_fee.map(|v|u64::from(v).to_string())]).to_string();
            let identity=if let Some(value)=input.get("idempotencyKey") {
                let key=value.as_str().ok_or(Failure::from("INVALID_ARGUMENT"))?;
                if key.is_empty()||key.len()>1024{return Err("INVALID_ARGUMENT".into());}
                Some((digest(b"zakura-wallet-idempotency-key/1",&[key.as_bytes()]),digest(b"zakura-wallet-intent/1",&[&parameters,&genesis,intent.as_bytes()])))
            }else{None};
            if let Some((key,intent))=&identity {
                let found=ext.query_row("SELECT intent,operation FROM ext_wallet_proposal_intents WHERE key=?1",[key],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?))).optional()?;
                if let Some((stored,id))=found {
                    if stored!=*intent{return Err("IDEMPOTENCY_CONFLICT".into());}
                    super::payment::require_active(ext,&id)?;
                    let (encoded,policy,revision):(Vec<u8>,String,String)=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END,policy,revision FROM ext_wallet_proposals WHERE operation=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
                    let plan=wire::Proposal::decode(&encoded[..]).map_err(|_|Failure::from("STORAGE_ERROR"))?;
                    let policy=serde_json::from_str(&policy).map_err(|_|Failure::from("STORAGE_ERROR"))?;
                    return Ok(bind_review(review(&plan,&p,account_text,&hex::encode(id),&policy,&revision)?,&encoded,&parameters,&genesis,&policy));
                }
            }
            if operation=="proposal_lookup_intent" {if identity.is_none(){return Err("INVALID_ARGUMENT".into());}return Ok(Value::Null);}
            if super::revision::read(ext)?!=string(input,"revision")? {return Err("STALE_REVISION".into());}
            if !db.get_wallet_summary_in_transaction(confirmations)?.is_some_and(|s|s.is_synced()){return Err("SYNC_REQUIRED".into());}
            let target=u32::from(db.chain_height()?.ok_or(Failure::from("SYNC_REQUIRED"))?).checked_add(1).ok_or(Failure::from("RESOURCE_LIMIT"))?;
            let lock_blocks=height(policy,"lockExpiryBlocks")?;
            if lock_blocks==0{return Err("INVALID_ARGUMENT".into());}
            target.checked_add(lock_blocks).ok_or(Failure::from("INVALID_ARGUMENT"))?;
            let mut id=[0;32];getrandom::fill(&mut id).map_err(|_|Failure::from("ENTROPY_UNAVAILABLE"))?;
            let selector=GreedyInputSelector::new();
            let strategy=SingleOutputChangeStrategy::new(StandardFeeRule::Zip317,None,change_pool,DustOutputPolicy::default());
            let version=zcash_primitives::transaction::TxVersion::suggested_for_branch(BranchId::for_height(&p,target.into()));
            let wire=if shielding {
                let owned=db.get_transparent_receivers(account,true,false)?;
                let addresses=if input.get("fromAddresses").is_none(){owned.keys().copied().collect::<Vec<_>>()}else{
                    if sources.values().any(|a|!owned.contains_key(a)){return Err("INVALID_ARGUMENT".into());}
                    sources.values().copied().collect::<Vec<_>>()};
                if addresses.is_empty(){return Err("NOTHING_TO_SHIELD".into());}
                let plan=propose_shielding::<_,_,_,_,rusqlite::Error>(db,&p,&selector,&strategy,threshold,&addresses,account,confirmations,
                    zcash_client_backend::data_api::CoinbaseFilter::AllTransparentOutputs,Some(LockRequest::new(LockOwner::new(id),lock_blocks)))
                    .map_err(|e|Failure::from(match e {zcash_client_backend::data_api::error::Error::InsufficientFunds{..}|zcash_client_backend::data_api::error::Error::Change(zcash_client_backend::fees::ChangeError::InsufficientFunds{..})=>"NOTHING_TO_SHIELD",zcash_client_backend::data_api::error::Error::ScanRequired=>"SYNC_REQUIRED",_=>"BACKEND_ERROR"}))?;
                wire::Proposal::from_standard_proposal(&plan.with_proposed_version(Some(version)))
            }else{
                let plan=propose_transfer::<_,_,_,_,rusqlite::Error>(db,&p,account,&selector,&strategy,request.unwrap(),confirmations,&spend,Some(LockRequest::new(LockOwner::new(id),lock_blocks)),Some(version))
                    .map_err(|e|Failure::from(match e {zcash_client_backend::data_api::error::Error::InsufficientFunds{..}=>"INSUFFICIENT_FUNDS",zcash_client_backend::data_api::error::Error::ScanRequired=>"SYNC_REQUIRED",_=>"BACKEND_ERROR"}))?;
                wire::Proposal::from_standard_proposal(&plan)
            };
            if wire.steps.len()>16{return Err("RESOURCE_LIMIT".into());}
            let mut total=0u64;
            for step in &wire.steps {
                let balance=step.balance.as_ref().ok_or(Failure::from("BACKEND_ERROR"))?;
                for change in &balance.proposed_change {if !change.is_ephemeral&&pool_name(change.value_pool)?!=string(policy,"changePool")?{return Err("UNSUPPORTED_POOL".into());}}
                total=total.checked_add(balance.fee_required).ok_or(Failure::from("RESOURCE_LIMIT"))?;
            }
            if max_fee.is_some_and(|max|total>u64::from(max)){return Err("FEE_LIMIT_EXCEEDED".into());}
            let encoded=wire.encode_to_vec();
            if encoded.len()>2097152{return Err("RESOURCE_LIMIT".into());}
            super::revision::advance(ext)?;
            let revision=super::revision::read(ext)?;
            let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
            let review=bind_review(review(&wire,&p,account_text,&hex::encode(id),policy,&revision)?,&encoded,&parameters,&genesis,policy);
            let sequence=ext.query_row("SELECT COALESCE(MAX(sequence),0) FROM ext_wallet_proposals",[],|r|r.get::<_,i64>(0))?.checked_add(1).ok_or(Failure::from("RESOURCE_LIMIT"))?;
            ext.execute("INSERT INTO ext_wallet_proposals VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![sequence,&id[..],uuid,encoded,policy.to_string(),revision])?;
            if let Some((key,intent))=identity {ext.execute("INSERT INTO ext_wallet_proposal_intents VALUES(?1,?2,?3)",rusqlite::params![key,intent,&id[..]])?;}
            Ok(review)
        })
    })
}
#[wasm_bindgen]
pub fn proposal_call(generation:u32,operation:&str,input:&str)->std::result::Result<String,String> {
    if input.len()>65536{return Err("RESOURCE_LIMIT".into());}
    let value=serde_json::from_str(input).map_err(|_|"INVALID_ARGUMENT")?;
    execute(generation,operation,&value).map(|v|v.to_string()).map_err(|e|e.0)
}
