//! `zakura-enc`: authenticated at-rest encryption as a SQLite VFS shim.
//!
//! Byte-compatible port of zcash.js `src/runtime/encrypted-storage.ts`:
//! - `wallet.db`: 64-byte header, then fixed 4096-byte plaintext blocks stored as
//!   nonce(12) || AES-256-GCM ciphertext || tag(16), block index (LE u64) as AAD.
//! - `wallet.db-journal`: header, then append-only frames
//!   [len u32][flags u32][offset u64] || nonce || ciphertext || tag,
//!   AAD = frame header || sequence (LE u64); parsing stops at the first bad frame.
//! - Header: "ZJSWENC1", kind byte, zero padding, 32-byte salt at 16, truncated
//!   HMAC-SHA256 check at 48. File key = HKDF-SHA256(master, salt, info).
//! Only those two files, in directories registered with a key, are encrypted; every
//! other file and all locking pass through to the platform's default VFS. Encrypted
//! files report a 4096-byte sector and no atomic/powersafe guarantees, so SQLite's
//! journal restores any torn block write.
use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use hmac::{Hmac, Mac};
use rusqlite::ffi;
use sha2::Sha256;
use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void, CStr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Once};

pub const NAME: &str = "zakura-enc";
pub const MAGIC: &[u8; 8] = b"ZJSWENC1";
pub const HEADER: usize = 64;
const SALT_AT: usize = 16;
const CHECK_AT: usize = 48;
const CHECK: usize = 16;
const BLOCK: u64 = 4096;
const NONCE: usize = 12;
const TAG: usize = 16;
const FRAME: u64 = BLOCK + (NONCE + TAG) as u64;
const LOG_FRAME_HEADER: usize = 16;

#[derive(Debug)]
pub enum AdmitError { Mismatch, Io }
impl std::fmt::Display for AdmitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self { AdmitError::Mismatch => crate::storage::KEY_MISMATCH, AdmitError::Io => "STORAGE_ERROR" })
    }
}

pub struct Keys { master: [u8; 32] }
impl Drop for Keys { fn drop(&mut self) { self.master = [0; 32]; } }

impl Keys {
    pub fn new(master: &[u8]) -> Option<Self> { Some(Self { master: master.try_into().ok()? }) }

    fn check(&self, kind: u8, salt: &[u8]) -> [u8; CHECK] {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.master).expect("hmac key");
        mac.update(b"zcash.js wallet storage check v1");
        mac.update(&[kind]);
        mac.update(salt);
        mac.finalize().into_bytes()[..CHECK].try_into().unwrap()
    }

    fn file_key(&self, kind: u8, salt: &[u8]) -> [u8; 32] {
        let mut key = [0; 32];
        hkdf::Hkdf::<Sha256>::new(Some(salt), &self.master)
            .expand(format!("zcash.js wallet storage v1/{kind}").as_bytes(), &mut key).expect("hkdf length");
        key
    }

    fn header(&self, kind: u8) -> ([u8; HEADER], [u8; 32]) {
        let mut header = [0u8; HEADER];
        header[..8].copy_from_slice(MAGIC);
        header[8] = kind;
        getrandom::fill(&mut header[SALT_AT..SALT_AT + 32]).expect("entropy");
        let check = self.check(kind, &header[SALT_AT..SALT_AT + 32]);
        header[CHECK_AT..CHECK_AT + CHECK].copy_from_slice(&check);
        let key = self.file_key(kind, &header[SALT_AT..SALT_AT + 32]);
        (header, key)
    }

    /// Validate a complete header and return its file key.
    pub fn admit(&self, kind: u8, header: &[u8]) -> Result<[u8; 32], AdmitError> {
        if header.len() < HEADER || header[..8] != MAGIC[..] { return Err(AdmitError::Mismatch); }
        if header[8] != kind || header[9..SALT_AT].iter().any(|b| *b != 0) { return Err(AdmitError::Io); }
        let salt = &header[SALT_AT..SALT_AT + 32];
        let expected = self.check(kind, salt);
        let actual = &header[CHECK_AT..CHECK_AT + CHECK];
        // Constant-time comparison.
        if expected.iter().zip(actual).fold(0u8, |acc, (a, b)| acc | (a ^ b)) != 0 { return Err(AdmitError::Mismatch); }
        Ok(self.file_key(kind, salt))
    }
}

