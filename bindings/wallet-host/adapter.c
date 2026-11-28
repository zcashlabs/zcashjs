/* Same-instance VFS adapted from qualification/storage; see wallet-host/PROVENANCE.md. */
#include "sqlite3.h"
#include <stdint.h>
#include <stddef.h>
#include <string.h>

_Static_assert(sizeof(void*) == 4 && sizeof(int) == 4, "wasm32 scalar ABI");
_Static_assert(sizeof(sqlite3_int64) == 8 && sizeof(double) == 8, "time ABI");
_Static_assert(_Alignof(double) == 8, "double alignment");

__attribute__((import_module("./wallet-host/storage-host.mjs"), import_name("entropy")))
extern int host_entropy(void*, int);
__attribute__((import_module("./wallet-host/storage-host.mjs"), import_name("utc_ms")))
extern double host_utc_ms(void);
__attribute__((import_module("./wallet-host/storage-host.mjs"), import_name("sleep")))
extern int host_sleep(int);

#define POOL_BYTES (16 * 1024 * 1024)
static _Alignas(8) unsigned char pool[POOL_BYTES];
static int ready, attempted;

#define IMPORT(name) __attribute__((import_module("./wallet-host/storage-host.mjs"), import_name(#name)))
IMPORT(file_open) extern int file_open(const char*, int, int*);
IMPORT(file_close) extern int file_close(int);
IMPORT(file_read) extern int file_read(int, void*, int, sqlite3_int64);
IMPORT(file_write) extern int file_write(int, const void*, int, sqlite3_int64);
IMPORT(file_truncate) extern int file_truncate(int, sqlite3_int64);
IMPORT(file_sync) extern int file_sync(int, int);
IMPORT(file_size) extern int file_size(int, sqlite3_int64*);
IMPORT(file_lock) extern int file_lock(int, int);
IMPORT(file_unlock) extern int file_unlock(int, int);
IMPORT(file_reserved) extern int file_reserved(int, int*);
IMPORT(file_delete) extern int file_delete(const char*, int);
IMPORT(file_access) extern int file_access(const char*, int, int*);
IMPORT(host_error) extern int host_error(int, char*);
typedef struct { sqlite3_file base; int id; } HostFile;
static int close_file(sqlite3_file *f) { int rc = file_close(((HostFile*)f)->id); f->pMethods = 0; return rc; }
static int read_file(sqlite3_file *f, void *p, int n, sqlite3_int64 at) { return file_read(((HostFile*)f)->id, p, n, at); }
static int write_file(sqlite3_file *f, const void *p, int n, sqlite3_int64 at) { return file_write(((HostFile*)f)->id, p, n, at); }
static int truncate_file(sqlite3_file *f, sqlite3_int64 n) { return file_truncate(((HostFile*)f)->id, n); }
static int sync_file(sqlite3_file *f, int flags) { return file_sync(((HostFile*)f)->id, flags); }
static int size_file(sqlite3_file *f, sqlite3_int64 *n) { return file_size(((HostFile*)f)->id, n); }
static int lock_file(sqlite3_file *f, int level) { return file_lock(((HostFile*)f)->id, level); }
static int unlock_file(sqlite3_file *f, int level) { return file_unlock(((HostFile*)f)->id, level); }
static int reserved_file(sqlite3_file *f, int *out) { return file_reserved(((HostFile*)f)->id, out); }
static int control_file(sqlite3_file *f, int op, void *p) { return SQLITE_NOTFOUND; }
static int sector_file(sqlite3_file *f) { return 4096; }
static int device_file(sqlite3_file *f) { return 0; }
static const sqlite3_io_methods methods = {
 .iVersion=1, .xClose=close_file, .xRead=read_file, .xWrite=write_file,
 .xTruncate=truncate_file, .xSync=sync_file, .xFileSize=size_file,
 .xLock=lock_file, .xUnlock=unlock_file, .xCheckReservedLock=reserved_file,
 .xFileControl=control_file, .xSectorSize=sector_file, .xDeviceCharacteristics=device_file
};
static int open_file(sqlite3_vfs *v, const char *name, sqlite3_file *f, int flags, int *out) {
 f->pMethods = 0;
 if (!name || (strcmp(name,"/wallet.db") && strcmp(name,"/wallet.db-journal"))) return SQLITE_CANTOPEN;
 int id = 0, rc = file_open(name, flags, &id);
 if (rc) return rc;
 ((HostFile*)f)->id = id; f->pMethods = &methods;
 if (out) *out = flags;
 return SQLITE_OK;
}
static int delete_file(sqlite3_vfs *v, const char *name, int sync) { return file_delete(name, sync); }
static int access_file(sqlite3_vfs *v, const char *name, int flags, int *out) { return file_access(name, flags, out); }
static int path(sqlite3_vfs *v, const char *name, int size, char *out) {
  size_t n = strlen(name);
  if (size <= 0 || n >= (size_t)size) return SQLITE_CANTOPEN;
  memcpy(out, name, n + 1);
  return SQLITE_OK;
}
static void *dl_open(sqlite3_vfs *v, const char *name) { return 0; }
static void dl_error(sqlite3_vfs *v, int size, char *out) {
  if (size > 0) { const char *s = "host filesystem/extension unavailable";
    size_t n = strlen(s); if (n >= (size_t)size) n = (size_t)size - 1;
    memcpy(out, s, n); out[n] = 0; }
}
static void (*dl_sym(sqlite3_vfs *v, void *h, const char *s))(void) { return 0; }
static void dl_close(sqlite3_vfs *v, void *h) { }
static int randomness(sqlite3_vfs *v, int size, char *out) {
  if (size < 0 || host_entropy(out, size) != size) __builtin_trap();
  return size;
}
static int sleep_us(sqlite3_vfs *v, int us) { return host_sleep(us); }
static int time_ms(sqlite3_vfs *v, sqlite3_int64 *out) {
  double t = host_utc_ms();
  if (!(t >= 0 && t < 8000000000000000.0)) return SQLITE_IOERR;
  *out = (sqlite3_int64)t + INT64_C(210866760000000);
  return SQLITE_OK;
}
static int time_days(sqlite3_vfs *v, double *out) {
  sqlite3_int64 t;
  int rc = time_ms(v, &t);
  if (rc == SQLITE_OK) *out = (double)t / 86400000.0;
  return rc;
}
static int last_error(sqlite3_vfs *v, int size, char *out) {
  return host_error(size, out);
}
static sqlite3_vfs lower = {
  .iVersion = 2, .szOsFile = sizeof(HostFile), .mxPathname = 512,
  .zName = "storage-host", .xOpen = open_file, .xDelete = delete_file,
  .xAccess = access_file, .xFullPathname = path, .xDlOpen = dl_open, .xDlError = dl_error,
  .xDlSym = dl_sym, .xDlClose = dl_close, .xRandomness = randomness,
  .xSleep = sleep_us, .xCurrentTime = time_days, .xGetLastError = last_error,
  .xCurrentTimeInt64 = time_ms,
};

