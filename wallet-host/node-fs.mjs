import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isMainThread } from 'node:worker_threads';
// Capture identity primitives before consumer fault injection can replace fs methods.
const { openSync, fstatSync, closeSync } = fs;
const windows = process.platform === 'win32';
// Windows has no O_NOFOLLOW/O_DIRECTORY, uid or mode bits: refuse symlinks and
// junctions (reported as symbolic links) and rely on the per-user profile ACL.
function windowsPathCheck(path, create, directory) {
  let link;
  try { link = fs.lstatSync(path); } catch (e) { if (e.code !== 'ENOENT' || !create) throw e; }
  if (link && (link.isSymbolicLink() || (directory ? !link.isDirectory() : !link.isFile()))) throw Error('unsafe wallet path');
}
function checkedOpen(path, flags, directory = false) {
  if (windows) {
    windowsPathCheck(path, Boolean(flags & fs.constants.O_CREAT), directory);
    if (directory) return undefined; // Windows cannot open a directory as a file.
    const fd = openSync(path, flags, 0o600);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw Error('unsafe wallet path');
      return fd;
    } catch (e) { closeSync(fd); throw e; }
  }
  const fd = openSync(path, flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1) ||
        stat.uid !== process.geteuid() || (stat.mode & 0o077)) throw Error('unsafe wallet path');
    return fd;
  } catch (e) { closeSync(fd); throw e; }
}
// Directory entries are made durable by fsync(2) on the directory. NTFS journals
// metadata and Windows cannot open a directory as a file, so this is a no-op there.
function syncDirectory(dir) {
  if (dir !== undefined) fs.fsyncSync(dir);
}
// Owner lease: an exclusive lock on owner.lock, held by the retained open file
// description and released by the OS if the process dies:
// - Linux: /usr/bin/flock locks the inherited descriptor (works under Node and Bun).
// - macOS: no flock(1); Bun calls flock(2) through bun:ffi, Node falls back to the
//   system perl, which locks the inherited descriptor the same way.
// - Windows: owner.lock is held open with share mode 0, so the open handle itself
//   is the lease and a second owner fails with a sharing violation (EBUSY). Node
//   passes libuv's UV_FS_O_EXLOCK (not exported in fs.constants); Bun cannot, so it
//   opens the handle with kernel32 CreateFileW through bun:ffi.
// Worker trackUnmanagedFds must remain enabled for crash/destruction cleanup.
const LOCK_EX = 2, LOCK_NB = 4;
function lockExclusive(fd) {
  if (process.platform === 'linux') {
    const result = spawnSync('/usr/bin/flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 5000 });
    if (result.error || result.status !== 0) throw Object.assign(Error('exclusive owner unavailable'), { code: result.status === 1 ? 'EBUSY' : 'EIO' });
    return;
  }
  if (typeof process.versions.bun === 'string' && typeof import.meta.require === 'function') {
    const { dlopen, FFIType } = import.meta.require('bun:ffi');
    const libc = dlopen('libSystem.B.dylib', { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    try {
      if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) return;
    } finally { libc.close(); }
    throw Object.assign(Error('exclusive owner unavailable'), { code: 'EBUSY' });
  }
  const result = spawnSync('/usr/bin/perl', ['-e',
    'use Fcntl qw(:flock); open(my $f, "+<&=", 3) or exit 2; flock($f, LOCK_EX | LOCK_NB) and exit 0; exit($!{EWOULDBLOCK} ? 1 : 2)'],
  { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 5000 });
  if (result.error || result.status !== 0) throw Object.assign(Error('exclusive owner unavailable'), { code: result.status === 1 ? 'EBUSY' : 'EIO' });
}
// macOS fsync(2) only reaches the drive cache; F_FULLFSYNC asks the drive to flush,
// matching SQLite's own macOS durability mode. Available through bun:ffi; under
// Node on macOS this falls back to fsync(2).
const F_FULLFSYNC = 51;
let fullSync = null;
function durableSync(fd) {
  if (process.platform === 'darwin' && typeof process.versions.bun === 'string' && typeof import.meta.require === 'function') {
    if (!fullSync) {
      const { dlopen, FFIType } = import.meta.require('bun:ffi');
      fullSync = dlopen('libSystem.B.dylib', { fcntl: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    }
    // Some filesystems reject F_FULLFSYNC; fall back to fsync like SQLite does.
    if (fullSync.symbols.fcntl(fd, F_FULLFSYNC) === 0) return;
  }
  fs.fsyncSync(fd);
}
const UV_FS_O_EXLOCK = 0x10000000; // libuv include/uv/win.h
const busy = () => Object.assign(Error('exclusive owner unavailable'), { code: 'EBUSY' });
/** Windows owner lease on `path`; returns its release function. */
function windowsLease(path) {
  windowsPathCheck(path, true, false);
  if (typeof process.versions.bun === 'string' && typeof import.meta.require === 'function') {
    const { dlopen, FFIType, ptr } = import.meta.require('bun:ffi');
    const k32 = dlopen('kernel32.dll', {
      CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
      GetLastError: { args: [], returns: FFIType.u32 },
      CloseHandle: { args: [FFIType.i64], returns: FFIType.i32 },
    });
    const wide = Buffer.from(`${path.replace(/\//g, '\\')}\0`, 'utf16le');
    // GENERIC_READ | GENERIC_WRITE, share mode 0, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL.
    const handle = k32.symbols.CreateFileW(ptr(wide), 0xC0000000, 0, null, 4, 0x80, null);
    if (handle === -1n || handle === 0n) {
      const error = k32.symbols.GetLastError();
      k32.close();
      // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION
      if (error === 32 || error === 33) throw busy();
      throw Object.assign(Error('owner lease unavailable'), { code: 'EIO' });
    }
    return () => { k32.symbols.CloseHandle(handle); k32.close(); };
  }
  let fd;
  try { fd = openSync(path, fs.constants.O_CREAT | fs.constants.O_RDWR | UV_FS_O_EXLOCK, 0o600); }
  catch (e) { if (e.code === 'EBUSY') throw busy(); throw e; }
  return () => closeSync(fd);
}
export function acquire(root, { create = false } = {}) {
  if (isMainThread || !['linux', 'darwin', 'win32'].includes(process.platform)) throw Error('dedicated Linux, macOS or Windows worker required');
  let base, lock, dir;
  try {
    base = fs.realpathSync(root);
    dir = checkedOpen(base, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY, true);
    if (windows) lock = windowsLease(`${base}/owner.lock`);
    else {
      const fd = checkedOpen(`${base}/owner.lock`, fs.constants.O_CREAT | fs.constants.O_RDWR);
      lock = () => closeSync(fd);
      lockExclusive(fd);
    }
    // Validate BOTH preexisting files before SQLite can mutate either one.
    for (const name of ['wallet.db', 'wallet.db-journal']) {
      try { closeSync(checkedOpen(`${base}/${name}`, fs.constants.O_RDONLY)); }
      catch (e) { if (e.code !== 'ENOENT' || (name === 'wallet.db' && !create)) throw e; }
    }
  } catch (e) {
    if (dir !== undefined) closeSync(dir);
    if (lock !== undefined) lock();
    const held = e.code === 'EBUSY';
    throw Object.assign(Error(held ? 'exclusive owner unavailable' : 'STORAGE_OPEN_FAILED'),
      { code: held ? 'EBUSY' : 'EIO' });
  }
  const descriptors = new Set();
  // Windows FlushFileBuffers needs write access: a read-only handle has nothing to
  // flush and fails with EPERM, so read-only descriptors are not synced on close.
  const readOnlyDescriptors = new Set();
  const host = {
    owned: true,
    open(path, make, readOnly) {
      const fd = checkedOpen(`${base}/${path}`, (readOnly ? fs.constants.O_RDONLY : fs.constants.O_RDWR) | (make ? fs.constants.O_CREAT : 0));
      // Persist namespace entries before journal/database writes can depend on them.
      try { syncDirectory(dir); } catch (e) { closeSync(fd); throw e; }
      descriptors.add(fd); if (readOnly) readOnlyDescriptors.add(fd); return fd;
    },
    close(fd) {
      if (!(windows && readOnlyDescriptors.has(fd))) durableSync(fd);
      fs.closeSync(fd); descriptors.delete(fd); readOnlyDescriptors.delete(fd);
    },
    read: (fd, b, at) => fs.readSync(fd, b, 0, b.length, at),
    write: (fd, b, at) => fs.writeSync(fd, b, 0, b.length, at),
    truncate: (fd, size) => fs.ftruncateSync(fd, size),
    sync: fd => durableSync(fd),
    size: fd => fs.fstatSync(fd).size,
    delete(path, sync) {
      try { fs.unlinkSync(`${base}/${path}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (sync) syncDirectory(dir);
    },
    access(path, flags) {
      try { fs.accessSync(`${base}/${path}`, flags === 1 ? fs.constants.R_OK | fs.constants.W_OK : flags === 2 ? fs.constants.R_OK : fs.constants.F_OK); return true; }
      catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    },
    release() {
      if (!host.owned) return;
      // Hold the lease until every data descriptor is closed.
      for (const fd of descriptors) { fs.closeSync(fd); descriptors.delete(fd); }
      descriptors.clear(); readOnlyDescriptors.clear(); if (dir !== undefined) fs.closeSync(dir); lock(); host.owned = false;
    },
  };
  return host;
}
