//! Argument/result encoding for the C ABI.
//!
//! Arguments: concatenated tagged values. Results: one status byte, then a value.
//!   0x00 none            (JS undefined / Rust None / ())
//!   0x01 u32             4 bytes little-endian
//!   0x02 string          u32 LE length + UTF-8
//!   0x03 bytes           u32 LE length + bytes
//!   0x04 bool            1 byte
//!   0x05 handle          u64 LE (native object handle)
//! Status: 0 = ok(value), 1 = error(string code, thrown as a JS string exactly like
//! wasm-bindgen), 2 = fatal(string; runtime invalid), 3 = pending (poll only),
//! 4 = error object(string message, thrown as a JS Error like wasm-bindgen JsError).

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    None,
    U32(u32),
    Str(String),
    Bytes(Vec<u8>),
    Bool(bool),
    Handle(u64),
}

pub const OK: u8 = 0;
pub const ERROR: u8 = 1;
pub const FATAL: u8 = 2;
pub const PENDING: u8 = 3;
/// Error thrown as a JS Error object (wasm-bindgen JsError), not a string.
pub const ERROR_OBJECT: u8 = 4;

/// Upper bound for one encoded argument list (largest export input is 4 MiB PCZTs).
const MAX_INPUT: usize = 64 * 1024 * 1024;

pub fn decode_args(mut input: &[u8]) -> Result<Vec<Value>, &'static str> {
    if input.len() > MAX_INPUT { return Err("RESOURCE_LIMIT"); }
    let mut values = Vec::new();
    fn take<'a>(input: &mut &'a [u8], n: usize) -> Result<&'a [u8], &'static str> {
        if input.len() < n { return Err("INVALID_ARGUMENT"); }
        let (head, rest) = input.split_at(n);
        *input = rest;
        Ok(head)
    }
    fn len(input: &mut &[u8]) -> Result<usize, &'static str> {
        Ok(u32::from_le_bytes(take(input, 4)?.try_into().unwrap()) as usize)
    }
    while !input.is_empty() {
        let tag = take(&mut input, 1)?[0];
        values.push(match tag {
            0 => Value::None,
            1 => Value::U32(u32::from_le_bytes(take(&mut input, 4)?.try_into().unwrap())),
            2 => {
                let n = len(&mut input)?;
                Value::Str(String::from_utf8(take(&mut input, n)?.to_vec()).map_err(|_| "INVALID_ARGUMENT")?)
            }
            3 => {
                let n = len(&mut input)?;
                Value::Bytes(take(&mut input, n)?.to_vec())
            }
            4 => match take(&mut input, 1)?[0] {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                _ => return Err("INVALID_ARGUMENT"),
            },
            5 => Value::Handle(u64::from_le_bytes(take(&mut input, 8)?.try_into().unwrap())),
            _ => return Err("INVALID_ARGUMENT"),
        });
    }
    Ok(values)
}

pub fn encode_value(out: &mut Vec<u8>, value: &Value) {
    match value {
        Value::None => out.push(0),
        Value::U32(n) => { out.push(1); out.extend_from_slice(&n.to_le_bytes()); }
        Value::Str(s) => { out.push(2); out.extend_from_slice(&(s.len() as u32).to_le_bytes()); out.extend_from_slice(s.as_bytes()); }
        Value::Bytes(b) => { out.push(3); out.extend_from_slice(&(b.len() as u32).to_le_bytes()); out.extend_from_slice(b); }
        Value::Bool(b) => { out.push(4); out.push(u8::from(*b)); }
        Value::Handle(h) => { out.push(5); out.extend_from_slice(&h.to_le_bytes()); }
    }
}

pub fn encode_result(status: u8, value: &Value) -> Vec<u8> {
    let mut out = vec![status];
    encode_value(&mut out, value);
    out
}

pub fn ok(value: Value) -> Vec<u8> { encode_result(OK, &value) }
pub fn error(code: impl Into<String>) -> Vec<u8> { encode_result(ERROR, &Value::Str(code.into())) }
pub fn fatal(code: impl Into<String>) -> Vec<u8> { encode_result(FATAL, &Value::Str(code.into())) }

/// Typed views over a decoded argument list; mismatches are caller errors.
pub struct Args(pub Vec<Value>);
impl Args {
    pub fn check(&self, count: usize) -> Result<(), String> {
        if self.0.len() == count { Ok(()) } else { Err("INVALID_ARGUMENT".into()) }
    }
    pub fn u32(&self, i: usize) -> Result<u32, String> {
        match self.0.get(i) { Some(Value::U32(n)) => Ok(*n), _ => Err("INVALID_ARGUMENT".into()) }
    }
    pub fn opt_u32(&self, i: usize) -> Result<Option<u32>, String> {
        match self.0.get(i) { Some(Value::U32(n)) => Ok(Some(*n)), Some(Value::None) => Ok(None), _ => Err("INVALID_ARGUMENT".into()) }
    }
    pub fn str(&self, i: usize) -> Result<&str, String> {
        match self.0.get(i) { Some(Value::Str(s)) => Ok(s), _ => Err("INVALID_ARGUMENT".into()) }
    }
    pub fn bytes(&self, i: usize) -> Result<&[u8], String> {
        match self.0.get(i) { Some(Value::Bytes(b)) => Ok(b), _ => Err("INVALID_ARGUMENT".into()) }
    }
    pub fn opt_bytes(&self, i: usize) -> Result<Option<&[u8]>, String> {
        match self.0.get(i) { Some(Value::Bytes(b)) => Ok(Some(b)), Some(Value::None) => Ok(None), _ => Err("INVALID_ARGUMENT".into()) }
    }
    pub fn handle(&self, i: usize) -> Result<u64, String> {
        match self.0.get(i) { Some(Value::Handle(h)) => Ok(*h), _ => Err("INVALID_ARGUMENT".into()) }
    }
    /// Move a byte argument out, so secret buffers can be zeroized by the callee.
    pub fn take_bytes(&mut self, i: usize) -> Result<Vec<u8>, String> {
        match self.0.get_mut(i) { Some(Value::Bytes(b)) => Ok(std::mem::take(b)), _ => Err("INVALID_ARGUMENT".into()) }
    }
}

impl Drop for Args {
    // Arguments may carry mnemonics, seeds and passphrases; never leave copies behind.
    fn drop(&mut self) {
        for value in &mut self.0 {
            match value {
                Value::Bytes(b) => b.iter_mut().for_each(|x| *x = 0),
                Value::Str(s) => unsafe { s.as_bytes_mut().iter_mut().for_each(|x| *x = 0) },
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trips_every_tag_and_rejects_truncation() {
        let values = vec![Value::None, Value::U32(7), Value::Str("é".into()), Value::Bytes(vec![1, 2]), Value::Bool(true), Value::Handle(u64::MAX)];
        let mut out = Vec::new();
        for v in &values { encode_value(&mut out, v); }
        assert_eq!(decode_args(&out).unwrap(), values);
        for cut in 1..out.len() {
            let truncated = &out[..cut];
            // Every strict prefix either decodes to fewer values or is rejected.
            if let Ok(decoded) = decode_args(truncated) { assert!(decoded.len() < values.len()); }
        }
        assert!(decode_args(&[9]).is_err());
        assert!(decode_args(&[4, 2]).is_err());
        assert!(decode_args(&[2, 1, 0, 0, 0, 0xff]).is_err());
    }
}
