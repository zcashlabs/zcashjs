# Rust/WASM host contract · H1 draft

::: tip Proposed Contract
**Contract revision: `zcash-host/1.0-draft.2`.** This versioned review proposal specifies the boundary beneath the issue #1 public API. Operation names here are new wrapper commands, not published JS exports or claimed Zakura functions. ABI, payload schema, artifact format and database schema have separate versions.
:::

::: warning Unimplemented
No Rust crate, WASM module, serializer, VFS or host transport is implemented by this document. This contract does not claim G4 approval, runtime validation or F1–F8 completion. Binding-generator choice and final low-level export layout remain qualification decisions.
:::

::: info Native front-end
React Native runs the same host contract over the native library
(`zakura-bindings-native`) instead of WebAssembly. One runtime is one Rust owner
thread with its own wallet domain, like one WebAssembly instance per worker. The same
JS glue drives it, with the same commands, error codes and handle rules; a
native/WebAssembly parity suite checks this. Native code ships inside the signed app
binary, so H1.1 byte verification does not apply. Instead, the loader requires the
native identity (ABI version and bindings revision) to match the revision this SDK
build was produced against, and fails with `PROTOCOL_MISMATCH` otherwise.
:::

## H1.1 Negotiation before authority

`WasmArtifact` contains only `manifestUrl` and application-pinned `manifestSha256`; the expected digest is obtained through the application's trusted release configuration, never from the fetched manifest or runtime. `ArtifactManifest` / `ArtifactFile` are the public typed contracts. The loader follows this order:

1. Fetch the manifest as bounded bytes with credentials omitted and redirects rejected. Its URL must be absolute HTTPS, with no userinfo, query, fragment or credential-bearing components. Hash the exact canonical bytes with SHA-256 and compare to the expected lowercase 64-hex digest before using manifest fields.
2. Validate canonical encoding and the exact `zcash-artifact/1` schema; reject duplicate/unknown keys, missing fields and invalid digests/lengths. Canonical encoding is UTF-8 JSON without BOM, whitespace outside strings or final newline; object keys are recursively sorted by Unicode scalar value, arrays retain order, strings use literal Unicode except quote/backslash (escaped with a backslash) and U+0000–U+001F controls (controls use lowercase `\u00xx`), and unpaired surrogates are forbidden. Numbers are positive safe integers written in decimal without leading zero, fraction or exponent. Require re-encoding to equal the fetched bytes. This makes the expected digest bind one canonical representation.
3. Validate contract/ABI/schema revisions against the loader's supported versions and requested H1 profile, including operation, protobuf, network-parameter, database and host-service revisions. Require `mode: 'baseline'` for `RuntimeOptions.baseline` and `mode: 'threaded'` for the threaded artifact. Bind reproducible build/toolchain identity and the complete locked dependency/feature graph through `buildSha256` and `dependencyGraphSha256`; release evidence must retain the corresponding identity records. These digests are authenticated expectations, not evidence that a build has passed qualification.
4. Resolve every file URL relative to the manifest's directory. File URLs must be plain relative paths: no scheme, leading slash, backslash, query, fragment, percent encoding or empty/`.`/`..` segments. Require unique resolved URLs, the same origin and containment under that directory. Fetch with credentials omitted and redirects rejected. Verify exact byte length and SHA-256 for **every executable asset**, including the module entry, JS glue, WASM, worker entry and any required thread bootstrap or transitive static/dynamic import. Require exactly one `module` entry and one `worker` entry, at least one `wasm`, and a `thread-bootstrap` for threaded mode; additional JS dependencies use `glue`. WASM kind requires `application/wasm`; all other kinds require `text/javascript`, with matching response media types. A single entry may contain bundled glue; no duplicate file entry is needed.
5. Only after the complete executable closure verifies may the loader import/instantiate code or start any worker. Execution must consume the verified bytes (including cache retrieval), without re-fetching mutable URLs at import time. All static/dynamic import and bootstrap references must resolve to listed verified assets; reject unlisted or ambient executable loads. A compatible verified-byte module/worker loading mechanism under platform CSP is a qualification requirement, not permission to skip integrity. Failure discards partial assets and opens no storage or authority; malformed manifests/assets return `INVALID_ARGUMENT`, integrity or loading failure `RUNTIME_UNAVAILABLE`, and incompatible mode/versions `PROTOCOL_MISMATCH`. A selected fallback must independently pass the same baseline verification.

The loader then performs `runtime_init` before opening storage or importing authority. The bootstrap handshake is the only request accepted without an instance token. It supplies:

