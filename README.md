# Zakura native bindings

For the supported SDK build, see **[Build the native SDK components](BUILDING.md)**.
One command builds the baseline wallet and codecs using the pinned Rust toolchain:

```sh
cargo xtask build
```

The older qualification commands below describe historical builds, not the current
fresh-checkout workflow.

A `publish = false` production Rust binding crate for bounded network documents
and exact transaction bytes/identity, related to zcash.js #3/#4/#6. The crate name
`zakura-network-bindings` is retained for compatibility. Exact dependencies include
`zakura-protocol 4.0.0`, `zakura-primitives 4.0.0` (no defaults, std and backend-halo2), and genuine
`wasm-bindgen 0.2.128`, with the full Cargo lock.

The JS entry exposes `consensusContext(parametersFormat, parameters, height)` and
returns a frozen `{ height, branchId }`. It validates `zcash-js-network/1` or `zcash-js-network/2` and an
ordinary, attached Uint8Array (Node Buffer/subviews included), snapshots at most
256 bytes, and checks integer uint32 heights before generated-glue coercion.
Shared buffers and foreign-realm inputs are unsupported. Rust independently
validates the canonical document and calls the actual upstream
`BranchId::for_height`. Invalid documents/formats fail with fixed strings;
JS admission fails with TypeError. These are private binding errors, not H1 errors.

Version 1 requires all ten upgrade heights through Nu6_3. Version 2 requires
the same fields followed by Nu7. Heights are nondecreasing with null-only suffixes.
Version 1 retains its exact bytes and treats NU7 as inactive; version 2 can disable
NU7 explicitly with null. Format tags must match the canonical document. Equal heights use upstream order. The encoding selector never
imports a built-in schedule. The maximum valid document is under the 256-byte cap.
The parser adapts the independently accepted component at SDK revision
`a280d31d9e1c3c624cb9a340089b3ad79117e011`; its qualification crate stays intact.
No upstream workspace, branch constants, or live-chain schedules are copied into
production. The stateless operation needs no registry and retains no caller bytes.

## Explicit build

Use installed stable Rust with wasm32-unknown-unknown, Node, and the approved
bindgen binary pinned by SHA-256 in `build.py`. No tool installation or download
occurs. Seed an owned scratch Cargo registry with the 143 exact lock-checksummed
crate archives and matching existing registry index (this run records that copy
in `/home/jack/zakura-transaction-bindings-logs/cache-provenance.json`). Never write to
another worker's or global cache. All output/cache/log paths must be external.

```sh
REPRO=$(mktemp -d /home/jack/zakura-transaction-bindings-scratch/producer-repro.XXXXXX)
git worktree add --detach "$REPRO/source" acaf7069e466c82ce1be2c45ebafb75a92b59ee9
python3 "$REPRO/source/build.py" /home/jack/zakura-transaction-bindings-scratch "$REPRO/packet"
```

These commands reproduce the selected producing revision from a detached checkout,
with a new, nonexistent packet destination. Later documentation commits do not
produce the selected binaries. Exact reproduction requires the recorded installed
tools, locked inputs and same Cargo cache root
`/home/jack/zakura-transaction-bindings-scratch/cargo`: dependency panic paths embed
that location in WASM. Moving the cache can change WASM bytes even with identical
sources and tools (independent review S1). The selected normal/`-OO` equality is
for this same cache root. Reuse it only within its authorized ownership.

The destination must be new. Scope, tool identity, and committed-script guards
remain active under Python `-O` and `-OO`. Run the nonexecuting guard regression
with `python3 tests/test_build_guards.py` (also with `-O` and `-OO`). The script builds committed HEAD from a Git archive,
uses fresh targets with `--offline --locked`, runs native and generated Node
checks, and emits genuine web-target glue/WASM/declarations plus `network.mjs`, `transaction.mjs`, and their shared `bytes.mjs` guard.
`build.json` records producing commit/tree, lock, tools, graph and exact output
lengths/hashes. It is local build provenance; independently pin its hash in the
consumer. Two fresh builds can be compared byte-for-byte. Dev native checks use
`CARGO_HOME` and `CARGO_TARGET_DIR` pointing to owned external directories.

Initialize the generated entry using verified bytes:

```js
const bindings = await import('./network.mjs'); // verified local copy
bindings.initialize(verifiedWasmBytes);
const context = bindings.consensusContext('zcash-js-network/1', documentBytes, 20);
```

The generated `bindings.js` export is internal and assumes already checked
arguments. Initialization here is wasm-bindgen instantiation, with verified bytes
supplied explicitly (attached Uint8Array, at most 1 MiB; no URL/default fetch).
It is not `runtime_init` or host negotiation.

