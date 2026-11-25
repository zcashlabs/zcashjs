# Owned dependency patches

`upstream.json` pins the source archive and SHA-256 for each patched crate.
`cargo xtask build` verifies those archives, materializes `vendor/`, applies the
matching patches, and records the patched source inventory in its build receipt.
Cargo uses the materialized paths through the root `[patch.crates-io]` entries.

These patches are being removed (#46). Do not add new ones.

ZIP-321 optional flags without `=` are no longer patched into `zakura-zip321`;
`src/wallet/proposal.rs` normalizes them before the unmodified backend codec parses the
request. `tests/wallet-views/zip321.rs` covers that path:

```sh
cargo test --locked --offline --lib --features wallet-storage optional_flags_
```