- Exact requested contract revision and accepted ABI major/minor range; the verified manifest ABI must agree.
- Expected module/glue build identity, coherent dependency-graph identity and baseline/shared memory mode.
- Required operation-schema revisions, protobuf revision, network-parameter format and allowed host-service versions.
- Explicit limits from `RuntimeOptions`, worker count and startup deadline when threaded.

Handshake expectations come from the verified manifest and loader policy, never from untrusted runtime output. Compare the report against those expectations and reject mismatches before storage or authority. The result reports selected contract/ABI/schema versions, build hash and graph manifest identity; supported operation families and protocol tuples (pool, transaction version, branch, circuit, PCZT version); parameter formats; memory/thread model; VFS/service versions; and effective limits. This is an internal compatibility report, not a caller capability matrix or activation claim.

For this draft, peers must agree on the **exact draft revision**. After a stable H1 is approved, incompatible ownership, meaning or mandatory fields require a major version; additive optional operation profiles require a negotiated minor/schema revision. Unknown fields/operations reject under the selected schema. Do not accept a newer required field by ignoring it. No overlap yields `PROTOCOL_MISMATCH`; an incompatible module/engine yields `RUNTIME_UNAVAILABLE`; unsupported pool/version remains a distinct error. Failure releases partial workers/memory without opening the database.

Network descriptors are registered using the versioned parameter format and checked genesis identity. Network tokens refer to this validated registration; a client-supplied display identity is insufficient. H1 does not invent the pending consensus-parameter schema.

## H1.2 Request, result and error envelopes

Worker messages use bounded structured control records plus owned binary payloads. The logical schema below is notation, **not TypeScript SDK code or a serialization implementation**:

```text
Request = {
  contract: selected revision,
  schema: operation payload revision,
  instance: instance token | null only for runtime_init,
  requestId: unique session-local string,
  command: catalog command,
  target: Handle | null,
  operationId: durable wallet operation ID | null,
  payload: command-specific record,
  buffers: ordered owned byte payloads
}
Result = {
  contract, schema, instance, requestId,
  outcome: "ok",
  result: command-specific owned DTO/handle,
  commit: { state: "none" | "committed" | "unknown", revision: string | null }
}
Failure = {
  contract, schema, instance, requestId,
  outcome: "error",
  error: ErrorInfo,
  operationId: string | null,
  retained: { paymentState: PaymentState | null,
              syncStatus: SyncStatus | null,
              observation: TransactionObservation | null },
  commit: { state: "none" | "committed" | "unknown", revision: string | null },
  instanceState: "usable" | "invalid"
}
Handle = { instance, kind, slot: checked u32, generation: checked u32 }
```

Every admitted request receives one terminal result or failure. Async job acknowledgment returns a job handle; progress is a separate ordered, bounded message keyed by request/job and monotonically increasing sequence. It never substitutes for a terminal result. `job_poll` reads queued/running/cancel-requested/completed/failed/stopped state and an optional bounded progress record, not a universal percent. Out-of-order transport responses correlate by request ID. Duplicate IDs in a live session reject; they do not execute again. A disconnected worker cannot guarantee delivery: invalidate its handles and reconcile persistent operations after reopen. Request IDs are not wallet idempotency keys.

Payload schemas are derived from the [command mapping](host-mapping.md): retain exact public DTO nullability, integer bounds, defaults, unions and error codes; replace `Network` and opaque object references with typed instance handles, `AbortSignal` with job cancellation control, callbacks with declared host-service requests, and bytes with indexed buffer descriptors. Byte descriptors carry buffer index, offset and length; reject overflow, overlap where mutable, invalid indices and sizes before allocating/decoding. Public readonly properties never authorize aliasing.

Control integers must be checked safe integers and narrowed to declared protocol widths before Rust use. Amounts and wide indices use structured-clone bigint with checked signedness/range, never JSON number. A selected linear-memory binding must lower these to explicit width/signedness and byte order (H1 proposes little-endian unsigned magnitudes; signed deltas use a distinct signed field). Display hashes remain canonical display text; protocol bytes retain their specified wire order. No generic JSON/base64 conversion of bulk payloads is permitted.

`ErrorInfo` is exactly the public code/stage/retryable/recovery/message contract. Host-only commit and instance-state metadata tells the JS adapter whether it may retain a handle and which partial state to attach to `ZcashError`. Wrong-kind/malformed tokens map to `INVALID_ARGUMENT`, stale generation to `STALE_HANDLE`, and another instance to `WRONG_INSTANCE`. Raw foreign causes, keys, endpoint URLs, SQL, PCZTs and wallet data must not enter the sanitized message. Retained private DTOs are application state, never automatic diagnostic events.

