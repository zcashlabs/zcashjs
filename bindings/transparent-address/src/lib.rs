use wasm_bindgen::prelude::*;
use zcash_address::{ConversionError, TryFromAddress, ZcashAddress};
use zcash_protocol::consensus::NetworkType;

#[derive(Debug)]
pub struct Decoded {
    pub canonical: String,
    pub kind: &'static str,
    pub payload: [u8; 20],
}
struct Receiver(&'static str, [u8; 20]);
impl TryFromAddress for Receiver {
    type Error = &'static str;
    fn try_from_transparent_p2pkh(_: NetworkType, data: [u8; 20]) -> Result<Self, ConversionError<Self::Error>> {
        Ok(Self("p2pkh", data))
    }
    fn try_from_transparent_p2sh(_: NetworkType, data: [u8; 20]) -> Result<Self, ConversionError<Self::Error>> {
        Ok(Self("p2sh", data))
    }
}

pub fn decode(token: &str, family: &str) -> Result<Decoded, &'static str> {
    let family = match family {
        "main" => NetworkType::Main,
        "test" => NetworkType::Test,
        "regtest" => NetworkType::Regtest,
        _ => return Err("invalid encoding family"),
    };
    // The native parser trims Unicode whitespace. Our admitted token explicitly does not.
    if token.is_empty() || token.len() > 128 || !token.bytes().all(|b| (33..=126).contains(&b)) {
        return Err("invalid address token");
    }
    let address = ZcashAddress::try_from_encoded(token).map_err(|_| "invalid address encoding")?;
    let canonical = address.encode();
    let Receiver(kind, payload) = address.convert_if_network(family).map_err(|_| "unsupported address or encoding family mismatch")?;
    Ok(Decoded { canonical, kind, payload })
}

/// Private ABI v1: kind byte (0=P2PKH, 1=P2SH), 20 receiver bytes, native ASCII encoding.
#[wasm_bindgen]
pub fn transparent_address_decode(token: &str, family: &str) -> Result<Vec<u8>, JsError> {
    let result = decode(token, family).map_err(JsError::new)?;
    let mut bytes = Vec::with_capacity(21 + result.canonical.len());
    bytes.push(u8::from(result.kind == "p2sh"));
    bytes.extend_from_slice(&result.payload);
    bytes.extend_from_slice(result.canonical.as_bytes());
    Ok(bytes)
}
