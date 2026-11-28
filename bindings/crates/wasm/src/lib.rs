//! wasm-bindgen front-end. Every export forwards to `zakura_bindings_core::api` with
//! the same name and signature, so the generated `bindings.js` keeps its interface.
use wasm_bindgen::prelude::*;
use zakura_bindings_core::api;

type Result<T> = std::result::Result<T, String>;

#[cfg(feature = "wallet-threaded")]
mod wallet_threads;

/// Host services provided by the wallet adapter (`wallet-host/adapter.c`) and JS host.
#[cfg(feature = "wallet-storage")]
struct WasmHost;

#[cfg(feature = "wallet-storage")]
impl zakura_bindings_core::host::Host for WasmHost {
    fn now(&self) -> std::time::SystemTime {
        #[cfg(target_arch = "wasm32")]
        {
            unsafe extern "C" { fn wallet_time() -> f64; }
            let ms = unsafe { wallet_time() };
            assert!(ms.is_finite() && (0.0..8e15).contains(&ms), "clock unavailable");
            std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms as u64)
        }
        #[cfg(not(target_arch = "wasm32"))]
        { std::time::SystemTime::now() }
    }
    fn open(&self, path: &str, flags: rusqlite::OpenFlags) -> rusqlite::Result<rusqlite::Connection> {
        #[cfg(target_arch = "wasm32")]
        { rusqlite::Connection::open_with_flags_and_vfs(path, flags, "storage-host") }
        #[cfg(not(target_arch = "wasm32"))]
        { rusqlite::Connection::open_with_flags(path, flags) }
    }
    fn configure(&self, _conn: &rusqlite::Connection, _memory: bool) -> std::result::Result<(), ()> {
        #[cfg(target_arch = "wasm32")]
        {
            unsafe extern "C" { fn wallet_policy(conn: *mut rusqlite::ffi::sqlite3, memory: i32) -> i32; }
            if unsafe { wallet_policy(_conn.handle(), i32::from(_memory)) } != 0 { return Err(()); }
        }
        Ok(())
    }
    fn threads_ready(&self) {
        #[cfg(feature = "wallet-threaded")]
        wallet_threads::assert_ready();
    }
}

#[cfg(feature = "wallet-storage")]
fn wallet_host_ready() -> Result<()> {
    static HOST: WasmHost = WasmHost;
    zakura_bindings_core::host::install(&HOST).map_err(String::from)?;
    #[cfg(target_arch = "wasm32")]
    {
        unsafe extern "C" { fn wallet_ready() -> i32; }
        if unsafe { wallet_ready() } != 1 { return Err("RUNTIME_UNAVAILABLE".into()); }
    }
    Ok(())
}

// ---- stateless codecs ----------------------------------------------------------

#[wasm_bindgen]
pub fn transaction_id(raw: &[u8], branch: u32) -> Result<Vec<u8>> { api::transaction_id(raw, branch) }

#[wasm_bindgen]
pub fn consensus_branch(format: &str, bytes: &[u8], height: u32) -> Result<u32> { api::consensus_branch(format, bytes, height) }

#[cfg(feature = "viewing")]
#[wasm_bindgen]
pub struct ViewingHandle(api::ViewingHandle);

#[cfg(feature = "viewing")]
#[wasm_bindgen]
impl ViewingHandle {
    pub fn describe(&self) -> String { self.0.describe() }
    pub fn export(&self, format: &str, acknowledge: &str) -> Result<String> { self.0.export(format, acknowledge) }
    pub fn to_incoming(&self) -> ViewingHandle { ViewingHandle(self.0.to_incoming()) }
    pub fn derive(&self, index: &str, request: &str) -> Result<String> { self.0.derive(index, request) }
    pub fn find(&self, start: &str, request: &str, max_attempts: u32) -> Result<String> { self.0.find(start, request, max_attempts) }
}

#[cfg(feature = "viewing")]
#[wasm_bindgen]
pub fn viewing_open(parameters: &[u8], format: &str, encoded: &str, pools: &str) -> Result<ViewingHandle> {
    api::viewing_open(parameters, format, encoded, pools).map(ViewingHandle)
}

#[cfg(feature = "viewing")]
#[wasm_bindgen]
pub fn viewing_decode_address(parameters: &[u8], encoded: &str) -> Result<String> { api::viewing_decode_address(parameters, encoded) }

#[cfg(feature = "viewing")]
#[wasm_bindgen]
pub fn viewing_select_receiver(parameters: &[u8], encoded: &str, pool: &str, height: u32, branch: u32) -> Result<String> {
    api::viewing_select_receiver(parameters, encoded, pool, height, branch)
}

#[cfg(any(feature = "birthday", feature = "wallet-storage"))]
#[wasm_bindgen]
pub fn validate_birthday(parameters: &[u8], genesis: &[u8], first: u32, tree: &[u8], recover: Option<u32>) -> Result<()> {
    api::validate_birthday(parameters, genesis, first, tree, recover)
}

