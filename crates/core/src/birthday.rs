//! Shared native birthday validation; no wallet or database owner.
use prost::Message;
use serde_json::{json,Value};
use zcash_client_backend::{data_api::AccountBirthday,proto::service::TreeState};
use zcash_protocol::consensus::{Parameters,NetworkType,NetworkUpgrade};
type Result<T> = std::result::Result<T,String>;
pub(crate) fn string<'a>(v: &'a Value, name: &str) -> Result<&'a str> { v.get(name).and_then(Value::as_str).ok_or("INVALID_ARGUMENT".into()) }
pub(crate) fn height(v: &Value, name: &str) -> Result<u32> { v.get(name).and_then(Value::as_u64).and_then(|n| n.try_into().ok()).ok_or("INVALID_ARGUMENT".into()) }
pub(crate) fn fields(v: &Value, allowed: &[&str]) -> Result<()> {
    if !v.as_object().is_some_and(|m| m.keys().all(|k| allowed.contains(&k.as_str()))) { return Err("INVALID_ARGUMENT".into()); }
    Ok(())
}
pub(crate) fn validate(v: &Value, parameters: &[u8], genesis: &[u8], p: &crate::Document) -> Result<AccountBirthday> {
    if v.as_str()==Some("fullScan") {
        let hash=zcash_primitives::block::BlockHash::try_from_slice(genesis).ok_or(String::from("NETWORK_MISMATCH"))?;
        return Ok(AccountBirthday::from_parts(zcash_client_backend::data_api::chain::ChainState::empty(0u32.into(),hash),None));
    }
    fields(v,&["parameters","genesis","firstScanHeight","priorTreeState","recoverUntilExclusive","source"])?;
    if string(v,"parameters")? != hex::encode(parameters) || string(v,"genesis")? != hex::encode(genesis) { return Err("NETWORK_MISMATCH".into()); }
    if !matches!(string(v,"source")?,"checkpoint"|"light-client") { return Err("INVALID_BIRTHDAY".into()); }
    let first = height(v,"firstScanHeight")?;
    if first == 0 { return Err("INVALID_BIRTHDAY".into()); }
    let recover = if v.get("recoverUntilExclusive").is_some() { Some(height(v,"recoverUntilExclusive")?) } else { None };
    if recover.is_some_and(|h| h < first) { return Err("INVALID_BIRTHDAY".into()); }
    let raw = hex::decode(string(v,"priorTreeState")?).map_err(|_| String::from("INVALID_BIRTHDAY"))?;
    if raw.is_empty() || raw.len()>65536 { return Err("INVALID_BIRTHDAY".into()); }
    let state = TreeState::decode(raw.as_slice()).map_err(|_| String::from("INVALID_BIRTHDAY"))?;
    // This private encoding accepts the pinned prost canonical form only: unknown,
    // duplicate and otherwise unconsumed fields cannot silently disappear.
    if state.encode_to_vec() != raw { return Err("INVALID_BIRTHDAY".into()); }
    let trees = [
        (state.sapling_tree.as_str(), NetworkUpgrade::Sapling),
        (state.orchard_tree.as_str(), NetworkUpgrade::Nu5),
        (state.ironwood_tree.as_str(), NetworkUpgrade::Nu6_3),
    ];
    for (i,(encoded,upgrade)) in trees.into_iter().enumerate() {
        let mut canonical = Vec::new();
        let empty = match i {
            0 => { let tree = state.sapling_tree().map_err(|_| String::from("INVALID_BIRTHDAY"))?; zcash_primitives::merkle_tree::write_commitment_tree(&tree,&mut canonical).map_err(|_| String::from("INVALID_BIRTHDAY"))?; tree.size()==0 },
            _ => { let tree = if i==1 { state.orchard_tree() } else { state.ironwood_tree() }.map_err(|_| String::from("INVALID_BIRTHDAY"))?; zcash_primitives::merkle_tree::write_commitment_tree(&tree,&mut canonical).map_err(|_| String::from("INVALID_BIRTHDAY"))?; tree.size()==0 },
        };
        let active = p.is_nu_active(upgrade,(first-1).into());
        if (!encoded.is_empty() && encoded != hex::encode(canonical)) || (active && encoded.is_empty()) || (!active && !empty) { return Err("INVALID_BIRTHDAY".into()); }
    }
    let network = match p.network_type() { NetworkType::Main=>"main",NetworkType::Test=>"test",NetworkType::Regtest=>"regtest" };
    if state.network != network || state.height != u64::from(first-1) { return Err("INVALID_BIRTHDAY".into()); }
    let decoded = AccountBirthday::from_treestate(state,recover.map(Into::into)).map_err(|_| String::from("INVALID_BIRTHDAY"))?;
    if first==1 && decoded.prior_chain_state().block_hash().0.as_slice() != genesis { return Err("NETWORK_MISMATCH".into()); }
    Ok(decoded)
}

pub fn validate_birthday(parameters:&[u8], genesis:&[u8], first:u32, tree:&[u8], recover:Option<u32>) -> Result<()> {
    if genesis.len()!=32 { return Err("NETWORK_MISMATCH".into()); }
    if tree.is_empty() || tree.len()>65536 { return Err("INVALID_BIRTHDAY".into()); }
    let p=crate::Document::parse(parameters).map_err(|_|"INVALID_ARGUMENT")?;
    let mut input=json!({"parameters":hex::encode(parameters),"genesis":hex::encode(genesis),"firstScanHeight":first,
        "priorTreeState":hex::encode(tree),"source":"light-client"});
    if let Some(recover)=recover {input["recoverUntilExclusive"]=json!(recover);}
    validate(&input,parameters,genesis,&p).map(|_|())
}
