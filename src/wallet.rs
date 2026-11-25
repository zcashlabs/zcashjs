//! Private storage lifecycle only; not H1 wallet_open or operation recovery.
use std::{cell::RefCell, rc::Rc};
use rusqlite::{Connection, OpenFlags};
use wasm_bindgen::prelude::*;
use zcash_client_sqlite::{WalletDb, util::Clock, wallet::init::WalletMigrator};

#[derive(Clone)]
struct HostClock;
impl Clock for HostClock {
    fn now(&self) -> std::time::SystemTime {
        #[cfg(not(target_arch = "wasm32"))]
        { std::time::SystemTime::now() }
        #[cfg(target_arch = "wasm32")]
        {
            unsafe extern "C" { fn wallet_time() -> f64; }
            let ms = unsafe { wallet_time() };
            assert!(ms.is_finite() && (0.0..8e15).contains(&ms), "clock unavailable");
            std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms as u64)
        }
    }
}

// WalletDb has no consuming close API. Its owned connection wrapper reports the
// real rusqlite close result on drop, retaining a failed connection until teardown.
#[derive(Default)]
struct CloseReceipt { failed: Option<Connection>, error: Option<String> }
struct OwnedConnection { connection: Option<Connection>, receipt: Rc<RefCell<CloseReceipt>> }
impl std::borrow::Borrow<Connection> for OwnedConnection {
    fn borrow(&self) -> &Connection { self.connection.as_ref().expect("owned connection") }
}
impl std::borrow::BorrowMut<Connection> for OwnedConnection {
    fn borrow_mut(&mut self) -> &mut Connection { self.connection.as_mut().expect("owned connection") }
}
impl Drop for OwnedConnection {
    fn drop(&mut self) {
        if let Some(conn) = self.connection.take() {
            if let Err((conn, _)) = conn.close() {
                let mut receipt = self.receipt.borrow_mut();
                receipt.error = Some("STORAGE_CLOSE_FAILED".into());
                receipt.failed = Some(conn);
            }
        }
    }
}
type Wallet = WalletDb<OwnedConnection, super::Document, HostClock, rand_core::UnwrapErr<getrandom::SysRng>>;
struct Active { transparent_checks: std::collections::BTreeSet<String>, scan_plan: Option<(String,serde_json::Value)>, wallet: Wallet, bytes: Vec<u8>, generation: u32, receipt: Rc<RefCell<CloseReceipt>> }
#[derive(Default)]
struct Domain { active: Vec<Active>, generation: u32, failed: Option<Rc<RefCell<CloseReceipt>>> }
// One serialized native owner; bounded databases share its existing memory ceiling.
thread_local! { static DOMAIN: RefCell<Domain> = RefCell::new(Domain::default()); }

mod schema;
mod revision;

fn validate_schema(conn: &Connection, bytes: &[u8], genesis: &[u8]) -> Result<bool, String> {
    schema::validate(conn, bytes, genesis)
}

fn bind_network(conn: &mut Connection, bytes: &[u8], genesis: &[u8]) -> Result<(), String> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_| "STORAGE_BUSY")?;
    if !validate_schema(&tx, bytes, genesis)? {
        // Independent host bootstrap migration, committed before backend migrations:
        // an interrupted empty-wallet migration remains bound to the same network.
        tx.execute_batch("CREATE TABLE ext_wallet_storage(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, parameters BLOB NOT NULL, genesis BLOB NOT NULL CHECK(length(genesis)=32));").map_err(|_| "STORAGE_INIT_FAILED")?;
        tx.execute("INSERT INTO ext_wallet_storage VALUES(1,1,?1,?2)", rusqlite::params![bytes, genesis]).map_err(|_| "STORAGE_INIT_FAILED")?;
    }
    tx.commit().map_err(|_| "STORAGE_INIT_FAILED".into())
}