fn seal(key: &[u8; 32], plain: &[u8], aad: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; NONCE + plain.len() + TAG];
    getrandom::fill(&mut out[..NONCE]).expect("entropy");
    out[NONCE..NONCE + plain.len()].copy_from_slice(plain);
    let cipher = Aes256Gcm::new_from_slice(key).expect("key length");
    let nonce = *Nonce::from_slice(&out[..NONCE]);
    let tag = cipher.encrypt_in_place_detached(&nonce, aad, &mut out[NONCE..NONCE + plain.len()]).expect("encrypt");
    out[NONCE + plain.len()..].copy_from_slice(&tag);
    out
}

fn open_sealed(key: &[u8; 32], sealed: &[u8], aad: &[u8]) -> Option<Vec<u8>> {
    let length = sealed.len().checked_sub(NONCE + TAG)?;
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let mut plain = sealed[NONCE..NONCE + length].to_vec();
    let tag = Tag::from_slice(&sealed[NONCE + length..]);
    cipher.decrypt_in_place_detached(Nonce::from_slice(&sealed[..NONCE]), aad, &mut plain, tag).ok()?;
    Some(plain)
}

// ---- registration -----------------------------------------------------------------

static DIRECTORIES: Mutex<Option<HashMap<PathBuf, Arc<Keys>>>> = Mutex::new(None);

pub fn register(directory: &Path, keys: Keys) -> Result<(), String> {
    install()?;
    DIRECTORIES.lock().map_err(|_| "DOMAIN_INVALID")?.get_or_insert_with(HashMap::new)
        .insert(directory.to_path_buf(), Arc::new(keys));
    Ok(())
}
pub fn forget(directory: &Path) {
    if let Ok(mut d) = DIRECTORIES.lock() { d.as_mut().map(|d| d.remove(directory)); }
}
fn keys_for(path: &Path) -> Option<(Arc<Keys>, u8)> {
    let kind = match path.file_name()?.to_str()? { "wallet.db" => 1, "wallet.db-journal" => 2, _ => return None };
    let keys = DIRECTORIES.lock().ok()?.as_ref()?.get(path.parent()?)?.clone();
    Some((keys, kind))
}
pub fn encrypted(path: &Path) -> bool { keys_for(path).is_some_and(|(_, kind)| kind == 1) }

// ---- encrypted file state (ports of PageFile / LogFile) -------------------------

/// Physical access to the underlying platform file.
struct Real(*mut ffi::sqlite3_file);
impl Real {
    fn methods(&self) -> &ffi::sqlite3_io_methods { unsafe { &*(*self.0).pMethods } }
    fn size(&self) -> Result<u64, c_int> {
        let mut size: ffi::sqlite3_int64 = 0;
        let rc = unsafe { (self.methods().xFileSize.unwrap())(self.0, &mut size) };
        if rc != ffi::SQLITE_OK { Err(rc) } else { Ok(size as u64) }
    }
    /// Read up to `buf.len()` bytes at `at`; returns the count actually present.
    fn read(&self, buf: &mut [u8], at: u64) -> Result<usize, c_int> {
        let size = self.size()?;
        if at >= size || buf.is_empty() { return Ok(0); }
        let n = buf.len().min((size - at) as usize);
        let rc = unsafe { (self.methods().xRead.unwrap())(self.0, buf.as_mut_ptr().cast(), n as c_int, at as i64) };
        if rc != ffi::SQLITE_OK { return Err(ffi::SQLITE_IOERR_READ); }
        Ok(n)
    }
    fn write(&self, buf: &[u8], at: u64) -> Result<(), c_int> {
        let rc = unsafe { (self.methods().xWrite.unwrap())(self.0, buf.as_ptr().cast(), buf.len() as c_int, at as i64) };
        if rc != ffi::SQLITE_OK { Err(rc) } else { Ok(()) }
    }
    fn truncate(&self, size: u64) -> Result<(), c_int> {
        let rc = unsafe { (self.methods().xTruncate.unwrap())(self.0, size as i64) };
        if rc != ffi::SQLITE_OK { Err(rc) } else { Ok(()) }
    }
}