int sqlite3_os_init(void) { return sqlite3_vfs_register(&lower, 1); }
int sqlite3_os_end(void) { return sqlite3_vfs_unregister(&lower); }
int wallet_ready(void) { return ready; }
int wallet_runtime_init(void) {
  if (attempted++) return SQLITE_MISUSE;
  unsigned char entropy[32];
  if (host_entropy(entropy, sizeof(entropy)) != sizeof(entropy)) return SQLITE_IOERR;
  int rc = sqlite3_config(SQLITE_CONFIG_HEAP, pool, POOL_BYTES, 64);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_initialize();
  if (rc != SQLITE_OK) return rc;
  if (sqlite3_vfs_find("storage-host") != &lower) return SQLITE_ERROR;
  ready = 1;
  return SQLITE_OK;
}
unsigned wallet_pool_start(void) { return (unsigned)(uintptr_t)pool; }
unsigned wallet_pool_size(void) { return POOL_BYTES; }
double wallet_time(void) { return host_utc_ms(); }

/* This bounded wrapper exposes no arbitrary SQL, and authorizes only the tested policy. */
static int authorize(void *p, int op, const char *a, const char *b, const char *db, const char *trigger) {
 if (op == SQLITE_ATTACH || op == SQLITE_DETACH) return SQLITE_DENY;
 if (op == SQLITE_PRAGMA && b) {
  if (!sqlite3_stricmp(a,"journal_mode") && sqlite3_stricmp(b,p ? "memory" : "truncate")) return SQLITE_DENY;
  if (!sqlite3_stricmp(a,"synchronous") && sqlite3_stricmp(b,"full") && strcmp(b,"2")) return SQLITE_DENY;
  if (!sqlite3_stricmp(a,"locking_mode") && sqlite3_stricmp(b,"normal")) return SQLITE_DENY;
  if (!sqlite3_stricmp(a,"temp_store") && sqlite3_stricmp(b,"memory") && strcmp(b,"2")) return SQLITE_DENY;
 }
 return SQLITE_OK;
}
int wallet_policy(sqlite3 *db, int memory) { return sqlite3_set_authorizer(db, authorize, memory ? (void*)1 : 0); }