fn initialize(path: &str, format: &str, bytes: &[u8], genesis: &[u8]) -> Result<u32, String> {
    if genesis.len() != 32 { return Err("INVALID_ARGUMENT".into()); }
    let document = super::Document::parse_format(format, bytes).map_err(|_| "INVALID_ARGUMENT")?;
    let mut epoch = [0; 16];
    getrandom::fill(&mut epoch).map_err(|_| "ENTROPY_UNAVAILABLE")?;
    DOMAIN.with(|domain| {
        let mut domain = domain.try_borrow_mut().map_err(|_| "STORAGE_BUSY")?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
        if domain.active.len() >= 32 { return Err("RESOURCE_LIMIT".into()); }
        domain.active.try_reserve(1).map_err(|_| "RESOURCE_LIMIT")?;
        let generation = domain.generation.checked_add(1).ok_or("DOMAIN_EXHAUSTED")?;
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        #[cfg(target_arch = "wasm32")]
        let conn = Connection::open_with_flags_and_vfs(path, flags, "storage-host");
        #[cfg(not(target_arch = "wasm32"))]
        let conn = Connection::open_with_flags(path, flags);
        let conn = conn.map_err(|_| "STORAGE_OPEN_FAILED")?;
        let receipt = Rc::new(RefCell::new(CloseReceipt::default()));
        let mut owned = OwnedConnection { connection: Some(conn), receipt: receipt.clone() };
        let prepared = (|| -> Result<(), String> {
            let conn = std::borrow::BorrowMut::<Connection>::borrow_mut(&mut owned);
            validate_schema(conn, bytes, genesis)?;
            let memory = path == ":memory:";
            conn.execute_batch(if memory { "PRAGMA journal_mode=MEMORY; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON;" } else { "PRAGMA journal_mode=TRUNCATE; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON;" }).map_err(|_| "STORAGE_POLICY_FAILED")?;
            let journal: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).map_err(|_| "STORAGE_POLICY_FAILED")?;
            let synchronous: u32 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0)).map_err(|_| "STORAGE_POLICY_FAILED")?;
            let temp: u32 = conn.query_row("PRAGMA temp_store", [], |r| r.get(0)).map_err(|_| "STORAGE_POLICY_FAILED")?;
            if journal != if memory { "memory" } else { "truncate" } || synchronous != 2 || temp != 2 { return Err("STORAGE_POLICY_FAILED".into()); }
            #[cfg(target_arch = "wasm32")]
            {
                unsafe extern "C" { fn wallet_policy(conn: *mut rusqlite::ffi::sqlite3, memory: i32) -> i32; }
                if unsafe { wallet_policy(conn.handle(), i32::from(memory)) } != 0 { return Err("STORAGE_POLICY_FAILED".into()); }
            }
            rusqlite::vtab::array::load_module(conn).map_err(|_| "STORAGE_INIT_FAILED")?;
            bind_network(conn, bytes, genesis)?;
            // The backend's metadata initializer uses expect. Establish it via a
            // fallible operation first, so ordinary setup I/O errors are returned.
            conn.execute_batch("CREATE TABLE IF NOT EXISTS schemer_migrations(id blob PRIMARY KEY)").map_err(|_| "STORAGE_INIT_FAILED")?;
            {
                let mut migrating = WalletDb::from_connection(&mut *conn, document.clone(), HostClock, rand_core::UnwrapErr(getrandom::SysRng));
                WalletMigrator::new().init_or_migrate(&mut migrating).map_err(|_| "MIGRATION_REQUIRED")?;
            }
            // Bounded real schema read; never enumerate the wallet's accounts.
            accounts::initialize(conn)?;
            conn.query_row("SELECT EXISTS(SELECT 1 FROM accounts LIMIT 1)", [], |r| r.get::<_, bool>(0)).map_err(|_| "SCHEMA_MISMATCH")?;
            revision::initialize(conn, &epoch)?;
            creation::initialize(conn)?;
            proposal::initialize(conn)?;
            pczt_build::initialize(conn)?;
            pczt_import::initialize(conn)?;
            pczt_finalize::initialize(conn)?;
            payment::initialize(conn)?;
            Ok(())
        })();
        if let Err(error) = prepared {
            drop(owned);
            if receipt.borrow().error.is_some() { domain.failed = Some(receipt); return Err("STORAGE_CLOSE_FAILED".into()); }
            return Err(error);
        }
        // This runtime uses the application's configured public lightwallet transport.
        let wallet = WalletDb::from_connection(owned, document, HostClock, rand_core::UnwrapErr(getrandom::SysRng))
            .with_handle_modes(zcash_client_sqlite::WalletHandleModes {
                status: zcash_client_backend::data_api::status::TransactionStatusMode::Public,
                transparent_ledger: zcash_client_backend::data_api::transparent_ledger::TransparentLedgerMode::Public,
                enhancement: zcash_client_backend::data_api::enhance_pir::EnhancementMode::Standard,
            });
        // Version 1 databases predate the view-only policy and may hold witness marks for
        // view-only notes. Remove them atomically with the version bump before exposure.
        let mut wallet = wallet;
        let migrated = wallet.transactionally_with_extension(|db, ext| -> accounts::Result<()> {
            let version: u32 = ext.query_row("SELECT version FROM ext_viewing_version WHERE id=1", [], |r| r.get(0))?;
            if version == 1 {
                view_only::drop_marks(db, ext)?;
                ext.execute("UPDATE ext_viewing_version SET version=2 WHERE id=1", [])?;
            }
            Ok(())
        });
        if migrated.is_err() {
            drop(wallet);
            if receipt.borrow().error.is_some() { domain.failed = Some(receipt); return Err("STORAGE_CLOSE_FAILED".into()); }
            return Err("VIEWING_SCHEMA_REQUIRED".into());
        }
        domain.generation = generation;
        domain.active.push(Active { transparent_checks:Default::default(), scan_plan:None, wallet, bytes: bytes.to_vec(), generation, receipt });
        Ok(generation)
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn initialize_path(path: &str, format: &str, bytes: &[u8], genesis: &[u8]) -> Result<u32, String> {
    initialize(path, format, bytes, genesis)
}

