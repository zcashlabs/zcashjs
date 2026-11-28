# Node wallet path ownership

The Linux Node host requires an existing, exclusively application-owned directory.
The application provisions it with mode 0700, owned by the effective process UID,
in a trusted parent hierarchy. No group/other permission bits are accepted on the
root, database, journal or owner lock. Existing application directories are
supported; the host does not create or chmod the root. New files use mode 0600.
ACLs, privileged processes and other code running as the same UID must also respect
exclusive application ownership. The host does not audit parent directories or ACLs.

Root symlinks are intentionally canonicalized with realpath: aliases to the same
root contend on the same retained flock. Final-component symlinks for wallet.db,
wallet.db-journal and owner.lock are rejected. Each opened file descriptor must
identify a regular file with exactly one hard link and the expected UID/permissions.
Directories and FIFOs are rejected; O_NONBLOCK prevents a FIFO open from waiting
for a peer. O_NOFOLLOW alone is not hard-link protection.

Both preexisting database and journal are checked before returning a host, so an
invalid journal cannot first trigger database mutation. Every later data open is
checked again using fstat on that opened descriptor before reads, writes, truncation
or file sync. Failed admission closes its descriptors and releases its flock;
errors expose only STORAGE_OPEN_FAILED (or STORAGE_BUSY for contention).

The application must not link, replace, rename, chmod or otherwise mutate these
paths/inodes while an owner is active, including from another same-UID process.
Descriptor checks avoid a stat-then-open identity check; they do not prevent later
external namespace mutation. This is not protection against arbitrary external
filesystem tampering. SQLite locks are owner-local; rejecting aliases and retaining
the directory lease are therefore essential. Ordinary same-root contention,
close, observed worker destruction and reopen remain supported. Worker unmanaged
FD tracking must stay enabled for destruction cleanup.
