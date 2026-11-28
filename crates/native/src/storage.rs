//! Native wallet storage: a directory holding `wallet.db`, `wallet.db-journal` and
//! `owner.lock`, the same layout as the Node filesystem host.
//!
//! - Ownership: an exclusive non-blocking `flock` on `owner.lock`, held while open.
//!   A second open from any process or runtime fails with STORAGE_BUSY.
//! - Encryption (optional 32-byte key): the `zakura-enc` SQLite VFS, byte-compatible
//!   with zcash.js `encrypted-storage.ts`, so encrypted wallets move between Node and
//!   mobile. Wrong keys and plaintext/encrypted mismatches fail before SQLite reads.
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use zakura_bindings_core::{api, host::Host};

pub const KEY_MISMATCH: &str = "STORAGE_KEY_MISMATCH";

struct NativeHost;
impl Host for NativeHost {
    fn now(&self) -> std::time::SystemTime { std::time::SystemTime::now() }
    fn open(&self, path: &str, flags: rusqlite::OpenFlags) -> rusqlite::Result<rusqlite::Connection> {
        if crate::vfs::encrypted(Path::new(path)) {
            rusqlite::Connection::open_with_flags_and_vfs(path, flags, crate::vfs::NAME)
        } else {
            rusqlite::Connection::open_with_flags(path, flags)
        }
    }
    fn configure(&self, conn: &rusqlite::Connection, memory: bool) -> Result<(), ()> {
        // Apple platforms need F_FULLFSYNC for durable commits (SQLite's own guidance).
        if !memory && cfg!(target_vendor = "apple") {
            conn.execute_batch("PRAGMA fullfsync=ON; PRAGMA checkpoint_fullfsync=ON;").map_err(|_| ())?;
        }
        Ok(())
    }
}
static HOST: NativeHost = NativeHost;

pub fn install_host() -> Result<(), String> {
    zakura_bindings_core::host::install(&HOST).map_err(String::from)
}

/// Held ownership of one storage directory; dropping releases the lock.
struct Lease { directory: PathBuf, _lock: std::fs::File }
impl Drop for Lease {
    fn drop(&mut self) { crate::vfs::forget(&self.directory); }
}

thread_local! {
    // Generations are per owner thread (per runtime), like the core's wallet domain.
    static LEASES: RefCell<HashMap<u32, Lease>> = RefCell::new(HashMap::new());
}

fn io_code(error: &std::io::Error) -> &'static str {
    match error.raw_os_error() {
        Some(libc::ENOSPC) => "STORAGE_QUOTA",
        #[cfg(not(target_os = "android"))]
        Some(libc::EDQUOT) => "STORAGE_QUOTA",
        Some(libc::EWOULDBLOCK) => "STORAGE_BUSY",
        _ => "STORAGE_ERROR",
    }
}

#[cfg(unix)]
fn prepare_directory(directory: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    match std::fs::DirBuilder::new().mode(0o700).create(directory) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(io_code(&e).into()),
    }
    // Refuse symlinks, other owners and group/world access, like the Node host.
    let meta = std::fs::symlink_metadata(directory).map_err(|e| io_code(&e))?;
    if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } || meta.permissions().mode() & 0o077 != 0 {
        return Err("STORAGE_ERROR".into());
    }
    Ok(())
}

#[cfg(unix)]
fn lock(directory: &Path) -> Result<std::fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::io::AsRawFd;
    let file = std::fs::OpenOptions::new().read(true).write(true).create(true).mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(directory.join("owner.lock"))
        .map_err(|e| io_code(&e))?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("STORAGE_BUSY".into());
    }
    Ok(file)
}

const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

fn header(path: &Path) -> Result<Option<Vec<u8>>, String> {
    use std::io::Read;
    match std::fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(crate::vfs::HEADER as u64).read_to_end(&mut bytes).map_err(|e| io_code(&e))?;
            Ok(Some(bytes))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_code(&e).into()),
    }
}

/// Admission before SQLite opens anything (mirrors encryptStorage / checkUnencryptedStorage).
fn admit(directory: &Path, keys: Option<&crate::vfs::Keys>) -> Result<(), String> {
    for (name, kind) in [("wallet.db", 1u8), ("wallet.db-journal", 2u8)] {
        let Some(bytes) = header(&directory.join(name))? else { continue };
        if bytes.is_empty() { continue; }
        let encrypted = bytes.len() >= 8 && bytes[..8] == crate::vfs::MAGIC[..];
        match keys {
            None => if encrypted { return Err(KEY_MISMATCH.into()); },
            Some(keys) => {
                if bytes.len() >= SQLITE_MAGIC.len() && bytes[..SQLITE_MAGIC.len()] == SQLITE_MAGIC[..] { return Err(KEY_MISMATCH.into()); }
                if bytes.len() < crate::vfs::HEADER {
                    if kind == 1 { return Err("STORAGE_ERROR".into()); }
                    continue;
                }
                keys.admit(kind, &bytes).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Open (creating if needed) the wallet in `directory` on the calling owner thread.
pub fn open(directory: &str, format: &str, parameters: &[u8], genesis: &[u8], key: Option<Vec<u8>>) -> Result<u32, String> {
    install_host()?;
    let directory = PathBuf::from(directory);
    if !directory.is_absolute() { return Err("INVALID_ARGUMENT".into()); }
    let keys = match key {
        None => None,
        Some(mut key) => {
            let keys = crate::vfs::Keys::new(&key);
            key.iter_mut().for_each(|b| *b = 0);
            Some(keys.ok_or("INVALID_ARGUMENT")?)
        }
    };
    prepare_directory(&directory)?;
    let lock = lock(&directory)?;
    admit(&directory, keys.as_ref())?;
    if let Some(keys) = keys { crate::vfs::register(&directory, keys)?; }
    let lease = Lease { directory: directory.clone(), _lock: lock };
    let database = directory.join("wallet.db");
    let generation = api::storage_initialize_path(database.to_str().ok_or("INVALID_ARGUMENT")?, format, parameters, genesis)?;
    LEASES.with(|l| l.borrow_mut().insert(generation, lease));
    Ok(generation)
}

/// Close a wallet opened by `open` (or memory storage) and release its directory.
pub fn close(generation: u32) -> Result<(), String> {
    let result = api::storage_close(generation);
    // A failed close leaves the database invalid; the lease is still released so the
    // directory can be reopened after the runtime is destroyed.
    LEASES.with(|l| l.borrow_mut().remove(&generation));
    result
}
