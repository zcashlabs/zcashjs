import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isMainThread } from 'node:worker_threads';
// Capture identity primitives before consumer fault injection can replace fs methods.
const { openSync, fstatSync, closeSync } = fs;
function checkedOpen(path, flags, directory = false) {
  const fd = openSync(path, flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1) ||
        stat.uid !== process.geteuid() || (stat.mode & 0o077)) throw Error('unsafe wallet path');
    return fd;
  } catch (e) { closeSync(fd); throw e; }
}
// Owner lease: an exclusive flock(2) on owner.lock, held by the retained open
// file description. Same semantics on Linux and macOS:
// - Linux: /usr/bin/flock locks the inherited descriptor (works under Node and Bun).
// - macOS: no flock(1); Bun calls flock(2) through bun:ffi, Node falls back to the
//   system perl, which locks the inherited descriptor the same way.
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
export function acquire(root, { create = false } = {}) {
  if (isMainThread || !['linux', 'darwin'].includes(process.platform)) throw Error('dedicated Linux or macOS worker required');
  let base, lock, dir;
  try {
    base = fs.realpathSync(root);
    dir = checkedOpen(base, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY, true);
    lock = checkedOpen(`${base}/owner.lock`, fs.constants.O_CREAT | fs.constants.O_RDWR);
    lockExclusive(lock);
    // Validate BOTH preexisting files before SQLite can mutate either one.
    for (const name of ['wallet.db', 'wallet.db-journal']) {
      try { closeSync(checkedOpen(`${base}/${name}`, fs.constants.O_RDONLY)); }
      catch (e) { if (e.code !== 'ENOENT' || (name === 'wallet.db' && !create)) throw e; }
    }
  } catch (e) {
    if (dir !== undefined) closeSync(dir);
    if (lock !== undefined) closeSync(lock);
    throw Object.assign(Error(e.code === 'EBUSY' ? 'exclusive owner unavailable' : 'STORAGE_OPEN_FAILED'),
      { code: e.code === 'EBUSY' ? 'EBUSY' : 'EIO' });
  }
  const descriptors = new Set();
  const host = {
    owned: true,
    open(path, make, readOnly) {
      const fd = checkedOpen(`${base}/${path}`, (readOnly ? fs.constants.O_RDONLY : fs.constants.O_RDWR) | (make ? fs.constants.O_CREAT : 0));
      // Persist namespace entries before journal/database writes can depend on them.
      try { fs.fsyncSync(dir); } catch (e) { closeSync(fd); throw e; }
      descriptors.add(fd); return fd;
    },
    close(fd) { durableSync(fd); fs.closeSync(fd); descriptors.delete(fd); },
    read: (fd, b, at) => fs.readSync(fd, b, 0, b.length, at),
    write: (fd, b, at) => fs.writeSync(fd, b, 0, b.length, at),
    truncate: (fd, size) => fs.ftruncateSync(fd, size),
    sync: fd => durableSync(fd),
    size: fd => fs.fstatSync(fd).size,
    delete(path, sync) {
      try { fs.unlinkSync(`${base}/${path}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (sync) { fs.fsyncSync(dir); }
    },
    access(path, flags) {
      try { fs.accessSync(`${base}/${path}`, flags === 1 ? fs.constants.R_OK | fs.constants.W_OK : flags === 2 ? fs.constants.R_OK : fs.constants.F_OK); return true; }
      catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    },
    release() {
      if (!host.owned) return;
      // Hold the lease until every data descriptor is closed.
      for (const fd of descriptors) { fs.closeSync(fd); descriptors.delete(fd); }
      descriptors.clear(); fs.closeSync(dir); fs.closeSync(lock); host.owned = false;
    },
  };
  return host;
}
