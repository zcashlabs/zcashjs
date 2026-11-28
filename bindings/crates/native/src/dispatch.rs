//! Name-based dispatch onto `zakura_bindings_core::api`. Names and argument orders
//! match the wasm-bindgen exports, so the JS binding shim mirrors `bindings.js`.
use crate::wire::{Args, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use zakura_bindings_core::api;

type Outcome = Result<Value, String>;

// ---- native objects (wasm-bindgen classes) --------------------------------------

enum Object {
    Viewing(api::ViewingHandle),
    Pczt(api::StandalonePczt),
}
static OBJECTS: Mutex<Option<HashMap<u64, Object>>> = Mutex::new(None);
static NEXT_OBJECT: AtomicU64 = AtomicU64::new(1);
const MAX_OBJECTS: usize = 4096;

fn store(object: Object) -> Outcome {
    let mut table = OBJECTS.lock().map_err(|_| "DOMAIN_INVALID")?;
    let table = table.get_or_insert_with(HashMap::new);
    if table.len() >= MAX_OBJECTS { return Err("RESOURCE_LIMIT".into()); }
    let id = NEXT_OBJECT.fetch_add(1, Ordering::Relaxed);
    table.insert(id, object);
    Ok(Value::Handle(id))
}
fn with<T>(id: u64, f: impl FnOnce(&Object) -> Result<T, String>) -> Result<T, String> {
    let table = OBJECTS.lock().map_err(|_| "DOMAIN_INVALID")?;
    // A freed handle is a JS-side use-after-free, which the glue reports as CLOSED.
    let object = table.as_ref().and_then(|t| t.get(&id)).ok_or("CLOSED")?;
    f(object)
}
fn viewing<T>(id: u64, f: impl FnOnce(&api::ViewingHandle) -> Result<T, String>) -> Result<T, String> {
    with(id, |o| match o { Object::Viewing(v) => f(v), _ => Err("INVALID_ARGUMENT".into()) })
}
fn pczt<T>(id: u64, f: impl FnOnce(&api::StandalonePczt) -> Result<T, String>) -> Result<T, String> {
    with(id, |o| match o { Object::Pczt(p) => f(p), _ => Err("INVALID_ARGUMENT".into()) })
}
fn free(id: u64) -> Outcome {
    let mut table = OBJECTS.lock().map_err(|_| "DOMAIN_INVALID")?;
    table.as_mut().and_then(|t| t.remove(&id));
    Ok(Value::None)
}

pub fn live_objects() -> usize {
    OBJECTS.lock().map(|t| t.as_ref().map_or(0, HashMap::len)).unwrap_or(0)
}

// ---- helpers --------------------------------------------------------------------

fn s(r: Result<String, String>) -> Outcome { r.map(Value::Str) }
fn b(r: Result<Vec<u8>, String>) -> Outcome { r.map(Value::Bytes) }
fn unit(r: Result<(), String>) -> Outcome { r.map(|()| Value::None) }

/// Error raised as a JS Error object (wasm-bindgen `JsError`), not a string code.
pub struct ErrorObject(pub String);

/// Functions that need no wallet owner. Returns None for unknown names.
pub fn stateless(name: &str, a: &Args) -> Option<Result<Outcome, ErrorObject>> {
    let r = match name {
        "transaction_id" => a.check(2).and_then(|()| b(api::transaction_id(a.bytes(0)?, a.u32(1)?))),
        "consensus_branch" => a.check(3).and_then(|()| api::consensus_branch(a.str(0)?, a.bytes(1)?, a.u32(2)?).map(Value::U32)),
        "viewing_open" => a.check(4).and_then(|()| api::viewing_open(a.bytes(0)?, a.str(1)?, a.str(2)?, a.str(3)?).and_then(|h| store(Object::Viewing(h)))),
        "viewing_decode_address" => a.check(2).and_then(|()| s(api::viewing_decode_address(a.bytes(0)?, a.str(1)?))),
        "viewing_select_receiver" => a.check(5).and_then(|()| s(api::viewing_select_receiver(a.bytes(0)?, a.str(1)?, a.str(2)?, a.u32(3)?, a.u32(4)?))),
        "validate_birthday" => a.check(5).and_then(|()| unit(api::validate_birthday(a.bytes(0)?, a.bytes(1)?, a.u32(2)?, a.bytes(3)?, a.opt_u32(4)?))),
        "parse_standalone_pczt" => a.check(6).and_then(|()| api::parse_standalone_pczt(a.bytes(0)?, a.bytes(1)?, a.u32(2)?, a.u32(3)?, a.bytes(4)?, a.u32(5)?).and_then(|p| store(Object::Pczt(p)))),
        "ViewingHandle.describe" => a.check(1).and_then(|()| viewing(a.handle(0)?, |v| Ok(Value::Str(v.describe())))),
        "ViewingHandle.export" => a.check(3).and_then(|()| viewing(a.handle(0)?, |v| s(v.export(a.str(1)?, a.str(2)?)))),
        "ViewingHandle.to_incoming" => a.check(1).and_then(|()| { let h = viewing(a.handle(0)?, |v| Ok(v.to_incoming()))?; store(Object::Viewing(h)) }),
        "ViewingHandle.derive" => a.check(3).and_then(|()| viewing(a.handle(0)?, |v| s(v.derive(a.str(1)?, a.str(2)?)))),
        "ViewingHandle.find" => a.check(4).and_then(|()| viewing(a.handle(0)?, |v| s(v.find(a.str(1)?, a.str(2)?, a.u32(3)?)))),
        "StandalonePczt.serialize" => a.check(1).and_then(|()| pczt(a.handle(0)?, |p| b(p.serialize()))),
        "StandalonePczt.inspect" => a.check(1).and_then(|()| pczt(a.handle(0)?, |p| s(p.inspect()))),
        "StandalonePczt.combine" => a.check(2).and_then(|()| {
            let (left, right) = (a.handle(0)?, a.handle(1)?);
            // Hold the table once: both operands must be live PCZT objects.
            let combined = {
                let table = OBJECTS.lock().map_err(|_| "DOMAIN_INVALID")?;
                let get = |id| table.as_ref().and_then(|t| t.get(&id)).ok_or(String::from("CLOSED"));
                match (get(left)?, get(right)?) {
                    (Object::Pczt(l), Object::Pczt(r)) => l.combine(r)?,
                    _ => return Err("INVALID_ARGUMENT".into()),
                }
            };
            store(Object::Pczt(combined))
        }),
        "StandalonePczt.redact" => a.check(2).and_then(|()| { let p = pczt(a.handle(0)?, |p| p.redact(a.str(1)?))?; store(Object::Pczt(p)) }),
        "free" => a.check(1).and_then(|()| free(a.handle(0)?)),
        "lightwire_encode" => a.check(2).and_then(|()| b(zakura_lightwire::encode_request(a.str(0)?, a.str(1)?))),
        "lightwire_decode" => a.check(3).and_then(|()| {
            let item = match a.0.get(2) { Some(Value::Bool(v)) => *v, _ => return Err("INVALID_ARGUMENT".into()) };
            let (method, bytes) = (a.str(0)?, a.bytes(1)?);
            s(if item { zakura_lightwire::decode_item(method, bytes) } else { zakura_lightwire::decode_response(method, bytes) })
        }),
        "lightwire_encode_tree_state" => a.check(1).and_then(|()| b(zakura_lightwire::encode_tree_state(a.str(0)?))),
        "transparent_address_decode" => {
            let (token, family) = match (a.str(0), a.str(1)) { (Ok(t), Ok(f)) if a.0.len() == 2 => (t, f), _ => return Some(Ok(Err("INVALID_ARGUMENT".into()))) };
            return Some(api::transparent_address_decode(token, family).map(|bytes| Ok(Value::Bytes(bytes))).map_err(|m| ErrorObject(m.into())));
        }
        "sha256" => a.check(1).and_then(|()| {
            use sha2::Digest;
            Ok(Value::Bytes(sha2::Sha256::digest(a.bytes(0)?).to_vec()))
        }),
        "random_bytes" => a.check(1).and_then(|()| {
            let n = a.u32(0)? as usize;
            if n > 65536 { return Err("RESOURCE_LIMIT".into()); }
            let mut bytes = vec![0; n];
            getrandom::fill(&mut bytes).map_err(|_| "ENTROPY_UNAVAILABLE")?;
            Ok(Value::Bytes(bytes))
        }),
        "object_count" => a.check(0).map(|()| Value::U32(live_objects() as u32)),
        "identity" => a.check(0).map(|()| Value::Str(crate::identity())),
        "proving_load" => a.check(3).and_then(|()| crate::proving::load(a.str(0)?, a.str(1)?, a.u32(2)?).map(Value::Bytes)),
        "proving_unload" => a.check(0).map(|()| { crate::proving::unload_all(); Value::None }),
        "file_append" => a.check(2).and_then(|()| crate::proving::file_append(a.str(0)?, a.bytes(1)?).map(|()| Value::None)),
        "file_size" => a.check(1).and_then(|()| crate::proving::file_size(a.str(0)?).map(|n| n.map_or(Value::None, Value::U32))),
        "file_remove" => a.check(1).and_then(|()| crate::proving::file_remove(a.str(0)?).map(|()| Value::None)),
        "file_commit" => a.check(2).and_then(|()| crate::proving::file_commit(a.str(0)?, a.str(1)?).map(|()| Value::None)),
        "file_sha256" => a.check(1).and_then(|()| crate::proving::file_sha256(a.str(0)?).map(Value::Str)),
        "__invalid" => Err(a.str(0).map(String::from).unwrap_or_else(|e| e)),
        _ => return None,
    };
    Some(Ok(r))
}

/// Functions that run on a runtime's owner thread (thread-local wallet/signer state).
#[cfg(feature = "wallet")]
pub fn owned(name: &str, a: &mut Args) -> Option<Outcome> {
    let r = match name {
        "storage_initialize_native" => a.check(5).and_then(|()| {
            let key = a.opt_bytes(4)?.map(<[u8]>::to_vec);
            crate::storage::open(a.str(0)?, a.str(1)?, a.bytes(2)?, a.bytes(3)?, key).map(Value::U32)
        }),
        "storage_initialize_memory" => a.check(3).and_then(|()| {
            crate::storage::install_host()?;
            api::storage_initialize_memory(a.str(0)?, a.bytes(1)?, a.bytes(2)?).map(Value::U32)
        }),
        "storage_binding" => a.check(1).and_then(|()| b(api::storage_binding(a.u32(0)?))),
        "storage_close" => a.check(1).and_then(|()| crate::storage::close(a.u32(0)?).map(|()| Value::None)),
        "views_call" | "payment_call" | "scan_call" | "sync_call" | "query_call" | "enhancement_call" | "proposal_call"
        | "pczt_build_call" | "account_lifecycle_call" => a.check(3).and_then(|()| {
            let f = match name {
                "views_call" => api::views_call, "payment_call" => api::payment_call, "scan_call" => api::scan_call,
                "sync_call" => api::sync_call, "query_call" => api::query_call, "enhancement_call" => api::enhancement_call,
                "proposal_call" => api::proposal_call, "pczt_build_call" => api::pczt_build_call,
                _ => api::account_lifecycle_call,
            };
            s(f(a.u32(0)?, a.str(1)?, a.str(2)?))
        }),
        "views_seed_call" => a.check(4).and_then(|()| { let seed = a.take_bytes(3)?; s(api::views_seed_call(a.u32(0)?, a.str(1)?, a.str(2)?, seed)) }),
        "views_mnemonic_call" => a.check(4).and_then(|()| {
            let (mnemonic, passphrase) = (a.take_bytes(2)?, a.take_bytes(3)?);
            s(api::views_mnemonic_call(a.u32(0)?, a.str(1)?, mnemonic, passphrase))
        }),
        "pczt_import_call" => a.check(4).and_then(|()| s(api::pczt_import_call(a.u32(0)?, a.str(1)?, a.bytes(2)?, a.u32(3)?))),
        "pczt_prove_call" | "pczt_finalize_call" => a.check(6).and_then(|()| {
            let (spend, output) = (crate::proving::resolve(a.bytes(3)?)?, crate::proving::resolve(a.bytes(4)?)?);
            let f = if name == "pczt_prove_call" { api::pczt_prove_call } else { api::pczt_finalize_call };
            s(f(a.u32(0)?, a.str(1)?, a.str(2)?, &spend, &output, a.u32(5)?))
        }),
        "finalized_get" => a.check(2).and_then(|()| s(api::finalized_get(a.u32(0)?, a.str(1)?))),
        "fused_send_call" => a.check(8).and_then(|()| {
            let (spend, output) = (crate::proving::resolve(a.bytes(5)?)?, crate::proving::resolve(a.bytes(6)?)?);
            s(api::fused_send_call(a.u32(0)?, a.str(1)?, a.str(2)?, a.str(3)?, a.u32(4)?, &spend, &output, a.u32(7)?))
        }),
        "signer_create_account" => a.check(5).and_then(|()| {
            let (mnemonic, passphrase) = (a.take_bytes(3)?, a.take_bytes(4)?);
            s(api::signer_create_account(a.u32(0)?, a.str(1)?, a.str(2)?, mnemonic, passphrase))
        }),
        "signer_describe" => a.check(1).and_then(|()| s(api::signer_describe(a.u32(0)?))),
        "signer_capabilities" => a.check(1).and_then(|()| s(api::signer_capabilities(a.u32(0)?))),
        "signer_release" => a.check(1).and_then(|()| unit(api::signer_release(a.u32(0)?))),
        "signer_bind" => a.check(3).and_then(|()| s(api::signer_bind(a.u32(0)?, a.u32(1)?, a.str(2)?))),
        "signer_unbind" => a.check(3).and_then(|()| unit(api::signer_unbind(a.u32(0)?, a.u32(1)?, a.str(2)?))),
        "signer_authorize" => a.check(7).and_then(|()| b(api::signer_authorize(a.u32(0)?, a.bytes(1)?, a.bytes(2)?, a.u32(3)?, a.u32(4)?, a.bytes(5)?, a.u32(6)?))),
        _ => return None,
    };
    Some(r)
}