## H1.3 Handle and byte ownership

Only the owning worker dereferences a handle table. Tokens are not memory pointers, durable IDs or transferable signing credentials. Validate instance, kind, slot and generation on every call; do not reuse an exhausted generation. Wallet handles own DB/scanner/proposal/artifact associations. Jobs own immutable input snapshots and asset leases. Caller-owned memory signers may be attached through verified bindings; closing a wallet detaches without destroying injected authority. Cross-domain use requires an explicit internal authority service/lease or serialized non-secret interchange, never dereferencing a foreign pointer or exporting a USK.

`handle_release` is a strict raw command: repeated raw release rejects. Public `dispose`/`close` wrappers cache completion so repeated calls are idempotent without a second raw release. Closing invalidates wallet-dependent tokens. Restart reconstructs versioned artifacts by durable ID into **new** tokens. Finalizers are only leak backstops.

Input arrays are copied before asynchronous admission; caller mutation after invocation cannot alter reviewed work. Worker transfer may consume only a standalone **internal owned copy**, never the caller's buffer or a pooled Node Buffer backing store. Into WASM, copying is the baseline; transfer does not place arbitrary memory into a Rust allocation. Output arrays are independent owned copies transferred outward; module memory and secret-bearing heaps are never transferred or exposed.

If a binding uses `buffer_allocate/consume/release`, the internal lease includes allocation ID, offset, length and generation. Fill/read only synchronously with bounds/alignment checks, no reentrant mutation/free/growth while leased and no borrowed view across await. Refresh memory views after growth. Shared views retain old extent; synchronize growth/access and leases explicitly. A SharedArrayBuffer is not by itself a Rust allocation. Independent instances can share compiled code but not heaps, objects or handles.

## H1.4 Cancellation, scheduling and traps

`job_cancel` records a request, not rollback. Before admission/start it can finish with `ABORTED` and `commit: none`. Scan batches stop between safe atomic commits and return stopped status with the last revision. Immutable proof work checks only supported cooperative boundaries; monolithic crypto may finish before cancellation is acknowledged. A cancellation racing with commit must return committed state or an error retaining that state, not claim nothing happened.

Host fetches and external signer callbacks run outside Rust borrows/transactions. They accept cancellation where supported, but an external callback's late return is still validated before it can affect current state. Wait/stream abort releases that observer; it does not cancel already submitted transactions, unlock inputs or undo another runner's work. After dispatch, lost response is submission unknown regardless of observer cancellation.

Never routinely terminate the wallet worker to cancel a payment. A disposable isolated prover can be abandoned only if it owns no DB mutation and its result cannot later commit. A shared pool failure invalidates the whole affected compute domain; killing one Rayon worker and reusing potentially locked shared memory is forbidden. Trap/OOM/worker loss maps to an invalid domain with `WORKER_CRASHED`, `RUNTIME_UNAVAILABLE` or `RESOURCE_LIMIT` as appropriate; unknown commit state requires reopen/reconciliation, never automatic mutation replay.

## H1.5 Runtime and host services

Baseline and shared-thread artifacts are separate builds. Validate secure context/isolation/SAB/thread support in browsers and the actual worker/parentPort bootstrap on Node. Await one cached pool-readiness promise before any Rayon-using export, including scanning/lazy initialization. Missing prerequisites select baseline before incompatible module loading. Failed partial threaded bootstrap is torn down before fresh baseline initialization; no failed wallet mutation is replayed on fallback.

Imports are restricted to versioned entropy, clock, VFS operations, scheduling/progress and asset delivery. Entropy is for in-scope cryptographic operations, not mnemonic generation; unavailable entropy fails closed. Clock results label observations/deadlines, not consensus validity. Asset delivery passes only parameter/circuit bytes with expected circuit/version/hash/length; verify before parsing and on cache reads. Network credentials, transport retries and external signer callbacks remain in TypeScript, without ambient network access in Rust crypto.

One proof is admitted at a time (`maxConcurrentProofs: 1`). Enforce `maxMemoryBytes` including bounded WASM allocation, `maxQueuedBytes`, `maxQueuedJobs`, `scanBatchSize`, `maxPcztBytes`, parameter-cache `maxBytes`, transport response limits and observation buffers. Account for in-flight copies and shared-domain/independent-domain asset costs during admission. Limits must be positive and representable, with requested values checked against artifact/engine maxima before work starts. Exceeding a limit errors `RESOURCE_LIMIT`; never silently truncate, drop updates or relax security. Page bounds remain default 50/max 200. Concrete engine maxima and control-envelope caps must be pinned in the implementation manifest; no measured safe defaults are asserted.