const IOERR: c_int = ffi::SQLITE_IOERR;

struct PageFile { keys: Arc<Keys>, key: Option<[u8; 32]>, length: u64 }
impl PageFile {
    fn open(real: &Real, keys: Arc<Keys>) -> Result<Self, c_int> {
        let physical = real.size()?;
        let mut file = PageFile { keys, key: None, length: 0 };
        if physical == 0 { return Ok(file); }
        if physical < HEADER as u64 { return Err(IOERR); }
        let mut header = [0u8; HEADER];
        if real.read(&mut header, 0)? != HEADER { return Err(IOERR); }
        file.key = Some(file.keys.admit(1, &header).map_err(|_| IOERR)?);
        let body = physical - HEADER as u64;
        let (blocks, tail) = (body / FRAME, body % FRAME);
        // A tail without room for any ciphertext is an interrupted append; ignore it.
        let overhead = (NONCE + TAG) as u64;
        file.length = blocks * BLOCK + if tail > overhead { tail - overhead } else { 0 };
        Ok(file)
    }
    fn block_length(&self, index: u64) -> usize { BLOCK.min(self.length.saturating_sub(index * BLOCK)) as usize }
    fn read_block(&self, real: &Real, index: u64) -> Result<Vec<u8>, c_int> {
        let length = self.block_length(index);
        if length == 0 { return Ok(Vec::new()); }
        let mut sealed = vec![0u8; length + NONCE + TAG];
        if real.read(&mut sealed, HEADER as u64 + index * FRAME)? != sealed.len() { return Err(IOERR); }
        open_sealed(self.key.as_ref().ok_or(IOERR)?, &sealed, &index.to_le_bytes()).ok_or(IOERR)
    }
    fn write_block(&mut self, real: &Real, index: u64, plain: &[u8]) -> Result<(), c_int> {
        if self.key.is_none() {
            let (header, key) = self.keys.header(1);
            real.write(&header, 0)?;
            self.key = Some(key);
        }
        let sealed = seal(self.key.as_ref().unwrap(), plain, &index.to_le_bytes());
        real.write(&sealed, HEADER as u64 + index * FRAME)
    }
    fn read(&self, real: &Real, target: &mut [u8], at: u64) -> Result<usize, c_int> {
        let end = (at + target.len() as u64).min(self.length);
        let mut position = at;
        let mut done = 0;
        while position < end {
            let index = position / BLOCK;
            let offset = (position - index * BLOCK) as usize;
            let mut plain = self.read_block(real, index)?;
            let count = (plain.len() - offset).min((end - position) as usize);
            target[(position - at) as usize..(position - at) as usize + count].copy_from_slice(&plain[offset..offset + count]);
            plain.iter_mut().for_each(|b| *b = 0);
            position += count as u64;
            done += count;
        }
        Ok(done)
    }
    fn write(&mut self, real: &Real, source: &[u8], at: u64) -> Result<(), c_int> {
        // Writing beyond the end first extends the file with zero bytes.
        while self.length < at {
            let gap = (at - self.length).min(BLOCK - self.length % BLOCK);
            let length = self.length;
            self.write(real, &vec![0u8; gap as usize], length)?;
        }
        let end = at + source.len() as u64;
        let mut position = at;
        while position < end {
            let index = position / BLOCK;
            let start = index * BLOCK;
            let from = (position - start) as usize;
            let to = ((end).min(start + BLOCK) - start) as usize;
            let existing = self.block_length(index);
            let mut plain = if from == 0 && to >= existing {
                source[(position - at) as usize..(position - at) as usize + to].to_vec()
            } else {
                let mut block = vec![0u8; existing.max(to)];
                if existing > 0 {
                    let mut old = self.read_block(real, index)?;
                    block[..old.len()].copy_from_slice(&old);
                    old.iter_mut().for_each(|b| *b = 0);
                }
                block[from..to].copy_from_slice(&source[(position - at) as usize..(position - at) as usize + to - from]);
                block
            };
            self.write_block(real, index, &plain)?;
            self.length = self.length.max(start + plain.len() as u64);
            plain.iter_mut().for_each(|b| *b = 0);
            position = start + to as u64;
        }
        Ok(())
    }
    fn truncate(&mut self, real: &Real, size: u64) -> Result<(), c_int> {
        if size >= self.length {
            if size > self.length { self.write(real, &[], size)?; }
            return Ok(());
        }
        let (blocks, rest) = (size / BLOCK, size % BLOCK);
        if rest != 0 {
            let mut old = self.read_block(real, blocks)?;
            self.write_block(real, blocks, &old[..rest as usize])?;
            old.iter_mut().for_each(|b| *b = 0);
            real.truncate(HEADER as u64 + blocks * FRAME + NONCE as u64 + rest + TAG as u64)?;
        } else {
            real.truncate(if self.key.is_some() { HEADER as u64 + blocks * FRAME } else { 0 })?;
        }
        self.length = size;
        Ok(())
    }
}
impl Drop for PageFile { fn drop(&mut self) { if let Some(k) = self.key.as_mut() { *k = [0; 32]; } } }

