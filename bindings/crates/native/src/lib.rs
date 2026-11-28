//! Native front-end for zakura-bindings-core.
//!
//! A small C ABI (see `include/zakura_native.h`) carries the same functions,
//! argument orders and string error codes as the wasm-bindgen exports, so the
//! zcash.js glue runs unchanged on React Native (JSI) and in host tests (FFI).
pub mod wire;
mod dispatch;
mod runtime;
mod proving;
#[cfg(feature = "wallet")]
mod storage;
#[cfg(feature = "wallet")]
mod vfs;
pub mod ffi;

/// Version of the C ABI and argument encoding. Bump on incompatible change.
pub const ABI_VERSION: u32 = 1;

/// Build identity reported to the zcash.js loader, which compares it with the
/// native profile it was built against (native code ships inside the app binary,
/// so it is identified rather than hash-checked like WASM bytes).
pub fn identity() -> String {
    serde_json::json!({
        "format": "zakura-native/1",
        "abiVersion": ABI_VERSION,
        "crate": env!("CARGO_PKG_VERSION"),
        "revision": option_env!("ZAKURA_NATIVE_REVISION").unwrap_or("unversioned"),
        "dependencyGraphSha256": option_env!("ZAKURA_NATIVE_GRAPH_SHA256").unwrap_or("unversioned"),
        "target": format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS),
        "wallet": cfg!(feature = "wallet"),
    }).to_string()
}

/// Rust-level entry used by tests and embedders: run one call to completion.
pub fn call(runtime: u64, name: &str, args: &[u8]) -> Vec<u8> {
    match wire::decode_args(args) {
        Ok(values) => runtime::wait(runtime::start(runtime, name.to_owned(), wire::Args(values))),
        Err(code) => wire::error(code),
    }
}
/// Start a call and return its ticket (see `poll`).
pub fn start(runtime: u64, name: &str, args: &[u8]) -> u64 {
    match wire::decode_args(args) {
        Ok(values) => runtime::start(runtime, name.to_owned(), wire::Args(values)),
        Err(code) => runtime::start(0, "__invalid".into(), wire::Args(vec![wire::Value::Str(code.into())])),
    }
}
pub use runtime::{create as runtime_create, destroy as runtime_destroy, poll};
