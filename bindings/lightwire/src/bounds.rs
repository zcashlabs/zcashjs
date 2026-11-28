//! Allocation-free framing checks run before prost. Limits are codec policy, not consensus.
pub const MAX_MESSAGE: usize = 4 * 1024 * 1024;
pub const MAX_FIELD: usize = 1024 * 1024;
pub const MAX_ITEMS: usize = 8192;
pub const MAX_DEPTH: usize = 16;
pub struct Field { pub tag: u32, pub name: &'static str, pub kind: &'static str, pub repeated: bool }
include!("schema.rs");
fn err<T>() -> Result<T, String> { Err("invalid or resource-limited protobuf".into()) }
fn varint(b: &[u8], p: &mut usize) -> Result<u64, String> {
    let mut n = 0;
    for i in 0..10 {
        let c = *b.get(*p).ok_or("truncated varint")?; *p += 1;
        if i == 9 && c > 1 { return err(); }
        n |= u64::from(c & 127) << (i * 7);
        if c < 128 { return Ok(n); }
    }
    err()
}
fn take<'a>(b: &'a [u8], p: &mut usize, n: usize) -> Result<&'a [u8], String> {
    let end = p.checked_add(n).ok_or("length overflow")?;
    let part = b.get(*p..end).ok_or("truncated field")?; *p = end; Ok(part)
}
fn scalar(kind: &str, n: u64) -> Result<(), String> {
    match kind {
        "uint32" if n > u32::MAX as u64 => err(),
        "int32" if n > i32::MAX as u64 && n < (i32::MIN as i64) as u64 => err(),
        _ => Ok(()),
    }
}
fn is_scalar(k: &str) -> bool { matches!(k, "uint32" | "uint64" | "int32" | "int64" | "bool") }
fn walk(b: &[u8], p: &mut usize, name: &str, depth: usize, count: &mut usize, group: Option<u32>) -> Result<(), String> {
    if depth > MAX_DEPTH { return err(); }
    while *p < b.len() {
        *count += 1;
        if *count > MAX_ITEMS { return err(); }
        let key = varint(b,p)?;
        let tag = key >> 3; let wire = key & 7;
        if tag == 0 || tag > 0x1fff_ffff { return err(); }
        if wire == 4 { return if group == Some(tag as u32) { Ok(()) } else { err() }; }
        let f = fields(name).iter().find(|f| u64::from(f.tag) == tag);
        if let Some(f) = f {
            let expected = if is_scalar(f.kind) { 0 } else { 2 };
            if wire != expected && !(wire == 2 && expected == 0 && f.repeated) { return err(); }
        }
        match wire {
            0 => { let n = varint(b,p)?; if let Some(f) = f { scalar(f.kind,n)?; } },
            1 => { take(b,p,8)?; },
            2 => {
                let n = usize::try_from(varint(b,p)?).map_err(|_| "length overflow")?;
                if n > MAX_FIELD { return err(); }
                let part = take(b,p,n)?;
                if let Some(f) = f {
                    if f.kind == "string" { std::str::from_utf8(part).map_err(|_| "invalid UTF-8")?; }
                    else if is_scalar(f.kind) {
                        let mut q = 0;
                        while q < part.len() { *count += 1; if *count > MAX_ITEMS { return err(); } scalar(f.kind,varint(part,&mut q)?)?; }
                    } else if f.kind != "bytes" { walk(part,&mut 0,f.kind,depth+1,count,None)?; }
                }
            },
            3 if f.is_none() => { walk(b,p,"",depth+1,count,Some(tag as u32))?; },
            5 => { take(b,p,4)?; },
            _ => return err(),
        }
    }
    if group.is_some() { err() } else { Ok(()) }
}
pub fn wire(bytes: &[u8], name: &str) -> Result<(), String> {
    if bytes.len() > MAX_MESSAGE { return err(); }
    walk(bytes,&mut 0,name,0,&mut 0,None)
}
/// Bound JSON before serde allocates strings, vectors or trees.
pub fn json(text: &str, name: &str) -> Result<(), String> {
    if text.len() > MAX_MESSAGE * 2 || !text.trim_start().starts_with('{') { return Err("expected bounded DTO record".into()); }
    let (mut quoted,mut escaped,mut len,mut depth,mut items) = (false,false,0usize,0usize,0usize);
    for c in text.bytes() {
        if quoted {
            len += 1;
            if len > MAX_FIELD*2+1 { return Err("DTO string limit".into()); }
            if escaped { escaped=false; } else if c==b'\\' { escaped=true; } else if c==b'"' { quoted=false; }
        } else {
            match c {
                b'"' => { quoted=true;len=0; },
                b'{' | b'[' => { depth+=1;items+=1; if depth > MAX_DEPTH { return Err("DTO depth limit".into()); } },
                b'}' | b']' => { depth=depth.saturating_sub(1); },
                b',' => items+=1,
                _ => {},
            }
            if items > MAX_ITEMS { return Err("DTO item limit".into()); }
        }
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    record(&value,name)
}
fn record(value: &serde_json::Value, name: &str) -> Result<(), String> {
    let map = value.as_object().ok_or("expected DTO record")?;
    for (key,value) in map {
        let f = fields(name).iter().find(|f| f.name == key).ok_or("unknown DTO field")?;
        if f.repeated {
            for item in value.as_array().ok_or("expected DTO array")? { field(item,f.kind)?; }
        } else if value.is_null() && !is_scalar(f.kind) && f.kind != "bytes" && f.kind != "string" {} else { field(value,f.kind)?; }
    }
    Ok(())
}
fn field(v: &serde_json::Value, k: &str) -> Result<(), String> {
    if k == "bytes" || k == "string" {
        let s = v.as_str().ok_or("expected DTO string")?;
        if s.len() > MAX_FIELD * if k == "bytes" { 2 } else { 1 } { return Err("DTO field limit".into()); }
        Ok(())
    } else if is_scalar(k) { Ok(()) } else { record(v,k) }
}
