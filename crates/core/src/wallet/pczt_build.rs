//! Atomic single-step construction from the retained native proposal.
use super::accounts::{fields,string,Failure,Result};
use prost::Message;
use rusqlite::{Connection,OptionalExtension};
use serde_json::{json,Value};
use zcash_client_backend::{data_api::{Account,WalletRead,wallet::create_pczt_from_proposal},proto::proposal as wire,wallet::OvkPolicy};
use zcash_keys::{address::{Address,UnifiedAddress},keys::UnifiedFullViewingKey};
use zcash_note_encryption::{Domain,ShieldedOutput,try_output_recovery_with_pkd_esk};

pub(super) const TABLE:&str="ext_wallet_pczt";
pub(super) const SQL:&str="CREATE TABLE ext_wallet_pczt(operation BLOB PRIMARY KEY NOT NULL CHECK(typeof(operation)='blob' AND length(operation)=32),artifact TEXT NOT NULL CHECK(typeof(artifact)='text' AND length(artifact)=64),bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes)>0 AND length(bytes)<=4194304),FOREIGN KEY(operation) REFERENCES ext_wallet_proposals(operation))";
pub(super) fn initialize(conn:&mut Connection)->std::result::Result<(),String> {
    if !conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[TABLE],|r|r.get::<_,bool>(0)).map_err(|_|"STORAGE_INIT_FAILED")? {
        conn.execute_batch(SQL).map_err(|_|"STORAGE_INIT_FAILED")?;
    }
    Ok(())
}
fn bad()->Failure {Failure::from("PCZT_ASSOCIATION_MISMATCH")}
fn memo<D:Domain<Memo=[u8;512]>,O:ShieldedOutput<D,580>>(domain:&D,note:&D::Note,output:&O)->Result<Value>
where D::Note:PartialEq {
    // Same native recovery seam as backend wallet.rs::to_sent_transaction_output.
    let recovered=try_output_recovery_with_pkd_esk(domain,D::get_pk_d(note),D::derive_esk(note).ok_or_else(bad)?,output).ok_or_else(bad)?;
    if recovered.0!=*note{return Err(bad());}
    Ok(if recovered.2==*zcash_protocol::memo::MemoBytes::empty().as_array(){Value::Null}else{json!(hex::encode(recovered.2))})
}
struct Output {pool:&'static str,address:Address,user:Option<String>,value:u64,memo:Value,owned:bool}
fn projection(value:&pczt::Pczt,p:&crate::Document,key:&UnifiedFullViewingKey,review:&Value)->Result<Vec<Value>> {
    let mut outputs=Vec::new();
    for output in value.transparent().outputs() {
        if !output.proprietary().contains_key("zcash_client_backend:output_info"){return Err(bad());}
        let script=zcash_script::script::FromChain::parse(&zcash_script::script::Code(output.script_pubkey().clone())).map_err(|_|bad())?;
        let address=zcash_transparent::address::TransparentAddress::from_script_from_chain(&script).ok_or_else(bad)?;
        outputs.push(Output{pool:"transparent",address:Address::Transparent(address),user:output.user_address().clone(),value:*output.value(),memo:Value::Null,owned:false});
    }
    pczt::roles::verifier::Verifier::new(value.clone()).with_sapling::<Failure,_>(|bundle| {
        let effects=bundle.extract_effects::<i64>().map_err(|_|pczt::roles::verifier::SaplingError::Custom(bad()))?;
        if let Some(effects)=effects {
            for (raw,effect) in value.sapling().outputs().iter().zip(effects.shielded_outputs()) {
                if !raw.proprietary().contains_key("zcash_client_backend:output_info"){continue;}
                let convert=||->Result<Output>{
                    let address=sapling::PaymentAddress::from_bytes(raw.recipient().as_ref().ok_or_else(bad)?).ok_or_else(bad)?;
                    let amount=raw.value().ok_or_else(bad)?;
                    let note=address.create_note(sapling::value::NoteValue::from_raw(amount),sapling::Rseed::AfterZip212(raw.rseed().ok_or_else(bad)?));
                    let memo=memo(&sapling::note_encryption::SaplingDomain::new(sapling::note_encryption::Zip212Enforcement::On),&note,effect)?;
                    // Native change derivation also covers internal addresses that decrypt_diversifier misses.
                    let owned=key.sapling().is_some_and(|key|key.decrypt_diversifier(&address).is_some()||key.diversified_change_address(*address.diversifier())==Some(address));
                    Ok(Output{pool:"sapling",address:Address::Sapling(address),user:raw.user_address().clone(),value:amount,memo,owned})
                };
                outputs.push(convert().map_err(pczt::roles::verifier::SaplingError::Custom)?);
            }
        }
        Ok(())
    }).map_err(|_|bad())?.with_ironwood::<Failure,_>(|bundle| {
        let effects=bundle.extract_effects::<i64>().map_err(|_|pczt::roles::verifier::OrchardError::Custom(bad()))?;
        if let Some(effects)=effects {
            for ((raw,parsed),effect) in value.ironwood().actions().iter().zip(bundle.actions()).zip(effects.actions().iter()) {
                if !raw.output().proprietary().contains_key("zcash_client_backend:output_info"){continue;}
                let convert=||->Result<Output>{
                    let out=raw.output();
                    let address=orchard::Address::from_raw_address_bytes(out.recipient().as_ref().ok_or_else(bad)?).into_option().ok_or_else(bad)?;
                    let amount=out.value().ok_or_else(bad)?;
                    let rho=orchard::note::Rho::from_bytes(raw.spend().nullifier()).into_option().ok_or_else(bad)?;
                    let seed=orchard::note::RandomSeed::from_bytes(out.rseed().ok_or_else(bad)?,&rho).into_option().ok_or_else(bad)?;
                    let note=orchard::Note::from_parts(address,orchard::value::NoteValue::from_raw(amount),rho,seed,orchard::note::NoteVersion::V3).into_option().ok_or_else(bad)?;
                    let memo=memo(&orchard::note_encryption::IronwoodDomain::for_pczt_action(parsed),&note,effect)?;
                    let owned=key.orchard().and_then(|key|key.scope_for_address(&address)).is_some();
                    Ok(Output{pool:"ironwood",address:Address::Unified(UnifiedAddress::from_receivers(Some(address),None,None).ok_or_else(bad)?),user:out.user_address().clone(),value:amount,memo,owned})
                };
                outputs.push(convert().map_err(pczt::roles::verifier::OrchardError::Custom)?);
            }
        }
        Ok(())
    }).map_err(|_|bad())?;
    let intended=review["steps"][0]["outputs"].as_array().ok_or_else(bad)?;
    if outputs.len()!=intended.len()||outputs.len()>256{return Err(bad());}
    let mut result=Vec::new();
    for intent in intended {
        let expected_memo=match intent.get("memo") {
            None|Some(Value::Null)=>Value::Null,
            Some(Value::String(text))=>{
                let bytes=hex::decode(text).map_err(|_|bad())?;
                let memo=zcash_protocol::memo::MemoBytes::from_bytes(&bytes).map_err(|_|bad())?;
                if memo==zcash_protocol::memo::MemoBytes::empty(){Value::Null}else{json!(hex::encode(memo.as_array()))}
            },
            _=>return Err(bad()),
        };
        let index=outputs.iter().position(|out| {
            if intent["pool"]!=out.pool||intent["amount"]!=out.value.to_string()||expected_memo!=out.memo{return false;}
            if intent["kind"]!="payment" {return out.owned&&out.user.is_none();}
            let Some(user)=out.user.as_ref()else{return false;};
            if intent["address"]!=*user{return false;}
            match (Address::decode(p,user),&out.address) {
                (Some(Address::Unified(ua)),Address::Sapling(a))=>ua.sapling()==Some(a),
                (Some(Address::Unified(ua)),Address::Unified(actual))=>ua.orchard()==actual.orchard(),
                (Some(Address::Unified(ua)),Address::Transparent(a))=>ua.transparent()==Some(a),
                (Some(a),b)=>a==*b,
                _=>false,
            }
        }).ok_or_else(bad)?;
        let out=outputs.remove(index);
        let mut item=intent.clone();item["address"]=json!(out.user.unwrap_or_else(||out.address.encode(p)));item["memo"]=out.memo;result.push(item);
    }
    Ok(result)
}
pub fn pczt_build_call(generation:u32,operation:&str,input:&str)->std::result::Result<String,String> {
    if input.len()>4096{return Err("RESOURCE_LIMIT".into());}
    let input:Value=serde_json::from_str(input).map_err(|_|"INVALID_ARGUMENT")?;
    execute(generation,operation,&input,None).map(|v|v.to_string()).map_err(|e|e.0)
}
pub fn pczt_import_call(generation:u32,operation_id:&str,bytes:&[u8],maximum:u32)->std::result::Result<String,String>{
    if operation_id.len()!=64{return Err("INVALID_ARGUMENT".into());}
    if maximum==0||maximum>4194304||bytes.len()>maximum as usize{return Err("RESOURCE_LIMIT".into());}
    execute(generation,"pczt_import",&json!({"operationId":operation_id}),Some((bytes,maximum))).map(|v|v.to_string()).map_err(|e|e.0)
}
fn execute(generation:u32,operation:&str,input:&Value,incoming:Option<(&[u8],u32)>)->Result<Value> {
    fields(input,match operation {"pczt_build"=>&["operationId","proposalId","reviewCommitment"][..],"pczt_get_artifact"=>&["operationId","artifactId"],"pczt_import"=>&["operationId"],_=>return Err("INVALID_ARGUMENT".into())})?;
    let id=string(input,"operationId")?;let operation_bytes=hex::decode(id).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    if operation_bytes.len()!=32||hex::encode(&operation_bytes)!=id{return Err("INVALID_ARGUMENT".into());}
    super::DOMAIN.with(|domain| {
        let mut domain=domain.try_borrow_mut().map_err(|_|Failure::from("STORAGE_BUSY"))?;
        if domain.failed.is_some(){return Err("DOMAIN_INVALID".into());}
        let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure::from("STALE_HANDLE"))?;
        let p=active.wallet.params().clone();let parameters=active.bytes.clone();
        active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
            super::payment::require_active(ext,&operation_bytes)?;
            let (encoded,policy,account,revision)=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END,CASE WHEN length(policy)<=16384 THEN policy END,account,revision FROM ext_wallet_proposals WHERE operation=?1",[&operation_bytes],|r|Ok((r.get::<_,Vec<u8>>(0)?,r.get::<_,String>(1)?,r.get::<_,uuid::Uuid>(2)?,r.get::<_,String>(3)?))).optional()?.ok_or(Failure::from(if operation=="pczt_import"{"OPERATION_NOT_FOUND"}else{"STALE_PROPOSAL"}))?;
            let wire=wire::Proposal::decode(&encoded[..]).map_err(|_|Failure::from("STORAGE_ERROR"))?;
            let policy:Value=serde_json::from_str(&policy).map_err(|_|Failure::from("STORAGE_ERROR"))?;
            let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
            let review=super::proposal::bind_review(super::proposal::review(&wire,&p,&account.to_string(),id,&policy,&revision)?,&encoded,&parameters,&genesis,&policy);
            if operation=="pczt_build"&&(review["proposalId"]!=string(input,"proposalId")?||review["reviewCommitment"]!=string(input,"reviewCommitment")?){return Err(bad());}
            let mut retained=ext.query_row("SELECT artifact,CASE WHEN length(bytes)<=4194304 THEN bytes END FROM ext_wallet_pczt WHERE operation=?1",[&operation_bytes],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?))).optional()?;
            if operation!="pczt_build" {
                let wanted=input.get("artifactId").map(|_|string(input,"artifactId")).transpose()?;
                if let Some(wanted)=wanted {if wanted.len()!=64||!wanted.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("INVALID_ARGUMENT".into());}}
                let newer=ext.query_row("SELECT artifact,CASE WHEN length(bytes)<=4194304 THEN bytes END FROM ext_wallet_pczt_artifacts WHERE operation=?1 AND (?2 IS NULL OR artifact=?2) ORDER BY sequence DESC LIMIT 1",rusqlite::params![operation_bytes,wanted],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?))).optional()?;
                if newer.is_some(){retained=newer;}
                else if let Some(wanted)=wanted {if retained.as_ref().is_none_or(|(id,_)|id!=wanted){return Err(bad());}}
            }
            let account_id=zcash_client_sqlite::AccountUuid::from_uuid(account);
            let account=db.get_account(account_id)?.ok_or(Failure::from("ACCOUNT_NOT_FOUND"))?;
            let key=account.ufvk().ok_or(Failure::from("ACCOUNT_NOT_SPENDABLE"))?.clone();
            let (artifact,bytes,outputs)=if let Some((artifact,bytes))=retained {
                if artifact!=super::proposal::digest(b"zakura-wallet-pczt/1",&[id.as_bytes(),&bytes]){return Err("STORAGE_ERROR".into());}
                let mut value=pczt::Pczt::parse(&bytes).map_err(|_|Failure::from("STORAGE_ERROR"))?;
                let (artifact,bytes)=if let Some((incoming,maximum))=incoming {
                    let imported=crate::standalone_pczt::parse_standalone_pczt(&parameters,&genesis,wire.min_target_height,review["branchId"].as_u64().ok_or_else(bad)? as u32,incoming,maximum).map_err(Failure)?.into_value();
                    value=super::pczt_import::combine(value,imported)?;
                    let merged=value.clone().serialize().map_err(|_|bad())?;
                    if merged.len()>maximum as usize{return Err("RESOURCE_LIMIT".into());}
                    let next=super::proposal::digest(b"zakura-wallet-pczt/1",&[id.as_bytes(),&merged]);
                    if next!=artifact {
                        // Keep every issued identity; repeated exact imports do not mutate revision.
                        let original:bool=ext.query_row("SELECT EXISTS(SELECT 1 FROM ext_wallet_pczt WHERE operation=?1 AND artifact=?2)",rusqlite::params![operation_bytes,next],|r|r.get(0))?;
                        if !original&&ext.execute("INSERT OR IGNORE INTO ext_wallet_pczt_artifacts(operation,artifact,bytes) VALUES(?1,?2,?3)",rusqlite::params![operation_bytes,next,merged])?!=0 {super::revision::advance(ext)?;}
                    }
                    (next,merged)
                }else{(artifact,bytes)};
                let outputs=projection(&value,&p,&key,&review)?;
                (artifact,bytes,outputs)
            }else{
                if operation=="pczt_get_artifact"{return Ok(Value::Null);}
                if operation=="pczt_import"{return Err(bad());}
                if wire.steps.len()!=1{return Err("PCZT_MULTI_STEP_UNSUPPORTED".into());}
                if super::revision::read(ext)?!=revision||db.chain_height()?.map(u32::from).and_then(|h|h.checked_add(1))!=Some(wire.min_target_height){return Err("STALE_PROPOSAL".into());}
                let plan=wire.try_into_standard_proposal(&p,db).map_err(|_|Failure::from("STALE_PROPOSAL"))?;
                let expiry=review["expiryHeight"].as_u64().ok_or_else(bad)? as u32;
                let value=create_pczt_from_proposal::<_,_,std::convert::Infallible,_,std::convert::Infallible,_>(db,&p,account_id,OvkPolicy::Sender,&plan,Some(expiry.into()),zcash_primitives::transaction::builder::BundlePadding::DEFAULT).map_err(|_|Failure::from("ROLE_PRECONDITION"))?;
                let bytes=value.clone().serialize().map_err(|_|bad())?;if bytes.len()>4194304{return Err("RESOURCE_LIMIT".into());}
                let artifact=super::proposal::digest(b"zakura-wallet-pczt/1",&[id.as_bytes(),&bytes]);
                // Projection/association checks precede persistence; errors roll back backend construction too.
                let outputs=projection(&value,&p,&key,&review)?;
                ext.execute("INSERT INTO ext_wallet_pczt VALUES(?1,?2,?3)",rusqlite::params![operation_bytes,artifact,bytes])?;
                super::revision::advance(ext)?;
                (artifact,bytes,outputs)
            };
            let handle=crate::standalone_pczt::parse_standalone_pczt(&parameters,&genesis,wire.min_target_height,review["branchId"].as_u64().ok_or_else(bad)? as u32,&bytes,4194304).map_err(Failure)?;
            let inspection:Value=serde_json::from_str(&handle.inspect().map_err(Failure)?).map_err(|_|bad())?;
            let prover=pczt::roles::prover::Prover::new(handle.into_value());
            Ok(json!({"operationId":id,"artifactId":artifact,"accountId":review["accountId"],"outputs":outputs,"bytes":hex::encode(bytes),"requiresSaplingProofs":prover.requires_sapling_proofs(),"requiresIronwoodProof":prover.requires_ironwood_proof(),"requiresOrchardProof":prover.requires_orchard_proof(),"proofsComplete":inspection["proofsComplete"],"authorizationComplete":inspection["authorizationComplete"]}))
        })
    })
}
