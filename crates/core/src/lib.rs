use zcash_protocol::consensus::{BlockHeight, BranchId, NetworkType, NetworkUpgrade, Parameters};
use zcash_primitives::transaction::Transaction;

/// Internal codec: exact upstream serialization is required before returning identity.
/// This does not validate signatures, proofs, consensus rules, or activation.
pub fn transaction_id(raw: &[u8], branch: u32) -> Result<Vec<u8>, String> {
    if raw.is_empty() || raw.len() > 2097152 { return Err("invalid transaction bytes".into()); }
    let branch = BranchId::try_from(branch).map_err(|_| "unknown context branch")?;
    let mut remaining = raw;
    let tx = Transaction::read(&mut remaining, branch).map_err(|e| format!("parse: {e}"))?;
    if !remaining.is_empty() { return Err("trailing bytes".into()); }
    if !tx.version().has_overwinter() { return Err("unsupported transaction version".into()); }
    // V5/V6 read their embedded branch and ignore the supplied context.
    if tx.consensus_branch_id() != branch { return Err("branch mismatch".into()); }
    if !tx.version().valid_in_branch(branch) { return Err("version/context mismatch".into()); }
    let mut written = Vec::new();
    tx.write(&mut written).map_err(|e| format!("write: {e}"))?;
    if written != raw { return Err("serialization differs from input".into()); }
    Ok(tx.txid().as_ref().to_vec())
}

const UPGRADES: [NetworkUpgrade; 11] = [
    NetworkUpgrade::Overwinter, NetworkUpgrade::Sapling, NetworkUpgrade::Blossom,
    NetworkUpgrade::Heartwood, NetworkUpgrade::Canopy, NetworkUpgrade::Nu5,
    NetworkUpgrade::Nu6, NetworkUpgrade::Nu6_1, NetworkUpgrade::Nu6_2, NetworkUpgrade::Nu6_3, NetworkUpgrade::Nu7,
];
const KEYS: [&str; 11] = ["Overwinter", "Sapling", "Blossom", "Heartwood", "Canopy", "Nu5", "Nu6", "Nu6_1", "Nu6_2", "Nu6_3", "Nu7"];

#[derive(Clone, Debug)]
struct Document {
    format: &'static str,
    encoding: NetworkType,
    heights: [Option<BlockHeight>; 11],
}
impl Parameters for Document {
    fn network_type(&self) -> NetworkType { self.encoding }
    fn activation_height(&self, nu: NetworkUpgrade) -> Option<BlockHeight> {
        UPGRADES.iter().position(|n| *n == nu).and_then(|i| self.heights[i])
    }
}
impl Document {
    fn parse_format(format: &str, bytes: &[u8]) -> Result<Self, &'static str> {
        let document = Self::parse(bytes)?;
        if format != document.format { return Err("unsupported network format"); }
        Ok(document)
    }

    fn parse(bytes: &[u8]) -> Result<Self, &'static str> {
        let invalid = "invalid network document";
        if bytes.len() > 256 { return Err(invalid); }
        let text = std::str::from_utf8(bytes).map_err(|_| invalid)?;
        let rest = text.strip_prefix("{\"encoding\":\"").ok_or(invalid)?;
        let (name, mut rest) = rest.split_once('"').ok_or(invalid)?;
        let encoding = match name { "main" => NetworkType::Main, "test" => NetworkType::Test, "regtest" => NetworkType::Regtest, _ => return Err(invalid) };
        let mut heights = [None; 11];
        let mut format = "zcash-js-network/2";
        let mut previous = Some(0);
        for (i, key) in KEYS.iter().enumerate() {
            // Legacy bytes remain a distinct wallet identity with NU7 inactive.
            if i == 10 && rest == "}" { format = "zcash-js-network/1"; break; }
            rest = rest.strip_prefix(&format!(",\"{key}\":")).ok_or(invalid)?;
            let end = rest.find([',', '}']).ok_or(invalid)?;
            let token = &rest[..end];
            let height = if token == "null" { None } else {
                let n = token.parse::<u32>().map_err(|_| invalid)?;
                if token != n.to_string() || previous.is_none_or(|p| n < p) { return Err(invalid); }
                Some(n)
            };
            heights[i] = height.map(BlockHeight::from_u32);
            previous = height;
            rest = &rest[end..];
        }
        if rest != "}" { return Err(invalid); }
        Ok(Self { format, encoding, heights })
    }
}

/// Validate the reviewed document and select the pinned upstream branch at height.
/// The JS entry checks types/ranges before generated glue; raw glue is internal.
pub fn consensus_branch(format: &str, bytes: &[u8], height: u32) -> Result<u32, String> {
    let document = Document::parse_format(format, bytes)?;
    Ok(u32::from(BranchId::for_height(&document, height.into())))
}

#[cfg(feature = "wallet-storage")]
#[doc(hidden)]
pub mod wallet;

#[cfg(feature = "viewing")]
pub mod viewing;

#[cfg(any(feature = "birthday", feature = "wallet-storage"))]
pub mod birthday;

#[cfg(feature = "standalone-pczt")]
pub mod standalone_pczt;

pub mod host;

#[cfg(feature = "viewing")]
pub mod transparent;

/// The exact exported surface shared by the WASM and native front-ends.
pub mod api;