struct LogFile { keys: Arc<Keys>, key: Option<[u8; 32]>, data: Vec<u8>, length: usize, end: u64, sequence: u64 }
impl LogFile {
    fn open(real: &Real, keys: Arc<Keys>, read_only: bool) -> Result<Self, c_int> {
        let mut file = LogFile { keys, key: None, data: Vec::new(), length: 0, end: 0, sequence: 0 };
        let physical = real.size()?;
        if physical == 0 { return Ok(file); }
        if physical < HEADER as u64 {
            // An interrupted first header write: no frame was ever durable.
            if !read_only { real.truncate(0)?; }
            return Ok(file);
        }
        let mut bytes = vec![0u8; physical as usize];
        if real.read(&mut bytes, 0)? != bytes.len() { return Err(IOERR); }
        let parsed = (|| -> Result<(), c_int> {
            file.key = Some(file.keys.admit(2, &bytes[..HEADER]).map_err(|_| IOERR)?);
            file.end = HEADER as u64;
            while file.end as usize + LOG_FRAME_HEADER + NONCE + TAG <= bytes.len() {
                let at = file.end as usize;
                let header: [u8; LOG_FRAME_HEADER] = bytes[at..at + LOG_FRAME_HEADER].try_into().unwrap();
                let length = u32::from_le_bytes(header[0..4].try_into().unwrap()) as usize;
                let flags = u32::from_le_bytes(header[4..8].try_into().unwrap());
                let offset = u64::from_le_bytes(header[8..16].try_into().unwrap());
                if flags > 1 || (flags == 1 && length != 0) || offset > (1u64 << 53) - 1 { break; }
                let frame_end = at + LOG_FRAME_HEADER + NONCE + length + TAG;
                if frame_end > bytes.len() { break; }
                let Some(mut plain) = open_sealed(file.key.as_ref().unwrap(), &bytes[at + LOG_FRAME_HEADER..frame_end], &file.aad(&header)) else { break };
                if flags == 1 { file.resize(offset as usize); } else { file.place(&plain, offset as usize); }
                plain.iter_mut().for_each(|b| *b = 0);
                file.sequence += 1;
                file.end = frame_end as u64;
            }
            Ok(())
        })();
        bytes.iter_mut().for_each(|b| *b = 0);
        parsed?;
        // Drop an unauthenticated tail so later appends follow the last valid frame.
        if file.end < physical && !read_only { real.truncate(file.end)?; }
        Ok(file)
    }
    fn aad(&self, header: &[u8]) -> Vec<u8> {
        let mut aad = header.to_vec();
        aad.extend_from_slice(&self.sequence.to_le_bytes());
        aad
    }
    fn reserve(&mut self, size: usize) {
        if size <= self.data.len() { return; }
        let mut next = vec![0u8; size.max(self.data.len() * 2).max(BLOCK as usize)];
        next[..self.length].copy_from_slice(&self.data[..self.length]);
        self.data.iter_mut().for_each(|b| *b = 0);
        self.data = next;
    }
    fn resize(&mut self, size: usize) {
        self.reserve(size);
        if size < self.length { self.data[size..self.length].iter_mut().for_each(|b| *b = 0); }
        self.length = size;
    }
    fn place(&mut self, plain: &[u8], offset: usize) {
        self.reserve(offset + plain.len());
        self.data[offset..offset + plain.len()].copy_from_slice(plain);
        self.length = self.length.max(offset + plain.len());
    }
    fn append(&mut self, real: &Real, flags: u32, offset: u64, plain: &[u8]) -> Result<(), c_int> {
        if self.key.is_none() {
            let (header, key) = self.keys.header(2);
            real.write(&header, 0)?;
            self.key = Some(key);
            self.end = HEADER as u64;
            self.sequence = 0;
        }
        let mut header = [0u8; LOG_FRAME_HEADER];
        header[0..4].copy_from_slice(&(plain.len() as u32).to_le_bytes());
        header[4..8].copy_from_slice(&flags.to_le_bytes());
        header[8..16].copy_from_slice(&offset.to_le_bytes());
        let mut frame = header.to_vec();
        frame.extend_from_slice(&seal(self.key.as_ref().unwrap(), plain, &self.aad(&header)));
        real.write(&frame, self.end)?;
        self.end += frame.len() as u64;
        self.sequence += 1;
        Ok(())
    }
    fn read(&self, target: &mut [u8], at: u64) -> usize {
        let count = (target.len() as u64).min((self.length as u64).saturating_sub(at)) as usize;
        target[..count].copy_from_slice(&self.data[at as usize..at as usize + count]);
        count
    }
    fn write(&mut self, real: &Real, source: &[u8], at: u64) -> Result<(), c_int> {
        self.append(real, 0, at, source)?;
        self.place(source, at as usize);
        Ok(())
    }
    fn truncate(&mut self, real: &Real, size: u64) -> Result<(), c_int> {
        if size == 0 {
            real.truncate(0)?;
            if let Some(k) = self.key.as_mut() { *k = [0; 32]; }
            self.key = None;
            self.end = 0;
            self.sequence = 0;
            self.resize(0);
            return Ok(());
        }
        if size as usize == self.length { return Ok(()); }
        self.append(real, 1, size, &[])?;
        self.resize(size as usize);
        Ok(())
    }
}
impl Drop for LogFile {
    fn drop(&mut self) {
        if let Some(k) = self.key.as_mut() { *k = [0; 32]; }
        self.data.iter_mut().for_each(|b| *b = 0);
    }
}

