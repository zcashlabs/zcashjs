//! Pure viewing authority and address operations. No wallet or storage owner.
use crate::Document;
use serde_json::{json, Value};
use zcash_address::{unified::{self, Container, Encoding}, ConversionError, TryFromAddress, ZcashAddress};
use zcash_keys::{address::Address, keys::{AddressGenerationError, ReceiverRequirement, UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedIncomingViewingKey}};
use zcash_protocol::consensus::{BlockHeight, BranchId, NetworkType, NetworkUpgrade, Parameters};
use zcash_transparent::keys::{IncomingViewingKey, NonHardenedChildIndex};
use zip32::DiversifierIndex;

type Result<T> = std::result::Result<T, String>;
fn invalid<T>() -> Result<T> { Err("INVALID_ARGUMENT".into()) }
fn token(s: &str) -> Result<()> {
    if s.is_empty() || s.len() > 16384 || !s.bytes().all(|b| (33..=126).contains(&b)) { return invalid(); }
    Ok(())
}
fn params(bytes: &[u8]) -> Result<Document> { Document::parse(bytes).map_err(|_| "INVALID_ARGUMENT".into()) }
fn parse(s: &str) -> Result<Value> {
    if s.len() > 1024 { return invalid(); }
    serde_json::from_str(s).map_err(|_| "INVALID_ARGUMENT".into())
}
fn fields(v: &Value, allowed: &[&str]) -> Result<()> {
    if !v.as_object().is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str()))) { return invalid(); }
    Ok(())
}
fn index(s: &str) -> Result<DiversifierIndex> {
    let n = s.parse::<u128>().map_err(|_| "INVALID_ARGUMENT")?;
    if n >= 1u128 << 88 || n.to_string() != s { return invalid(); }
    Ok(DiversifierIndex::from(<[u8;11]>::try_from(&n.to_le_bytes()[..11]).unwrap()))
}
fn index_string(j: DiversifierIndex) -> String {
    let mut b = [0;16]; b[..11].copy_from_slice(j.as_bytes()); u128::from_le_bytes(b).to_string()
}

