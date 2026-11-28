//! Platform services the shared core needs from its front-end (WASM or native).
//!
//! Core code never names a target. Each front-end installs one `Host` before the
//! first wallet call; native builds and tests fall back to `StdHost`.
use std::sync::OnceLock;

/// Services supplied by the runtime that embeds the core.
pub trait Host: Send + Sync + 'static {
    /// Wall-clock time used by wallet finalization and expiry.
    fn now(&self) -> std::time::SystemTime;

    /// Open the SQLite connection for a wallet database (`":memory:"` for memory storage).
    #[cfg(feature = "wallet-storage")]
    fn open(&self, path: &str, flags: rusqlite::OpenFlags) -> rusqlite::Result<rusqlite::Connection> {
        rusqlite::Connection::open_with_flags(path, flags)
    }

    /// Host storage policy applied after the core's own pragma checks.
    #[cfg(feature = "wallet-storage")]
    fn configure(&self, _conn: &rusqlite::Connection, _memory: bool) -> Result<(), ()> { Ok(()) }

    /// Called on the owner before threaded work. Hosts with a managed pool assert readiness.
    fn threads_ready(&self) {}
}

/// Standard-library host: system clock and the default SQLite VFS.
pub struct StdHost;
impl Host for StdHost {
    fn now(&self) -> std::time::SystemTime { std::time::SystemTime::now() }
}

static HOST: OnceLock<&'static dyn Host> = OnceLock::new();

/// Install the process host. The first installation wins; later calls with the
/// same host are no-ops and a different host is rejected.
pub fn install(host: &'static dyn Host) -> Result<(), &'static str> {
    let installed = *HOST.get_or_init(|| host);
    if std::ptr::addr_eq(installed as *const dyn Host, host as *const dyn Host) { Ok(()) } else { Err("HOST_CONFLICT") }
}

#[cfg_attr(not(feature = "wallet-storage"), allow(dead_code))]
pub(crate) fn host() -> &'static dyn Host {
    *HOST.get_or_init(|| &StdHost)
}
