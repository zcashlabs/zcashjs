# Owned dependency patches

`upstream.json` pins the source archive and SHA-256 for each patched crate.
`cargo xtask build` verifies those archives, materializes `vendor/`, applies the
matching patches, and records the patched source inventory in its build receipt.
Cargo uses the materialized paths through the root `[patch.crates-io]` entries.

The `zakura-zip321` 4.0.0 patch accepts optional extension flags without `=`, as
allowed by [ZIP-321's `otherparam` production](https://zips.z.cash/zip-0321#uri-syntax).
For example, `merchantflag` and
`merchantflag=` produce the same request and canonical URI. It keeps the existing
requirement for `=` on payment fields and rejects bare unknown `req-` parameters.
The change lives in the shared codec so incoming requests and retained proposal
URIs use the same parser. No dependency versions are changed; the upstream
archive checksum remains in `upstream.json` for the patched path dependency.

`tests/wallet-views/zip321.rs` exercises the backend's codec re-export in the
native library suite. It covers unindexed and sparse indexed flags, canonical
round trips, case preservation, and rejection of malformed or required fields:

```sh
cargo test --locked --offline --lib --features wallet-storage optional_flags_
```

Once an upstream release includes the fix, remove the owned patch when updating
the pinned codec and keep the regression tests.