// wasm-bindgen owns this allocation; the facade exposes only a closeable opaque closure.
pub struct ViewingHandle {
    parameters: Document,
    full: Option<UnifiedFullViewingKey>,
    incoming: UnifiedIncomingViewingKey,
    enabled: [bool;3],
}
impl ViewingHandle {
    pub fn describe(&self) -> String {
        let mut components = vec![];
        if self.incoming.transparent().is_some() { components.push("p2pkh"); }
        if self.incoming.sapling().is_some() { components.push("sapling"); }
        if self.incoming.orchard().is_some() { components.push("orchard"); }
        let pools: Vec<_> = ["transparent", "sapling", "ironwood"].into_iter().zip(self.enabled).filter_map(|(p,e)| e.then_some(p)).collect();
        json!({"kind":if self.full.is_some(){"ufvk"}else{"uivk"},"components":components,"enabledPools":pools,"provenance":null}).to_string()
    }
    pub fn export(&self, format: &str, acknowledge: &str) -> Result<String> {
        if acknowledge != "discloses-viewing-authority" { return invalid(); }
        match format {
            "ufvk" => self.full.as_ref().map(|k| k.encode(&self.parameters)).ok_or("FULL_VIEWING_KEY_REQUIRED".into()),
            "uivk" => Ok(self.incoming.encode(&self.parameters)),
            _ => invalid(),
        }
    }
    pub fn to_incoming(&self) -> ViewingHandle {
        ViewingHandle { parameters:self.parameters.clone(), full:None, incoming:self.incoming.clone(), enabled:self.enabled }
    }
    pub fn derive(&self, index: &str, request: &str) -> Result<String> { self.search(index, request, 1, true) }
    pub fn find(&self, start: &str, request: &str, max_attempts: u32) -> Result<String> { self.search(start, request, max_attempts, false) }
}
impl ViewingHandle {
    fn search(&self, start: &str, request: &str, max_attempts: u32, exact: bool) -> Result<String> {
        if max_attempts == 0 { return invalid(); }
        if max_attempts > 10000 { return Err("RESOURCE_LIMIT".into()); }
        let mut j = index(start)?;
        let r = parse(request)?;
        fields(&r, &["format","transparent","sapling","ironwood"])?;
        if r["format"] == "transparent" {
            if r.as_object().unwrap().len() != 1 { return invalid(); }
            if !self.enabled[0] { return Err("UNSUPPORTED_POOL".into()); }
            let i = NonHardenedChildIndex::try_from(j).map_err(|_| "DISCOVERY_RANGE_UNSAFE")?;
            let address = self.incoming.transparent().as_ref().ok_or("MISSING_AUTHORITY")?.derive_address(i).map_err(|_| "RECEIVER_UNAVAILABLE")?;
            return Ok(json!({"address":Address::Transparent(address).encode(&self.parameters),"index":start,"receiverTypes":["p2pkh"],"intendedPools":["transparent"]}).to_string());
        }
        if r["format"] != "unified" { return invalid(); }
        let requirements = if r.as_object().unwrap().len() == 1 {
            self.enabled.map(|e| if e {ReceiverRequirement::Require} else {ReceiverRequirement::Omit})
        } else {
            let mut req = [ReceiverRequirement::Omit;3];
            for (i,n) in ["transparent","sapling","ironwood"].iter().enumerate() {
                req[i] = match r[*n].as_str() {
                    Some("require") => ReceiverRequirement::Require,
                    Some("omit") => ReceiverRequirement::Omit,
                    Some("allow") if i == 0 => ReceiverRequirement::Allow,
                    _ => return invalid(),
                };
                if !self.enabled[i] {
                    if req[i] == ReceiverRequirement::Require { return Err("UNSUPPORTED_POOL".into()); }
                    req[i] = ReceiverRequirement::Omit;
                }
            }
            req
        };
        let req = UnifiedAddressRequest::custom(requirements[2], requirements[1], requirements[0]).map_err(|_| "INVALID_ARGUMENT")?;
        for attempt in 0..max_attempts {
            match self.incoming.address(j, req) {
                Ok(a) => {
                    let mut receivers = vec![]; let mut pools = vec![];
                    if a.has_transparent() { receivers.push("p2pkh"); pools.push("transparent"); }
                    if a.has_sapling() { receivers.push("sapling"); pools.push("sapling"); }
                    if a.has_orchard() { receivers.push("orchard"); pools.push("ironwood"); }
                    return Ok(json!({"address":a.encode(&self.parameters),"index":index_string(j),"receiverTypes":receivers,"intendedPools":pools}).to_string());
                }
                Err(AddressGenerationError::InvalidSaplingDiversifierIndex(_)) => {
                    if attempt + 1 == max_attempts { return Err(if exact {"INVALID_DIVERSIFIER"} else {"ADDRESS_SEARCH_LIMIT"}.into()); }
                    j.increment().map_err(|_| "DIVERSIFIER_EXHAUSTED")?;
                }
                Err(AddressGenerationError::KeyNotAvailable(_)) => return Err("MISSING_AUTHORITY".into()),
                Err(AddressGenerationError::InvalidTransparentChildIndex(_)) => return Err("DISCOVERY_RANGE_UNSAFE".into()),
                Err(_) => return Err("RECEIVER_UNAVAILABLE".into()),
            }
        }
        unreachable!()
    }
}

pub fn viewing_open(parameters: &[u8], format: &str, encoded: &str, pools: &str) -> Result<ViewingHandle> {
    let p = params(parameters)?; token(encoded)?;
    let full = match format {
        "ufvk" => {
            let (net,_) = unified::Ufvk::decode(encoded).map_err(|_| "INVALID_ARGUMENT")?;
            if net != p.network_type() { return Err("NETWORK_MISMATCH".into()); }
            Some(UnifiedFullViewingKey::decode(&p, encoded).map_err(|_| "INVALID_ARGUMENT")?)
        }
        "uivk" => None,
        _ => return invalid(),
    };
    let incoming = if let Some(k) = &full { k.to_unified_incoming_viewing_key() } else {
        let (net,_) = unified::Uivk::decode(encoded).map_err(|_| "INVALID_ARGUMENT")?;
        if net != p.network_type() { return Err("NETWORK_MISMATCH".into()); }
        UnifiedIncomingViewingKey::decode(&p, encoded).map_err(|_| "INVALID_ARGUMENT")?
    };
    let values = parse(pools)?;
    let values = values.as_array().ok_or("INVALID_ARGUMENT")?;
    if values.is_empty() || values.len() > 3 { return invalid(); }
    let mut enabled = [false;3];
    for value in values {
        let i = match value.as_str() { Some("transparent") => 0, Some("sapling") => 1, Some("ironwood") => 2, _ => return invalid() };
        if enabled[i] { return invalid(); } enabled[i] = true;
        if ![incoming.transparent().is_some(), incoming.sapling().is_some(), incoming.orchard().is_some()][i] { return Err("MISSING_AUTHORITY".into()); }
        if i != 0 && p.activation_height(if i == 1 {NetworkUpgrade::Sapling} else {NetworkUpgrade::Nu6_3}).is_none() { return Err("UNSUPPORTED_POOL".into()); }
    }
    Ok(ViewingHandle { parameters:p, full, incoming, enabled })
}