enum Encrypted { Page(PageFile), Log(LogFile) }
struct State { file: Encrypted, read_only: bool }

// ---- SQLite VFS plumbing -----------------------------------------------------------

#[repr(C)]
struct EncFile {
    base: ffi::sqlite3_file,
    state: *mut State,
    real: *mut ffi::sqlite3_file,
}

fn real_offset() -> usize { (std::mem::size_of::<EncFile>() + 15) & !15 }

unsafe fn parts<'a>(file: *mut ffi::sqlite3_file) -> (&'a mut State, Real) {
    let f = file as *mut EncFile;
    unsafe { (&mut *(*f).state, Real((*f).real)) }
}

unsafe extern "C" fn x_close(file: *mut ffi::sqlite3_file) -> c_int {
    let f = file as *mut EncFile;
    unsafe {
        let real = (*f).real;
        let rc = ((*(*real).pMethods).xClose.unwrap())(real);
        drop(Box::from_raw((*f).state));
        (*f).state = std::ptr::null_mut();
        rc
    }
}
unsafe extern "C" fn x_read(file: *mut ffi::sqlite3_file, buf: *mut c_void, amount: c_int, offset: ffi::sqlite3_int64) -> c_int {
    let (state, real) = unsafe { parts(file) };
    let target = unsafe { std::slice::from_raw_parts_mut(buf as *mut u8, amount as usize) };
    let read = match &state.file {
        Encrypted::Page(p) => p.read(&real, target, offset as u64),
        Encrypted::Log(l) => Ok(l.read(target, offset as u64)),
    };
    match read {
        Ok(n) if n == target.len() => ffi::SQLITE_OK,
        Ok(n) => { target[n..].iter_mut().for_each(|b| *b = 0); ffi::SQLITE_IOERR_SHORT_READ }
        Err(_) => ffi::SQLITE_IOERR_READ,
    }
}
unsafe extern "C" fn x_write(file: *mut ffi::sqlite3_file, buf: *const c_void, amount: c_int, offset: ffi::sqlite3_int64) -> c_int {
    let (state, real) = unsafe { parts(file) };
    if state.read_only { return ffi::SQLITE_READONLY; }
    let source = unsafe { std::slice::from_raw_parts(buf as *const u8, amount as usize) };
    let result = match &mut state.file {
        Encrypted::Page(p) => p.write(&real, source, offset as u64),
        Encrypted::Log(l) => l.write(&real, source, offset as u64),
    };
    if result.is_ok() { ffi::SQLITE_OK } else { ffi::SQLITE_IOERR_WRITE }
}
unsafe extern "C" fn x_truncate(file: *mut ffi::sqlite3_file, size: ffi::sqlite3_int64) -> c_int {
    let (state, real) = unsafe { parts(file) };
    let result = match &mut state.file {
        Encrypted::Page(p) => p.truncate(&real, size as u64),
        Encrypted::Log(l) => l.truncate(&real, size as u64),
    };
    if result.is_ok() { ffi::SQLITE_OK } else { ffi::SQLITE_IOERR_TRUNCATE }
}
unsafe extern "C" fn x_sync(file: *mut ffi::sqlite3_file, flags: c_int) -> c_int {
    let (_, real) = unsafe { parts(file) };
    unsafe { (real.methods().xSync.unwrap())(real.0, flags) }
}
unsafe extern "C" fn x_file_size(file: *mut ffi::sqlite3_file, size: *mut ffi::sqlite3_int64) -> c_int {
    let (state, _) = unsafe { parts(file) };
    let logical = match &state.file { Encrypted::Page(p) => p.length, Encrypted::Log(l) => l.length as u64 };
    unsafe { *size = logical as i64; }
    ffi::SQLITE_OK
}
unsafe extern "C" fn x_lock(file: *mut ffi::sqlite3_file, level: c_int) -> c_int {
    let (_, real) = unsafe { parts(file) };
    unsafe { (real.methods().xLock.unwrap())(real.0, level) }
}
unsafe extern "C" fn x_unlock(file: *mut ffi::sqlite3_file, level: c_int) -> c_int {
    let (_, real) = unsafe { parts(file) };
    unsafe { (real.methods().xUnlock.unwrap())(real.0, level) }
}
unsafe extern "C" fn x_check_reserved(file: *mut ffi::sqlite3_file, out: *mut c_int) -> c_int {
    let (_, real) = unsafe { parts(file) };
    unsafe { (real.methods().xCheckReservedLock.unwrap())(real.0, out) }
}
unsafe extern "C" fn x_file_control(file: *mut ffi::sqlite3_file, op: c_int, arg: *mut c_void) -> c_int {
    // Physical preallocation would add bytes the frame layout reads as data.
    if op == ffi::SQLITE_FCNTL_SIZE_HINT || op == ffi::SQLITE_FCNTL_CHUNK_SIZE { return ffi::SQLITE_OK; }
    let (_, real) = unsafe { parts(file) };
    unsafe { (real.methods().xFileControl.unwrap())(real.0, op, arg) }
}
unsafe extern "C" fn x_sector_size(_: *mut ffi::sqlite3_file) -> c_int { BLOCK as c_int }
unsafe extern "C" fn x_device_characteristics(_: *mut ffi::sqlite3_file) -> c_int { 0 }