## H1.6 One-wallet SQLite lifecycle

1. `wallet_open` receives a registered network, explicit storage descriptor, confirmations and runtime owner. Acquire cross-tab/process single-writer ownership before migration. A second owner coordinates or fails `STORAGE_BUSY`.
2. Register the Node filesystem or OPFS VFS in the **same bundled SQLite memory** used by rusqlite. Load the array module and use `WalletDb::from_connection`. No connection pointer crosses an unrelated SQLite instance. `BlockDb::from_connection` is private; default-VFS or bounded BlockSource integration requires qualification.
3. Validate network and schema/extension versions. Run `WalletMigrator::{with_external_migrations,init_or_migrate}` in dependency order with rollback on failure. Never downgrade unknown schemas. A migration requiring absent secret authority returns `MIGRATION_REQUIRED`; H1 adds no public secret-on-open path.
4. Reconcile ALL journal records, locks and artifact associations with bounded stable internal keyset traversal, including unfinalized and previously complete/reorgable work. Mark interrupted started attempts unknown and establish a new revision epoch where ownership/recovery/migration requires it. Return the internal wallet handle only after complete local recovery; partial traversal cannot report success. The TS factory then runs the finite optional operation-observation/rebroadcast pass and returns `WalletClient` with `RecoveryReport`. Follow the [D26 recovery contract](operations.md) for defaults, counts, deadline/deferred work, fair traversal, consent and persistent budgets. Observation counts/completion are independent of later dispatch failure; preserve completed observations and report sanitized network/dispatch failure in `lastError`. No account import, general sync, authorization/proving or new spend occurs on open. Default opening never submits; explicit policy permits only previously attempted exact bytes with matching durable consent.
5. Serialize **all SQLite calls**, coherent reads included. This holds even across multiple connections when the library uses `SQLITE_THREADSAFE=0`. Crypto threading does not add database writers. No mutable Rust borrow or SQL transaction spans network/device/arbitrary async callbacks.
6. `wallet_close` stops admission, cancels/drains queued work safely, completes or rolls back admitted transactions, flushes/closes VFS files and releases ownership/leases. On failure retain the error; do not claim a durable flush. Invalidate all wallet-dependent handles and detach signer bindings. `runtime_close` drains remaining independent resources and workers.

Node VFS must implement open/close/delete/access/read/write/truncate/flush/locking/error semantics; browser OPFS must provide equivalent synchronous SQLite behavior in its dedicated worker. WAL and concurrent-reader assumptions require exact-VFS qualification. Quota and eviction are storage failures, not permission for an in-memory fallback. Explicit memory mode reports ephemeral durability.

External migrations own `ext_` DDL. `transactionally_with_extension` must compose operation/lock allocation, versioned proposal/PCZT storage, and fused creation or extraction plus exact-byte outbox **only where the real backend transaction path supports it**. The restricted extension executor is not general SQL and cannot perform DDL/PRAGMA/attach/transaction control. Validate each nesting composition; `get_wallet_summary` already opens a transaction.

Submission has two later commits: persist attempt-start with consent association, automatic-attempt budget and next-eligible time before TS dispatch, then append result. Supported explicit database restore/import must durably disable automatic retry before dispatch is possible, failing closed until fresh explicit reconciliation/consent. External snapshots/clones/rollbacks preserving DB state may be undetectable, including at the same path; budget guarantees cover ordinary opens of the non-rolled-back authoritative DB only, with no independent application store prerequisite. No SQL transaction spans dispatch. Crash between them is unknown. Immutable bytes plus SHA-256, dependency order and reviewed identity survive reopen; stored txid alone cannot replace them. Reorg rewinds scan/tree state using the actual returned backend height and retains submission evidence.

## H1.7 Review exit conditions

The [mapping catalog](host-mapping.md) identifies direct/composed/glue/unsupported paths. F1 proves graph/link/instantiation; F2 proves scanner/thread liveness; F3 proves VFS/migration durability; F4 proves transaction/assets/PCZT; F5 proves sync/query/reorg; F6 proves outbox crashes; F7 proves handles/cancellation/package lifecycle; F8 proves protocol adapters. All remain open.

Before implementation review approves H1, pin the physical ABI/generated-binding lowering and symbol signatures, envelope byte encoding/control caps, consensus-parameter schema, remaining operation-profile serialization revisions, VFS journal/flush policy and coherent graph/toolchain manifest. These are explicit qualification gaps, not freedom to change public semantics. This contract is suitable for reviewing ownership and behavior now; it does not purport to be a validated binary interoperability specification.