#[wasm_bindgen]
pub fn storage_initialize(format: &str, bytes: &[u8], genesis: &[u8]) -> Result<u32, String> {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe extern "C" { fn wallet_ready() -> i32; }
        if unsafe { wallet_ready() } != 1 { return Err("RUNTIME_UNAVAILABLE".into()); }
    }
    initialize("/wallet.db", format, bytes, genesis)
}

#[wasm_bindgen]
pub fn storage_initialize_memory(format: &str, bytes: &[u8], genesis: &[u8]) -> Result<u32, String> {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe extern "C" { fn wallet_ready() -> i32; }
        if unsafe { wallet_ready() } != 1 { return Err("RUNTIME_UNAVAILABLE".into()); }
    }
    initialize(":memory:", format, bytes, genesis)
}

#[wasm_bindgen]
pub fn storage_binding(generation: u32) -> Result<Vec<u8>, String> {
    DOMAIN.with(|domain| {
        let domain = domain.try_borrow().map_err(|_| "STORAGE_BUSY")?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
        let active = domain.active.iter().find(|a| a.generation == generation).ok_or("STALE_HANDLE")?;
        Ok(active.bytes.clone())
    })
}

#[wasm_bindgen]
pub fn storage_close(generation: u32) -> Result<(), String> {
    DOMAIN.with(|domain| {
        let mut domain = domain.try_borrow_mut().map_err(|_| "STORAGE_BUSY")?;
        let index = domain.active.iter().position(|a| a.generation == generation).ok_or("STALE_HANDLE")?;
        let active = domain.active.remove(index);
        signer::detach_wallet(generation);
        drop(active.wallet);
        let error = active.receipt.borrow().error.clone();
        if let Some(error) = error { domain.failed = Some(active.receipt); return Err(error); }
        Ok(())
    })
}

#[cfg(test)]
#[path = "../tests/wallet-schema/prefix.rs"]
mod schema_prefix;

mod accounts;
mod account_lifecycle;
pub mod signer;

mod scan;
mod view_only;
mod sync;
mod creation;
mod proposal;
mod pczt_build;
mod pczt_import;
mod pczt_prove;
mod pczt_finalize;
mod payment;
mod fused_send;
mod enhancement;

mod query;

mod inventory;