static METHODS: ffi::sqlite3_io_methods = ffi::sqlite3_io_methods {
    iVersion: 1,
    xClose: Some(x_close),
    xRead: Some(x_read),
    xWrite: Some(x_write),
    xTruncate: Some(x_truncate),
    xSync: Some(x_sync),
    xFileSize: Some(x_file_size),
    xLock: Some(x_lock),
    xUnlock: Some(x_unlock),
    xCheckReservedLock: Some(x_check_reserved),
    xFileControl: Some(x_file_control),
    xSectorSize: Some(x_sector_size),
    xDeviceCharacteristics: Some(x_device_characteristics),
    xShmMap: None, xShmLock: None, xShmBarrier: None, xShmUnmap: None, xFetch: None, xUnfetch: None,
};

fn base(vfs: *mut ffi::sqlite3_vfs) -> *mut ffi::sqlite3_vfs { unsafe { (*vfs).pAppData as *mut ffi::sqlite3_vfs } }

unsafe extern "C" fn v_open(vfs: *mut ffi::sqlite3_vfs, name: *const c_char, file: *mut ffi::sqlite3_file, flags: c_int, out: *mut c_int) -> c_int {
    let base = base(vfs);
    let target = if name.is_null() { None } else {
        unsafe { CStr::from_ptr(name) }.to_str().ok().map(PathBuf::from).and_then(|p| keys_for(&p))
    };
    let wanted = flags & (ffi::SQLITE_OPEN_MAIN_DB | ffi::SQLITE_OPEN_MAIN_JOURNAL);
    let Some((keys, kind)) = target.filter(|(_, kind)| wanted == if *kind == 1 { ffi::SQLITE_OPEN_MAIN_DB } else { ffi::SQLITE_OPEN_MAIN_JOURNAL }) else {
        // Not an encrypted wallet file: the platform VFS owns this file entirely.
        return unsafe { ((*base).xOpen.unwrap())(base, name, file, flags, out) };
    };
    let f = file as *mut EncFile;
    let real = unsafe { (file as *mut u8).add(real_offset()) } as *mut ffi::sqlite3_file;
    unsafe {
        (*f).base.pMethods = std::ptr::null();
        (*f).state = std::ptr::null_mut();
        (*f).real = real;
        (*real).pMethods = std::ptr::null();
    }
    let rc = unsafe { ((*base).xOpen.unwrap())(base, name, real, flags, out) };
    if rc != ffi::SQLITE_OK { return rc; }
    let real_file = Real(real);
    let read_only = flags & ffi::SQLITE_OPEN_READONLY != 0;
    let opened = if kind == 1 { PageFile::open(&real_file, keys).map(Encrypted::Page) } else { LogFile::open(&real_file, keys, read_only).map(Encrypted::Log) };
    match opened {
        Ok(encrypted) => unsafe {
            (*f).state = Box::into_raw(Box::new(State { file: encrypted, read_only }));
            (*f).base.pMethods = &METHODS;
            ffi::SQLITE_OK
        },
        Err(rc) => unsafe {
            ((*(*real).pMethods).xClose.unwrap())(real);
            rc
        },
    }
}
unsafe extern "C" fn v_delete(vfs: *mut ffi::sqlite3_vfs, name: *const c_char, sync: c_int) -> c_int {
    let b = base(vfs); unsafe { ((*b).xDelete.unwrap())(b, name, sync) }
}
unsafe extern "C" fn v_access(vfs: *mut ffi::sqlite3_vfs, name: *const c_char, flags: c_int, out: *mut c_int) -> c_int {
    let b = base(vfs); unsafe { ((*b).xAccess.unwrap())(b, name, flags, out) }
}
unsafe extern "C" fn v_full_pathname(vfs: *mut ffi::sqlite3_vfs, name: *const c_char, n: c_int, out: *mut c_char) -> c_int {
    let b = base(vfs); unsafe { ((*b).xFullPathname.unwrap())(b, name, n, out) }
}
unsafe extern "C" fn v_randomness(vfs: *mut ffi::sqlite3_vfs, n: c_int, out: *mut c_char) -> c_int {
    let b = base(vfs); unsafe { ((*b).xRandomness.unwrap())(b, n, out) }
}
unsafe extern "C" fn v_sleep(vfs: *mut ffi::sqlite3_vfs, micros: c_int) -> c_int {
    let b = base(vfs); unsafe { ((*b).xSleep.unwrap())(b, micros) }
}
unsafe extern "C" fn v_current_time(vfs: *mut ffi::sqlite3_vfs, out: *mut f64) -> c_int {
    let b = base(vfs); unsafe { ((*b).xCurrentTime.unwrap())(b, out) }
}
unsafe extern "C" fn v_last_error(vfs: *mut ffi::sqlite3_vfs, n: c_int, out: *mut c_char) -> c_int {
    let b = base(vfs); unsafe { ((*b).xGetLastError.unwrap())(b, n, out) }
}
unsafe extern "C" fn v_current_time_i64(vfs: *mut ffi::sqlite3_vfs, out: *mut ffi::sqlite3_int64) -> c_int {
    let b = base(vfs);
    unsafe { match (*b).xCurrentTimeInt64 { Some(f) => f(b, out), None => ffi::SQLITE_ERROR } }
}