This packet supplies a lower-level branch context, not a public `ConsensusContext`
with registered `Network`, a runtime profile, or complete G4. Identity/genesis
registration, public defineNetwork, H1 executable loader/worker/ABI, full-client
genesis verification, wallet/storage/signing/proving/outbox remain separate gates.
The SDK integration stays entirely in `qualification/private-bindings-consumer`.

## Internal transaction codec

After the same explicit initialization, import `decodeTransaction(raw, branch)`
from `transaction.mjs`. `branch` is a primitive uint32 with an explicit known
upstream branch value. There is no default or guessed context. Input must be an
ordinary attached same-realm Uint8Array (Buffer/subviews supported), 1 through
2,097,152 bytes. The 2 MiB cap is this private binding's admission policy, not a
consensus maximum. The captured ArrayBuffer intrinsic rejects shared backing
stores even when their prototype is spoofed; length/type checks precede glue.

The frozen result record is `{ bytes: Uint8Array, txid: Uint8Array, display: string }`.
Both arrays are independently owned and intentionally mutable; no Rust handle or
WASM-memory view escapes. `bytes` is the admitted snapshot, returned only after
actual `Transaction::write` is byte-identical to it. `txid` contains the 32 actual
`Transaction::txid()` bytes in internal order, copied by unmodified wasm-bindgen;
`display` is their reversed lowercase hex form. Mutating inputs/results cannot
change other results. Generated `transaction_id` and shared `copyBytes` are
internal implementation exports; consumers use the checked entry.

Rust also bounds input, performs actual `Transaction::read` with full consumption,
requires V3–V6, explicit/embedded branch equality and upstream `valid_in_branch`,
then writes and rejects any changed bytes. This preserves the accepted R1 lossy
V4 rejection. The 13 test-only vectors are exact copies of accepted SDK
`qualification/transaction-codec/fixtures/vectors.json`, SHA256
`26cb21c3733ff8a57b4c99310cfb73331d6376a80a065513932349b497cfbd74`.
Common source is published 1.0.0 at `f4526b0fa86406589732c8fb3849855fb92c43a2`;
the independent qualification report is
`/home/jack/zcash-transaction-codec-logs/review/REPORT-r2.md`.

This is a byte/identity codec. It does not validate signatures, proofs, consensus,
activation, fee/expiry policy or spendability. It does not construct/sign/edit
transactions or implement the public SDK transaction factories. V1/V2 are
unsupported; parsing V3/V4 fixture components is not Sprout wallet support.
V5/V6 identities are effect digests, not hashes of every serialized byte.
Input bounding is not a complete execution-time/memory or panic-recovery budget.

Selected producing commit: `acaf7069e466c82ce1be2c45ebafb75a92b59ee9`;
build metadata SHA256
`09ae852de689eb47fba35dfefaae81397d280f5c2542bccdee9747954efad575`.
The packets `/home/jack/zakura-transaction-bindings-scratch/packet-final` and
`/home/jack/zakura-transaction-bindings-scratch/packet-final-OO` are byte-identical,
including metadata. Native and actual generated Node checks pass.

The selected consumer package is
`/home/jack/zakura-transaction-bindings-scratch/coordinator-final-1`, produced from
SDK runtime source `2c6c9c23b954662750d664aed323d48c19174213`, with SHA256SUMS digest
`dbf2c6891e73f69ae256f1e3ce6f756b7d7a68bb67c47123fc79a5e01cd89e18`.
SDK Node and actual parent Firefox execution passed: 196 network cases,
13 transaction vectors, 208 baseline adapter calls and 1,472 truncated-prefix
rejections. Firefox 155.0.1 also passed 28 network admissions and 23 pre-init
transaction controls. Its nonisolated page did not expose SharedArrayBuffer;
the six shared-store controls are Node evidence.

Actual Firefox receipt:
`/home/jack/zakura-transaction-bindings-logs/browser/firefox-1789157899032.json`;
parent log: `/home/jack/zakura-transaction-bindings-logs/coordinator-browser-final.log`.
Session deletion, driver-group disappearance and server closure are all recorded
true, with no cleanup error and `acceptInsecureCerts: false`.
The SDK consumer README's fresh `mktemp` verification/preparation commands select
`packet-final`; parent verified them in `coordinator-doc-repro.log`.

