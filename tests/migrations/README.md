# Network upgrade scenarios

These tests follow funded wallets across consensus network upgrades. They are
not database-schema migration tests; those remain in `tests/wallet_native.rs`
and `tests/wallet-views/native.rs`.

`nu6-to-nu7.rs` keeps the complete scenario in one file: fund, propose before
activation, cross activation without changing the network or database, build
and verify a signature, reopen the saved artifact, and rewind. The actual
pre-upgrade epoch is **NU6.3**, in the NU6 family, not base NU6.

Use the host prerequisites and pinned Rust toolchain in [BUILDING.md](../../BUILDING.md):
Node 22+, Git, curl, a C compiler/binutils, and rustup on supported macOS or
Linux x86_64 (including WSL2). The locked Cargo dependencies and materialized
`native-policy/vendor` patches must already be available; the existing
`cargo xtask build` prepares them (its default Cargo cache is `.cache/sdk/cargo`).
Use that `CARGO_HOME` if that is where dependencies were fetched.

From the repository root, run with a fresh scratch directory:

```sh
WALLET_TEST_ROOT=$(mktemp -d) cargo test --locked --offline --features wallet-storage --lib nu6_to_nu7::funded_wallet_crosses_nu7_builds_and_signs_then_rewinds -- --nocapture
```

Add the next upgrade as a new, explicitly named scenario file here, keeping
previous scenarios intact. Add an explicit `#[path = "../migrations/…"]` module
in `tests/wallet-views/native.rs`, following `nu6_to_nu7`. These are modules of
the existing native library test suite, not standalone Cargo integration test
targets: do not add `tests/migrations.rs` or `tests/migrations/main.rs`, which
would trigger Cargo auto-discovery. Reuse existing fixture mechanics when
helpful; keep the upgrade phases and assertions visible in each scenario.
