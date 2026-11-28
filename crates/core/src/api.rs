//! The exported surface. The WASM crate wraps each item with `wasm_bindgen` and the
//! native crate dispatches to them by name; names and signatures match the
//! generated JS bindings (`bindings.js`) so the same JS glue drives either one.
//! Errors are stable string codes (`Err(String)`), exactly as WASM throws them.

pub use crate::{consensus_branch, transaction_id};

#[cfg(feature = "viewing")]
pub use crate::transparent::transparent_address_decode;

#[cfg(feature = "viewing")]
pub use crate::viewing::{viewing_decode_address, viewing_open, viewing_select_receiver, ViewingHandle};

#[cfg(any(feature = "birthday", feature = "wallet-storage"))]
pub use crate::birthday::validate_birthday;

#[cfg(feature = "standalone-pczt")]
pub use crate::standalone_pczt::{parse_standalone_pczt, StandalonePczt};

#[cfg(feature = "wallet-storage")]
pub use crate::wallet::{
    account_lifecycle_call, enhancement_call, finalized_get, fused_send_call, payment_call, pczt_build_call,
    pczt_finalize_call, pczt_import_call, pczt_prove_call, proposal_call, query_call, scan_call, signer_authorize,
    signer_bind, signer_capabilities, signer_create_account, signer_describe, signer_release, signer_unbind,
    storage_binding, storage_close, storage_initialize_memory, storage_initialize_path, sync_call, views_call,
    views_mnemonic_call, views_seed_call,
};