Final coordinator R1 documentation closure and command record:
`/home/jack/zakura-transaction-bindings-logs/fixes/REPORT.md` and
`/home/jack/zakura-transaction-bindings-logs/fixes/CLIresult.md`.
The original worker `REPORT.md` and `checkpoint.md`, obsolete packets and failed
browser attempt remain immutable historical evidence; its final `CLIresult.md`
is absent and its exit status is unknown. No worker restart is inferred or needed.
Independent review under `/home/jack/zakura-transaction-bindings-logs/review/`
qualified the bounded runtime checks but held final acceptance for R1.
This documentation fix still requires fresh independent review for R1 acceptance.
No push, merge, publication or deployment.

The private stateless lightwallet protobuf production codec is documented in [lightwire/README.md](lightwire/README.md).

## Private wallet storage lifecycle candidate

`initializeWalletRuntime(wasm).openMemory(format, parameters, genesis)` explicitly uses SQLite `:memory:` with the same wallet migrations and operations. It attaches no filesystem/OPFS backend, loses all state on close, and never serves as a fallback for durable storage failure. Durable connections retain their existing TRUNCATE journal policy; memory connections require MEMORY journals.

The optional `wallet-storage` feature and `wallet.mjs` implement an internal schema lifecycle primitive for a later H1 owner. This is **not `wallet_open`, `WalletClient`, or complete recovery**. The branch starts from transaction candidate `acaf706`, which remains under independent review.

`initializeStorage(verifiedWasmBytes, ownedBackend, format, parameters, genesis)` returns an instance-bound storage owner with `binding(generation, instance)` and `close(generation, instance)`. The enclosing host must supply an already validated version-1 or version-2 network registration and checked genesis; this primitive persists and compares that identity, without making network requests to authenticate it. Parameters lower through the unchanged frozen parser. The backend performs real WalletDb migrations, loads rusqlite's array module and queries the resulting account schema. There are no account/signing/send or arbitrary SQL commands.

The deliberate bound is **one initialization attempt and one active DB per dedicated worker**, with one bundled SQLite instance, no shared memory, a 16 MiB SQLite allocator and a 256 MiB WASM memory maximum. Use a fresh worker for reopening. The raw Rust generation is worker-local; JS also checks a fresh CSPRNG instance identity. Inputs are checked and copied before generated glue and outputs are independent copies. No memory storage fallback exists.

Linux Node uses `wallet-host/node-worker.mjs`, worker-tracked descriptors and `/usr/bin/flock` for cross-process exclusion. Other Node operating systems are unsupported by this bounded adapter. Browser `wallet-host/browser-worker.mjs` uses dedicated-worker OPFS exclusive synchronous access handles. Both enforce TRUNCATE journals, FULL synchronization, temporary memory and a single storage owner. The private packaged worker entries load local artifact bytes; integration with the H1 verified-byte loader and request envelopes remains required before public use.

The host bootstrap commits `ext_wallet_storage` identity before backend migration. Only this primitive's marked databases (or genuinely empty new databases) are admitted; unmarked existing wallets require a separately reviewed adoption interface. Unknown host versions and unknown applied backend migrations reject. Migration errors fail closed; no secret-on-open path is added. Earlier migration transactions can remain committed after interruption; the interrupted transaction rolls back and reopening resumes on the same bound network.

Close errors remain errors, including VFS close errors SQLite itself may ignore. Admission stops, stale operations reject, and the lease remains held until worker destruction after a close failure. Successful close is idempotent at the JS wrapper; raw repeated Rust close rejects. An initialization failure, trap, OOM or worker loss requires domain destruction. Terminating a worker during mutation has an unknown commit outcome and requires reopening, not automatic replay.

Build from committed sources, with the existing cache copied into the assigned scratch `cargo` directory:

```sh
python3 -O build-wallet.py /home/jack/zakura-wallet-storage-scratch/NEW_BUILD
```

The builder runs actual native migrations, unchanged primitive Node tests, actual generated wallet WASM lifecycle/fault tests, process-crash recovery and an import/memory audit. It preserves failed stages and complete provenance. Browser execution requires the ordinary host command `node tests/wallet-firefox.mjs NEW_BUILD/bundle` with the existing packaged Firefox/geckodriver. Workspace loopback denial is not browser evidence; see the external `REPORT.md` and `checkpoint.md` in `/home/jack/zakura-wallet-storage-logs` for exact run status and the hash-pinned parent command. Injected I/O/quota faults, native quota exhaustion and UA eviction are separate claims; the latter two are not established here.

[Source/backend/VFS provenance](wallet-host/PROVENANCE.md). This bounded candidate stops for independent review, without claiming acceptance of issues #2, #4 or #5.

### Retained native signer authorization candidate

