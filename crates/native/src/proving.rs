//! Proving parameters loaded and verified natively, referenced by a short token.
//!
//! Passing ~50 MB of Sapling parameters through JS on every proof is wasteful on
//! mobile. `proving_load(path, sha256, length)` reads and verifies a file once and
//! returns a token; proving calls accept either the raw bytes or that token.
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};

const MAGIC: &[u8; 8] = b"ZBPARAM1";
static CACHE: Mutex<Option<HashMap<[u8; 32], Arc<Vec<u8>>>>> = Mutex::new(None);
const MAX_LENGTH: u64 = 256 * 1024 * 1024;

pub enum Params<'a> { Borrowed(&'a [u8]), Shared(Arc<Vec<u8>>) }
impl std::ops::Deref for Params<'_> {
    type Target = [u8];
    fn deref(&self) -> &[u8] { match self { Params::Borrowed(b) => b, Params::Shared(s) => s } }
}

/// Resolve proving-parameter argument bytes: a token from `load`, or the bytes themselves.
pub fn resolve(bytes: &[u8]) -> Result<Params<'_>, String> {
    if bytes.len() == 40 && &bytes[..8] == MAGIC {
        let digest: [u8; 32] = bytes[8..].try_into().unwrap();
        let cache = CACHE.lock().map_err(|_| "DOMAIN_INVALID")?;
        return cache.as_ref().and_then(|c| c.get(&digest).cloned()).map(Params::Shared).ok_or_else(|| "PROVING_MATERIAL_REQUIRED".into());
    }
    Ok(Params::Borrowed(bytes))
}

fn decode_hex(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 { return None; }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() { *byte = u8::from_str_radix(hex.get(2 * i..2 * i + 2)?, 16).ok()?; }
    Some(out)
}

/// Read `path`, require exact `length` and `sha256` (lowercase hex), cache, return token.
pub fn load(path: &str, sha256: &str, length: u32) -> Result<Vec<u8>, String> {
    let expected = decode_hex(sha256).ok_or("INVALID_ARGUMENT")?;
    if u64::from(length) > MAX_LENGTH { return Err("RESOURCE_LIMIT".into()); }
    let mut token = MAGIC.to_vec();
    token.extend_from_slice(&expected);
    if CACHE.lock().map_err(|_| "DOMAIN_INVALID")?.as_ref().is_some_and(|c| c.contains_key(&expected)) { return Ok(token); }
    let file = std::fs::File::open(path).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "ASSET_UNAVAILABLE" } else { "ASSET_INTEGRITY" })?;
    let mut bytes = Vec::with_capacity(length as usize);
    // Read one byte past the expected length to detect oversized files.
    file.take(u64::from(length) + 1).read_to_end(&mut bytes).map_err(|_| "ASSET_INTEGRITY")?;
    if bytes.len() != length as usize || Sha256::digest(&bytes).as_slice() != expected { return Err("ASSET_INTEGRITY".into()); }
    CACHE.lock().map_err(|_| "DOMAIN_INVALID")?.get_or_insert_with(HashMap::new).insert(expected, Arc::new(bytes));
    Ok(token)
}

/// SHA-256 of a file, streamed (download verification without loading into JS).
pub fn file_sha256(path: &str) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "ASSET_UNAVAILABLE")?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buffer).map_err(|_| "ASSET_INTEGRITY")?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

pub fn unload_all() { if let Ok(mut c) = CACHE.lock() { c.take(); } }