struct Receivers(Vec<unified::Receiver>);
impl TryFromAddress for Receivers {
    type Error = &'static str;
    fn try_from_transparent_p2pkh(_: NetworkType, data:[u8;20]) -> std::result::Result<Self,ConversionError<Self::Error>> { Ok(Self(vec![unified::Receiver::P2pkh(data)])) }
    fn try_from_transparent_p2sh(_: NetworkType, data:[u8;20]) -> std::result::Result<Self,ConversionError<Self::Error>> { Ok(Self(vec![unified::Receiver::P2sh(data)])) }
    fn try_from_sapling(_: NetworkType, data:[u8;43]) -> std::result::Result<Self,ConversionError<Self::Error>> { Ok(Self(vec![unified::Receiver::Sapling(data)])) }
    fn try_from_unified(_: NetworkType, data:unified::Address) -> std::result::Result<Self,ConversionError<Self::Error>> { Ok(Self(data.items_as_parsed().to_vec())) }
}
fn decode(p: &Document, encoded: &str) -> Result<(String,Receivers)> {
    token(encoded)?;
    let address = ZcashAddress::try_from_encoded(encoded).map_err(|_| "INVALID_ADDRESS")?;
    let _: Address = address.clone().convert_if_network(p.network_type()).map_err(|_| "INVALID_ADDRESS")?;
    let canonical = address.encode();
    let receivers = address.convert_if_network(p.network_type()).map_err(|_| "INVALID_ADDRESS")?;
    Ok((canonical,receivers))
}
pub fn viewing_decode_address(parameters: &[u8], encoded: &str) -> Result<String> {
    let (encoded, Receivers(receivers)) = decode(&params(parameters)?, encoded)?;
    let mut known = vec![]; let mut unknown = vec![];
    for receiver in receivers {
        match receiver {
            unified::Receiver::P2pkh(_) => known.push("p2pkh"), unified::Receiver::P2sh(_) => known.push("p2sh"),
            unified::Receiver::Sapling(_) => known.push("sapling"), unified::Receiver::Orchard(_) => known.push("orchard"),
            unified::Receiver::Unknown{typecode,..} => unknown.push(typecode),
        }
    }
    Ok(json!({"encoded":encoded,"knownReceivers":known,"unknownTypecodes":unknown}).to_string())
}
pub fn viewing_select_receiver(parameters: &[u8], encoded: &str, pool: &str, height: u32, branch: u32) -> Result<String> {
    let p = params(parameters)?;
    let h = BlockHeight::from_u32(height);
    if u32::from(BranchId::for_height(&p,h)) != branch { return Err("NETWORK_MISMATCH".into()); }
    let upgrade = match pool { "transparent" => None, "sapling" => Some(NetworkUpgrade::Sapling), "ironwood" => Some(NetworkUpgrade::Nu6_3), _ => return invalid() };
    if upgrade.is_some_and(|u| p.activation_height(u).is_none_or(|a| a > h)) { return Err("UNSUPPORTED_POOL".into()); }
    let (_,Receivers(receivers)) = decode(&p,encoded)?;
    for receiver in receivers {
        let selected = match receiver {
            unified::Receiver::P2pkh(b) if pool == "transparent" => Some(("p2pkh",b.to_vec())),
            unified::Receiver::P2sh(b) if pool == "transparent" => Some(("p2sh",b.to_vec())),
            unified::Receiver::Sapling(b) if pool == "sapling" => Some(("sapling",b.to_vec())),
            unified::Receiver::Orchard(b) if pool == "ironwood" => Some(("orchard",b.to_vec())), _ => None,
        };
        if let Some((kind,bytes)) = selected { return Ok(json!({"pool":pool,"type":kind,"bytes":hex::encode(bytes)}).to_string()); }
    }
    Err("MISSING_AUTHORITY".into())
}