The worker-local signer table survives database close and signs through the pinned
native PCZT Signer role. The zakura-memory-signer/1 capability revision is bounded
to 4 MiB input/output, application review, and zakura-native-role-input/1 inputs.
This required-fields profile retains transparent BIP44 derivations, scripts and
public-key preimages; Sapling proof-generation key, alpha, note components and
witness; and Ironwood FVK, alpha and any supplied note components. Native checks
govern correspondence and consistency. It is not a redaction operation: the
existing zakura-signer-full/1 redactor removes Sapling witnesses and is insufficient
for signing a populated Sapling note with this pinned native role.
Account IDs are routing hints; native key correspondence is authoritative.

Qualified source fixtures cover transparent and Sapling V5 on Nu5, Nu6, Nu6_1,
Nu6_2 (PCZT wire 1 and 2), and all three pools V6 on Nu6_3 and Nu7 (wire 2).
Circuit labels are sapling-groth16/1 (the pinned Sapling spend/output circuit)
and ironwood-post-nu6_3/1 (native OrchardCircuitVersion::PostNu6_3);
transparent has no circuit label. These identify authorization context, not a
prover or proof-verification claim. Proof material is not required for signing.
Native role checks remain authoritative; unsupported/malformed material rejects.
Actual WASM and SDK qualification is separate from these native source fixtures.

### ZIP-321 payment requests

