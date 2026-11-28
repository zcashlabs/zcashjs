# Private transparent-address codec

This independent, unpublished workspace decodes synthetic P2PKH/P2SH address tokens using pinned `zcash_address 0.13.0` and `zcash_protocol 0.10.6`. It does not identify a chain, own an account, validate spendability, select a pool, extract unified receivers, or provide a client. No root producer, loader, SDK or wallet integration is included.

`createTransparentAddressCodec(wasmBytes)` initializes this module once, synchronously, from an owned copy of an actual Uint8Array view of at most 16 MiB. Shared, detached, out-of-bounds and proxy views are rejected; shadowed view properties are ignored. Invalid initialization does not mark the module initialized. Generated glue is an internal implementation detail, not the admitted facade.

`codec.decode(token, encodingFamily)` accepts primitive strings only. Family is exactly `main`, `test`, or `regtest`: private native encoding-family semantics, not a registered Network or consensus identity. Token is 1–128 ASCII characters U+0021–U+007E. In particular, no whitespace, Unicode normalization, trimming, case folding or typo repair is performed. Native parsing normally trims Unicode whitespace; this narrower admission deliberately rejects it first. Transparent canonical strings currently equal their admitted input. Native `encode()` supplies the returned canonical string.

Result: `{ canonical: string, kind: 'p2pkh' | 'p2sh', payload: Uint8Array }`, with an independently owned 20-byte payload on every call. Native `TryFromAddress` implements only those two kinds. Test transparent prefixes also accept regtest through native `convert_if_network`; main/test mismatch fails. TEX, Sprout, Sapling, unified and unknown kinds fail. Tokens over the bound fail before native parsing, including larger unsupported encodings. Errors are intentionally coarse: admission errors, invalid encoding, or unsupported/mismatched family; no stable exhaustive native error taxonomy is promised.

Private ABI v1 `transparent_address_decode(token, family)` returns kind byte 0/1, 20 receiver bytes, then native canonical ASCII bytes, or a JavaScript Error. No retained native object or authority handle exists.

Build from the repository root following [BUILDING.md](../BUILDING.md). The task
verifies locked crate archives and extracted sources and records source, graph,
tool and artifact hashes. Output directories must be new.

```sh
cargo xtask build
node transparent-address/tests/node.mjs "$PWD/build/sdk/transparent-address"
node transparent-address/tests/firefox.mjs "$PWD/build/sdk/transparent-address" "$LOGS/browser" "$SCRATCH/browser"
```

Native tests and shared Node/page/worker tests use source vectors from commit `882ecd278050bb92365c9d1250c55f0dadc0f648`, `components/zcash_address/src/encoding.rs:278–376`. Four receiver expectations are explicitly twenty zero bytes. Nonzero expectations are `8286bf790866805397e3a947640b77a43f0b43a5` (independently unpacked from the paired TEX data symbols) and twenty `01` bytes. These are structural fixtures, never live chain probes.

`tests/qualify.py --manifest PATH --sha256 HASH --logs NEW_LOG_ROOT --scratch NEW_SCRATCH_ROOT` is the finite parent helper when local loopback permission is unavailable. Manifest authenticates all source, generated assets and tool binaries. It executes one ordinary Firefox page plus worker run and four real signal controls: SIGINT/SIGTERM during driver acquisition and during an owned active session. Receipts distinguish termination requests from observed OS process destruction; worker `terminate()` is a page observation, not an independent OS worker liveness proof. Driver/browser identities and cleanup are observed through `/proc`, with bounded session/server/group/browser teardown. No privileged browser flags or installation. A timeout with forced runner kill is failure and explicitly requires external resource verification.

Prepared helpers and receipts are not qualification. Actual Node26.8.1 checks do not establish Node20/22 support. Ordinary Firefox execution and independent HIGH review remain acceptance requirements; see the external task report for actual results and remaining holds.