#[cfg(feature = "standalone-pczt")]
#[wasm_bindgen]
pub struct StandalonePczt(api::StandalonePczt);

#[cfg(feature = "standalone-pczt")]
#[wasm_bindgen]
impl StandalonePczt {
    pub fn serialize(&self) -> Result<Vec<u8>> { self.0.serialize() }
    pub fn inspect(&self) -> Result<String> { self.0.inspect() }
    pub fn combine(&self, other: &StandalonePczt) -> Result<StandalonePczt> { self.0.combine(&other.0).map(StandalonePczt) }
    pub fn redact(&self, profile: &str) -> Result<StandalonePczt> { self.0.redact(profile).map(StandalonePczt) }
}

#[cfg(feature = "standalone-pczt")]
#[wasm_bindgen]
pub fn parse_standalone_pczt(parameters: &[u8], genesis: &[u8], height: u32, branch: u32, bytes: &[u8], maximum: u32) -> Result<StandalonePczt> {
    api::parse_standalone_pczt(parameters, genesis, height, branch, bytes, maximum).map(StandalonePczt)
}

// ---- wallet storage owner -----------------------------------------------------

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn storage_initialize(format: &str, bytes: &[u8], genesis: &[u8]) -> Result<u32> {
    wallet_host_ready()?;
    api::storage_initialize_path("/wallet.db", format, bytes, genesis)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn storage_initialize_memory(format: &str, bytes: &[u8], genesis: &[u8]) -> Result<u32> {
    wallet_host_ready()?;
    api::storage_initialize_memory(format, bytes, genesis)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn storage_binding(generation: u32) -> Result<Vec<u8>> { api::storage_binding(generation) }

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn storage_close(generation: u32) -> Result<()> { api::storage_close(generation) }

/// `(generation, operation, input-json) -> output-json` wallet entries.
macro_rules! calls {
    ($($name:ident),* $(,)?) => {$(
        #[cfg(feature = "wallet-storage")]
        #[wasm_bindgen]
        pub fn $name(generation: u32, operation: &str, input: &str) -> Result<String> { api::$name(generation, operation, input) }
    )*};
}
calls!(views_call, payment_call, scan_call, sync_call, query_call, enhancement_call, proposal_call, pczt_build_call, account_lifecycle_call);

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn views_seed_call(generation: u32, operation: &str, input: &str, seed: Vec<u8>) -> Result<String> {
    api::views_seed_call(generation, operation, input, seed)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn views_mnemonic_call(generation: u32, input: &str, mnemonic: Vec<u8>, passphrase: Vec<u8>) -> Result<String> {
    api::views_mnemonic_call(generation, input, mnemonic, passphrase)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn pczt_import_call(generation: u32, operation_id: &str, bytes: &[u8], maximum: u32) -> Result<String> {
    api::pczt_import_call(generation, operation_id, bytes, maximum)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn pczt_prove_call(generation: u32, operation_id: &str, artifact_id: &str, spend: &[u8], output: &[u8], maximum: u32) -> Result<String> {
    api::pczt_prove_call(generation, operation_id, artifact_id, spend, output, maximum)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn pczt_finalize_call(generation: u32, operation_id: &str, artifact_id: &str, spend: &[u8], output: &[u8], maximum: u32) -> Result<String> {
    api::pczt_finalize_call(generation, operation_id, artifact_id, spend, output, maximum)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn finalized_get(generation: u32, operation_id: &str) -> Result<String> { api::finalized_get(generation, operation_id) }

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn fused_send_call(generation: u32, operation_id: &str, proposal_id: &str, review_commitment: &str, token: u32, spend: &[u8], output: &[u8], maximum: u32) -> Result<String> {
    api::fused_send_call(generation, operation_id, proposal_id, review_commitment, token, spend, output, maximum)
}

// ---- signer owner -----------------------------------------------------------------

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn signer_create_account(generation: u32, operation: &str, input: &str, mnemonic: Vec<u8>, passphrase: Vec<u8>) -> Result<String> {
    api::signer_create_account(generation, operation, input, mnemonic, passphrase)
}

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn signer_describe(token: u32) -> Result<String> { api::signer_describe(token) }

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn signer_capabilities(token: u32) -> Result<String> { api::signer_capabilities(token) }

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn signer_release(token: u32) -> Result<()> { api::signer_release(token) }

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn signer_bind(token: u32, generation: u32, account_id: &str) -> Result<String> { api::signer_bind(token, generation, account_id) }

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn signer_unbind(token: u32, generation: u32, account_id: &str) -> Result<()> { api::signer_unbind(token, generation, account_id) }

#[cfg(feature = "wallet-storage")]
#[wasm_bindgen]
pub fn signer_authorize(token: u32, parameters: &[u8], genesis: &[u8], height: u32, branch: u32, bytes: &[u8], maximum: u32) -> Result<Vec<u8>> {
    api::signer_authorize(token, parameters, genesis, height, branch, bytes, maximum)
}
