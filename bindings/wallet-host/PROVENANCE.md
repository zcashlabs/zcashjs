# Private storage source provenance

Adapted from read-only `/home/jack/zcash.js/qualification/storage` at SDK commit `37cd3ca56dd639f127074136c3b5129706a0415d`. This identifies inspected source, not acceptance of this production adaptation.

| Input | SHA-256 |
|---|---|
| `adapter.c` | `b9acae77350f61033a383fb89257423213b17471a2ee163475db290274eadaa5` |
| `storage-host.mjs` | `bfe06e9afa362cbc93e323eb88d400d2bd918af9b055bbe39efedbc47e5ae029` |
| `node-fs.mjs` | `190d4c270080ca76a60ae570742b8d78b2756e125a7098ae310ed3a3cb3b65a0` |
| `opfs.mjs` | `a0076ae8984f72b0d0ddc3d0dfb4fa897ee98e88f90240fb1dd447e3f361f4e4` |
| `run-firefox.mjs` | `fe0efdfe0315ef62d6cf310875e9e0f781fc7f769368102080d6b6247b089007` |

The C adapter retains only VFS callbacks, the 16 MiB memsys5 allocator, initialization and policy authorization. Qualification allocation loops, canary assertions, VFS controls, SQL commands, trace buffers and fault/crash injection are excluded from production. Node retains Linux flock on a worker-owned descriptor. OPFS retains exclusive synchronous handles acquired main-file-first and released main-file-last. The browser runner adapts the existing runner; its test is an ordinary page module and requires observed BiDi destruction before replacement.

`migrations.txt` is the sorted 66 `MIGRATION_ID` constants from the checksum-pinned published SQLite RC4 `src/wallet/init/migrations/*.rs`, in 32-hex format. Schemerz ignores unknown applied IDs, so this wrapper checks the inventory explicitly before migration. The host-owned `ext_wallet_storage` bootstrap migration is committed before backend migration, binding interrupted initialization to exact canonical parameter bytes and registered genesis bytes. It contains no account, key, operation or outbox state.

Published package pins (the build verifies archives and every extracted source file):

- `libsqlite3-sys 0.35.0`: `133c182a6a2c87864fe97778797e46c7e999672690dc9fa3ee8e241aa4a9c13f`
- `rusqlite 0.37.0`: `165ca6e57b20e1351573e3729b958bc62f0e48025386970b6e4d29e7a7e71f3f`
- `zakura-client-backend 0.1.0-rc4`: `5a70f61bb142b29dfd260561cccb21a657acdf86c2e901189817acdf3e25d5d6`
- `zakura-client-sqlite 0.1.0-rc4`: `0b1a4276239587ef4090c28320246c76fb25a6a76b788020d0082e128153c53b`
- `zakura-pczt 0.1.0-rc2`: `5fc78b3e1d6fe525d7e1a7fb17bc07bcc580a21f07ce1aa205cbc29b09f72d30`
- `zcash_protocol 0.10.6`: `b20adb1cdb6ab551e83d1507461e89b41fc67e800eec9e59e0c8de96152e8c5c`

No checkout patch or 1.1.0 migration. PCZT `io-finalizer` is enabled only because the published SQLite migration calls feature-gated `into_effects`. Runtime cryptographic entropy uses the published getrandom/UUID WebCrypto paths and the qualified VFS entropy callback; native uses OS entropy. `HostClock` calls the real host clock. A host-service failure may trap where the backend requires an infallible trait; the owner must then be destroyed, never reused.

`build-wallet.py` records the committed source tree, verified dependency sources, lockfile, effective flags, producing commands/log hashes, SDK inventory, generator and executable hashes, actual WASM imports/memory limits and all artifact hashes. Generator 0.2.128 output is unchanged. All build caches and artifacts are under the assigned scratch root. The original `build.py` and primitive JS/Rust behavior are unchanged; old Node tests execute a separately generated baseline artifact.