`proposal_create` and `proposal_lookup_intent` accept `payments` either as the
existing payment list or as a [ZIP-321](https://zips.z.cash/zip-0321) `zcash:`
URI string of at most 8192 characters. The URI is parsed by the pinned backend's
ZIP-321 codec. The scheme, the `req-` prefix and the parameter names `address`,
`amount`, `memo`, `label` and `message` are matched case-insensitively, because
ZIP-321's grammar is ABNF, whose literal strings are case-insensitive; other
parameter names, addresses and values are used as written. The URI must request
1 to 16 payments, and every address must be a non-Sprout address on the
wallet's network. The codec recognises no `req-` parameters, so any `req-`
parameter, including `req-asset` (Custom Assets), rejects the URI, as ZIP-321
requires for `req-` parameters a parser does not recognise. Every payment needs
a nonzero amount, although ZIP-321 itself permits a zero or omitted amount; a
URI's omitted amounts can be given as `amounts` (below).

Review payment outputs include the URI's `label` and `message`, or `null` where
absent. ZIP-321 says a wallet SHOULD display the label together with its
address, and if it displays the label, the label MUST be identifiable as
distinct from the address.

`payment_request_parse({uri})` checks a URI the same way, except that it allows
omitted amounts. It reads only the open wallet's network and changes nothing.
It returns `{payments:[{index,address,amount,memo,label,message}]}` in ascending
index order. `index` is a string (`'0'` for the payment without an index),
`amount` is zatoshis as a bigint, `memo` is the 512-byte memo as a `Uint8Array`,
and `amount`, `memo`, `label` and `message` are `null` where the URI omits them.
`amounts` is an object of bigint zatoshis keyed by payment index. It must have
exactly one entry for each payment that has no amount, and is accepted only
with a URI; any other entry rejects.

### Retained PCZT import candidate

`pczt_import_call(generation, operationId, bytes, maximum)` accepts at most 4 MiB for an
already-built operation. The configured maximum also bounds the merged full copy before commit. Native combination and transaction-effect digests bind
returned data; native signature roles and the native transparent script interpreter
validate supplied authorizations, including finalized scriptSig data. Partial
signatures remain permitted. This does not verify proofs or finalize transactions.
The original `ext_wallet_pczt` row remains immutable. New full copies append to
`ext_wallet_pczt_artifacts`; exact duplicate imports do not advance the revision.
`pczt_get_artifact` accepts an optional artifactId for old versions, otherwise
returns the latest retained copy. Native source tests are separate from pending
WASM/SDK qualification.

### Candidate retained native proving

`pczt_prove_call(generation, operationId, artifactId, saplingSpend, saplingOutput, maximum)` uses the locked native PCZT Prover and publishes through the existing immutable import transaction. It accepts only canonical Sapling parameter bytes: 47,958,396-byte spend SHA256 `8e48ffd23abb3a5fd9c5589204f32d9c31285a04b78096ba40a79b75677efc13`, and 3,592,860-byte output SHA256 `2f0ebbcbb9bb0bcffe95a397e7eba89c29eb4dde6191c339db88570e3f3fb0e4`. These bytes were assembled in the order specified by cached `wagyu-zcash-parameters 0.2.0` and matched the complete BLAKE2b512 constants and sizes in `zakura-proofs 1.0.0/src/lib.rs`; that crate is not added as a dependency. Parameters are digest-checked before native decoding on every use.

Proving requires actual native role material, including Sapling proof-generation keys; it does not invoke a signer or synthesize missing authority. Ironwood uses the existing `PostNu6_3` native circuit key; Orchard proving is not admitted by this candidate. Native nonempty proof verification and actual runtime memory/time qualification remain required before public acceptance. The expensive native fixture is explicitly selected with `PCZT_PROVING_PARAMETERS` pointing at the qualified local parameter directory and `pczt_prove_real_sapling -- --ignored --nocapture`.

The candidate's two real native fixtures build retained Sapling spends with Sapling or Ironwood payments/change, sign/import, generate nonempty proofs, verify them with the native transaction extractor, and reopen exact retained artifacts. The extractor is used only by this qualification test; the prove API does not finalize or publish a transaction. Internal artifact DTO flags `requiresSaplingProofs`, `requiresIronwoodProof`, and `requiresOrchardProof` come directly from native missing-proof queries. Missing required assets return `PROVING_MATERIAL_REQUIRED`; canonical size/digest mismatch returns `ASSET_INTEGRITY`. The native facade routes owned parameter bytes without encoding them into JSON and preserves the existing committed cancellation receipt.

### Candidate atomic native finalization

`pczt_finalize_call(generation, operationId, artifactId, saplingSpend, saplingOutput, maximum)` validates the retained association and native signatures, then uses the existing backend `extract_and_store_transaction_from_pczt`. Its native verification and wallet writes share one extension transaction with `ext_wallet_finalized`, keyed by `(operation, step)` (single-step PCZT uses zero). The row retains the selected artifact, exact serialized transaction bytes, native txid and SHA256. An outbox-insert failure rolls back backend transaction/sent-output writes too. Repeated finalization loads the committed exact bytes without regenerating binding signatures or requiring proving assets. `finalized_get` returns all ordered finalized rows, rechecks digest and native transaction parsing/txid, and reports the current read revision. Existing proposal inventory supplies operation discovery. The combined `payment_call` facade supplies per-step consent, observations, attempt reservations, retry eligibility, and payment state; the host owns network I/O and dispatch. See [the submission journal](WALLET-SUBMISSION.md). The synthetic SDK baseline passed actual Node filesystem and Firefox OPFS workflows for finalization, local transfer/shielding/TEX, exact-byte retry, and reopen (SDK `b25ea5c`, runtime package 03/native build 03). This is scoped runtime evidence, not complete SDK acceptance.

Known limitation: the locked backend always reruns SpendFinalizer, which rejects valid already-finalized transparent inputs after their partial-signature/redeem-script fields were cleared. This candidate verifies such scripts but returns `METHOD_NOT_SUPPORTED` before storage. Native regression covers second finalization and existing mixed role material. No dependency or Python producer patch is applied; this is not complete public finalization acceptance. Tracked in private SDK issue #102.

### Candidate fused native execution

`fused_send_call(generation, operationId, proposalId, reviewCommitment, signerToken, saplingSpend, saplingOutput, maximum)` executes the exact retained proposal with the worker-owned native USK and upstream `create_proposed_transactions`. It does not select inputs again or export key bytes. This private binding currently requires both canonical Sapling parameter files for the upstream prover arguments. The whole native build/store and every ordered finalized transaction row commit together; local rows have `artifact = NULL` because no PCZT artifact was created. At most 16 steps and 4 MiB of total returned transaction bytes are admitted. Supplied proposal identities must match on every call; an already-finalized operation returns checked stored bytes before consulting the signer or parameters. Local retries never rebuild, prove or sign.

Native qualification includes transfer, shielding and the upstream TEX two-step dependency route, late-row rollback, original signed-byte persistence across reopen, and retry after authority disposal. The combined submission journal retains per-step consent and attempts and checks parent eligibility for host-driven dispatch and recovery. This private native composition does not establish full public API acceptance; the synthetic SDK baseline passed transfer, shielding, TEX, finalization, exact-byte retry and reopen workflows on Node filesystem and Firefox OPFS (SDK `b25ea5c`, runtime package 03/native build 03).

## License

Project-owned code is [MIT licensed](LICENSE). Bundled dependencies retain their own licenses; keep the accompanying [third-party notices](licenses/README.md) when redistributing JavaScript/WASM artifacts.

## Transparent funding discovery

Wallet sync requests include ordinary transparent receivers (including the backend’s
recovery window and change addresses), checked once per SDK sync pass. Responses
use the existing bounded, chain-pinned UTXO validation; ephemeral checks retain
their separate polling schedule. Successful ordinary checks complete for the current
native scan plan; a new plan, rewind or reopen requests them again. This requires
no wallet schema migration.
