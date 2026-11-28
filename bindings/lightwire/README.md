# Private stateless lightwallet protobuf codec

This nested production crate owns Rust/prost/WASM encoding and decoding for all methods in the frozen `LightUnaryMethod` and `LightStreamMethod` unions. It has its own Cargo workspace and lockfile, `publish = false`, and no wallet, SQLite, transport, network-I/O, or test-feature dependency. It does not change the repository's root API/build.

The JS facade creates one synchronous module-owned codec from an owned copy of the matching generated WASM bytes:

```js
import { createLightwire } from './codec.mjs';
const codec = createLightwire(wasmBytes);
const request = codec.encodeRequest('GetTaddressBalance', '{"addresses":["synthetic"]}');
const balance = codec.decodeResponse('GetTaddressBalance', responseBytes);
const block = codec.decodeItem('GetBlockRange', itemBytes);
```

The private `codec.encodeTreeState(jsonText)` operation encodes the same bounded `TreeState` response DTO, including `orchard_tree`, using the pinned prost message. This additive operation requires freshly built matching glue/WASM and capsule hashes; it does not change the method/schema revision or validate consensus tree contents.

Initialize once per imported module. Operations are stateless and synchronous; there are no handles, persistent state, sockets, retries, or cleanup callbacks. The generated glue releases operation argument buffers. Every result owns its data; input mutation after a call cannot change it. Import the facade and its matching generated `wasm/` directory together. The raw generated bindings are an internal implementation boundary, not a separately supported JS API.

## Internal DTO contract

DTO records use the published prost Rust field names (`snake_case`), as visible in [src/messages.rs](src/messages.rs). Byte fields are **lowercase, even-length hexadecimal strings**, preserving the exact protobuf byte sequence. Every `uint64` and `int64` is a **canonical decimal string**, including `"0"`, `"18446744073709551615"`, and signed `"-9223372036854775808"`. Leading zeros, `+`, whitespace and `-0` are rejected. `uint32`, `int32`, and enum fields are exact integral JS numbers in their Rust range; booleans and strings retain their protobuf types. No bigint or lossy JS-number conversion is performed.

Nested messages are records or `null` when absent; repeated fields are dense arrays. Request fields may be omitted to select protobuf defaults. Decoded DTOs contain all schema fields, including defaults. encodeRequest accepts only primitive JSON text, not caller objects. Unknown DTO keys, duplicate JSON keys, invalid Unicode and invalid numeric tokens are rejected. Boxed strings, proxies and all other non-string inputs reject by type without enumeration or coercion. This is an explicit private boundary change requiring independent R2 acceptance; public SDK declarations and consumers are unchanged. Bytes supplied to the facade must be genuine `Uint8Array` views with ordinary, nonshared, nondetached backing stores and currently in-bounds original views; intrinsic backing-store checks also reject disguised SharedArrayBuffers.

| Exact method | Kind | Request DTO | Response/item DTO |
| --- | --- | --- | --- |
| GetLatestBlock | unary | ChainSpec | BlockId |
| GetLightdInfo | unary | Empty | LightdInfo |
| GetTransaction | unary | TxFilter | RawTransaction |
| GetAddressUtxos | unary | GetAddressUtxosArg | GetAddressUtxosReplyList |
| GetTaddressBalance | unary | AddressList | Balance |
| GetTreeState | unary | BlockId | TreeState |
| SendTransaction | unary | RawTransaction | SendResponse |
| GetSubtreeRoots | stream | GetSubtreeRootsArg | SubtreeRoot |
| GetBlockRange | stream | BlockRange | CompactBlock |
| GetTaddressTransactions | stream | TransparentAddressBlockFilter | RawTransaction |
| GetMempoolStream | stream | Empty | RawTransaction |

Unknown IDs and use of a unary method as a stream (or vice versa) fail. There are no compatibility aliases. `GetTaddressBalance` is the source-defined unary `AddressList` RPC on both Node and browsers; it does not use client-streaming `GetTaddressBalanceStream`.

## Wire safety and semantic boundary

Before prost decoding, allocation-free preflight checks enforce a 4 MiB message, 1 MiB length-delimited field, 8,192 total field/packed-item occurrences (including nested messages and unknown groups), and depth 16. Varints must fit 64 bits; field numbers must fit protobuf's 29 bits and be nonzero; lengths must fit the remaining bytes; known wire types, uint32/int32 ranges and UTF-8 are checked. Unknown well-formed fields are skipped as protobuf permits, including correctly paired groups. Known duplicate fields retain prost's scalar-last/message-merge behavior; every occurrence consumes the shared budget. Nonminimal but bounded protobuf varints are allowed. Overflow, truncation, mismatched groups and malformed unknown fields fail.