static INSTALL: Once = Once::new();
static mut INSTALLED: c_int = ffi::SQLITE_ERROR;

/// Register the VFS (not as default) once per process.
fn install() -> Result<(), String> {
    INSTALL.call_once(|| unsafe {
        if ffi::sqlite3_initialize() != ffi::SQLITE_OK { return; }
        let base = ffi::sqlite3_vfs_find(std::ptr::null());
        if base.is_null() { return; }
        let name = Box::leak(format!("{NAME}\0").into_boxed_str());
        let vfs = Box::leak(Box::new(ffi::sqlite3_vfs {
            iVersion: 2,
            szOsFile: (real_offset() + (*base).szOsFile as usize) as c_int,
            mxPathname: (*base).mxPathname,
            pNext: std::ptr::null_mut(),
            zName: name.as_ptr() as *const c_char,
            pAppData: base as *mut c_void,
            xOpen: Some(v_open),
            xDelete: Some(v_delete),
            xAccess: Some(v_access),
            xFullPathname: Some(v_full_pathname),
            xDlOpen: None, xDlError: None, xDlSym: None, xDlClose: None,
            xRandomness: Some(v_randomness),
            xSleep: Some(v_sleep),
            xCurrentTime: Some(v_current_time),
            xGetLastError: Some(v_last_error),
            xCurrentTimeInt64: Some(v_current_time_i64),
            xSetSystemCall: None, xGetSystemCall: None, xNextSystemCall: None,
        }));
        INSTALLED = ffi::sqlite3_vfs_register(vfs, 0);
    });
    if unsafe { INSTALLED } == ffi::SQLITE_OK { Ok(()) } else { Err("RUNTIME_UNAVAILABLE".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn header_admission_detects_wrong_keys_and_tampering() {
        let keys = Keys::new(&[7u8; 32]).unwrap();
        let (header, key) = keys.header(1);
        assert_eq!(keys.admit(1, &header).unwrap(), key);
        assert!(matches!(Keys::new(&[8u8; 32]).unwrap().admit(1, &header), Err(AdmitError::Mismatch)));
        assert!(matches!(keys.admit(2, &header), Err(AdmitError::Io)));
        let mut tampered = header;
        tampered[SALT_AT] ^= 1;
        assert!(matches!(keys.admit(1, &tampered), Err(AdmitError::Mismatch)));
    }
    #[test]
    fn seal_round_trips_and_binds_aad() {
        let key = [3u8; 32];
        let sealed = seal(&key, b"page", &5u64.to_le_bytes());
        assert_eq!(open_sealed(&key, &sealed, &5u64.to_le_bytes()).unwrap(), b"page");
        assert!(open_sealed(&key, &sealed, &6u64.to_le_bytes()).is_none());
    }
}
