use prost::Message;
use serde::{Serialize, de::DeserializeOwned};
mod messages;
mod bounds;

macro_rules! decimal {
    ($module:ident, $ty:ty) => { mod $module {
        use serde::{Deserialize, Deserializer, Serializer};
        pub fn serialize<S: Serializer>(v: &$ty, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&v.to_string()) }
        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<$ty, D::Error> {
            let s = String::deserialize(d)?;
            let n = s.parse::<$ty>().map_err(serde::de::Error::custom)?;
            if n.to_string() != s { return Err(serde::de::Error::custom("noncanonical decimal")); }
            Ok(n)
        }
    }};
}
decimal!(decimal_u64, u64);
decimal!(decimal_i64, i64);
mod hex_bytes {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        let text: String = v.iter().flat_map(|b| [char::from(b"0123456789abcdef"[(b >> 4) as usize]), char::from(b"0123456789abcdef"[(b & 15) as usize])]).collect();
        s.serialize_str(&text)
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        if s.len() % 2 != 0 || !s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) { return Err(serde::de::Error::custom("expected lowercase hex")); }
        Ok(s.as_bytes().chunks_exact(2).map(|c| ((c[0] as char).to_digit(16).unwrap() * 16 + (c[1] as char).to_digit(16).unwrap()) as u8).collect())
    }
}
enum Input<'a> { Request(&'a str), Response(&'a [u8], bool) }
enum Output { Bytes(Vec<u8>), Json(String) }
fn route<Q: Message + Default + DeserializeOwned, R: Message + Default + Serialize>(input: Input, req: &str, res: &str, stream: bool) -> Result<Output, String> {
    match input { Input::Request(json) => {
        bounds::json(json,req)?;
        let value: Q = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if value.encoded_len() > bounds::MAX_MESSAGE { return Err("encoded message limit".into()); }
        let bytes = value.encode_to_vec();
        bounds::wire(&bytes,req)?;
        Ok(Output::Bytes(bytes))
    }, Input::Response(bytes, item) => {
        if item != stream { return Err("wrong method kind".into()); }
        bounds::wire(bytes,res)?;
        let value = R::decode(bytes).map_err(|e| e.to_string())?;
        Ok(Output::Json(serde_json::to_string(&value).map_err(|e| e.to_string())?))
    }}
}
include!("dispatch.rs");
pub fn encode_request(method: &str, json: &str) -> Result<Vec<u8>, String> {
    let Output::Bytes(bytes) = dispatch(method, Input::Request(json))? else { unreachable!() };
    Ok(bytes)
}
pub fn decode_response(method: &str, bytes: &[u8]) -> Result<String, String> { decode(method, bytes, false) }
pub fn decode_item(method: &str, bytes: &[u8]) -> Result<String, String> { decode(method, bytes, true) }
fn decode(method: &str, bytes: &[u8], item: bool) -> Result<String, String> {
    let Output::Json(json) = dispatch(method, Input::Response(bytes, item))? else { unreachable!() };
    Ok(json)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn lightwire_encode(method: &str, json: &str) -> Result<Vec<u8>, String> { encode_request(method,json) }
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn lightwire_decode(method: &str, bytes: &[u8], item: bool) -> Result<String, String> { decode(method,bytes,item) }

/// Encode the pinned response DTO for JSON-RPC tree-state composition.
/// Network, hash and commitment-tree interpretation remain the caller's responsibility.
pub fn encode_tree_state(json: &str) -> Result<Vec<u8>, String> {
    bounds::json(json, "TreeState")?;
    let value: messages::TreeState = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if value.encoded_len() > bounds::MAX_MESSAGE { return Err("encoded message limit".into()); }
    let bytes = value.encode_to_vec();
    bounds::wire(&bytes, "TreeState")?;
    Ok(bytes)
}
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn lightwire_encode_tree_state(json: &str) -> Result<Vec<u8>, String> { encode_tree_state(json) }