The native JSON entry point caps UTF-8 input at 8 MiB and scans string/depth/item budgets before serde allocates its DTO tree. Byte-string text is capped at 2 MiB, decoded strings at 1 MiB, and encoded output length is checked before allocation. Before generated glue, the facade checks primitive string length and counts UTF-8 bytes without an encoding buffer, rejecting over 8 MiB and lone UTF-16 surrogates. Escaped lone surrogates reject in Rust JSON validation. Valid surrogate pairs retain their exact Unicode value. No caller-object serializer or trusted-object convenience is provided. These checks bound codec work on admitted text, not arbitrary caller code, prior string creation, or engine allocations globally. These are fixed codec resource policies, not consensus limits or transport queue bounds.

This is a lossless wire DTO codec, **not a public LightClient result validator**. It retains signed balances/UTXO values, unknown enum values, empty/default protobuf fields and opaque transaction/tree/compact bytes. A composing client must apply its approved positive-balance/index, query bounds, fixed hash/cryptographic structure, inclusion, and network-context rules. No cryptographic validity, consensus checks, success/null mapping, or successful broadcast is invented here. Errors throw/return errors; malformed messages never become null.

Byte order is deliberately preserved rather than guessed. Reference lightwalletd `09593edbee4ee68d47e5a53f8ce1c83514c4e8e6`, `frontend/service.go`, reverses `GetTransaction` filter hash bytes to display hex (466–467) and reverses the latest block display hash into `BlockID.hash` (83–86), while `GetTreeState` interprets `BlockID.hash` as **display-order bytes** (381–384). `TreeState.hash` is a display string; compact transaction IDs remain protocol-order bytes. Applications must adapt per method; there is no universal byte reversal here.

`RawTransaction.height` preserves the full uint64 sentinel: GetTransaction's 0 means mempool, max means off-main-chain; GetMempoolStream's height is a tip marker and does not prove inclusion. `SendResponse.error_message` stays a string, including the reference server's quoted JSON txid success result; no transaction-ID claim is made. Empty wire messages decode to proto3 defaults, not absence. Transport statuses, trailers, stream completion, range/reorg checks, genesis handshake, send, H1 and package acceptance remain separate.

## Pinned provenance and generation

[Vendor provenance](vendor/PROVENANCE.json) records the already-qualified lock and archive checksums. Published `zakura-client-backend =0.1.0-rc4` contains generated prost definitions, but its crate graph has no proto-only feature and imports wallet/crypto/proposal machinery. The two published generated files are therefore retained **byte-for-byte** under `vendor/`; the backend is not a runtime dependency. Its archive checksum was verified and both retained files were compared to archive members. `prost =0.14.4` is exact and the minimal dependency graph is locked.

The exact wallet source commit is `a9142ee100b3a563b7d9ba7a8e94201d00ad8154`. The vendored v0.5.0 `.proto` files and hashes are retained in [vendor/SHA256.json](vendor/SHA256.json); service.proto differs from upstream protocol commit `ac7cee052a1bf5d430985a478d39e8b513fc4bd4` by one comment. The schema hashes identify this codec; the composing transport must match its pinned schema revision before use. Server-advertised protocol version is a separate value.

`cargo xtask generate` extracts only reachable published message/enum definitions, preserving prost attributes and adding serde DTO annotations; it also emits the matching preflight descriptors and exact method dispatch. It does not run protoc or generate a network client. Generated Rust source is committed. `cargo xtask generate --check` unconditionally checks source hashes and exact generated output. Upstream copyright/license notices in the retained source are preserved; this work makes no new repository license choice.

## Build and tests

From the repository root, follow [BUILDING.md](../BUILDING.md):

```sh
cargo xtask build
LIGHTWIRE_BUILD="$PWD/build/sdk/lightwire" node lightwire/tests/facade.test.mjs
LIGHTWIRE_BUILD="$PWD/build/sdk/lightwire" node lightwire/tests/firefox.mjs
```

The task verifies locked crate archives and extracted sources, checks generation,
runs native tests offline and builds WASM. It records the Cargo graph, source
inventory and artifact hashes. A failed build has no successful root receipt;
`built` in a codec receipt means build completion, not browser acceptance.

The independent oracle uses already-installed Python `google.protobuf` 6.33.5 with descriptors parsed directly from the pinned `.proto` files, independently of the production Rust/generator. It cross-checks 22 committed full-field wire vectors, and 1,638 malformed cuts. Native and actual Node/WASM tests exercise these plus hostile/resource-boundary controls. Rust task tests cover source mutation, output preservation and inventory safety. Run the optional oracle with `python3 lightwire/tests/golden.py`.

Firefox uses an ordinary page-owned `type=module` entry, not automation-realm imports. The runner serves only preloaded owned local assets, validates selected artifact hashes, checks missing paths, uses unchanged installed `/snap/bin/geckodriver`/Firefox and `acceptInsecureCerts:false`, and retains process/profile identities and bounded cleanup receipts. Its cross-origin isolation headers enable the required SharedArrayBuffer negative controls without disabling browser security. If worker loopback sockets are denied, the parent must run this exact runner on the permitted host. Browser runtime and interruption cleanup remain unqualified until actual receipts pass. No live endpoint, funds or deployment is involved.
