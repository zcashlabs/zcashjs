# Full public API validation workplan

Status: **PRELIMINARY — design and validation only.** Written 2026-09-04. Companion evidence: [Zakura Common landscape](../research/zakura-common-landscape.md) and [symbol-level wallet capability map](../research/zakura-api-capability-map.md) (pinned symbols/features, Ironwood distinctions, call-flow ordering and unresolved D06 coverage). Owner dispositions: [decision log](decision-log.md), which governs scope and records unresolved design choices.

The deliverable of this process is a reviewed, complete specification of both the public JavaScript API and the lower-level Rust/WASM host API. A pleasant send example, a generated binding, or a successfully compiled WASM crate does not establish completeness. Production implementation starts only after the design gates below have concrete evidence and explicit dispositions for remaining gaps.

This workplan proposes future functional/design work; no interviews, runtime prototypes, interoperability tests or design-gate approvals are claimed here. Benchmarks are separately deferred to tracked GitHub issue #11. This task added documentation only. Except for D18/D21’s approved namespace tree and flat client placement, proposed zcash.js package, module, export, type and operation names remain **PRELIMINARY** until the design gates approve them; existing third-party names retain their source spelling.

Issue #1 review freezes two clarifications in the [exact declaration](../api/public-api.md): new-account creation keeps `accounts.create({ mnemonic })`, deriving its birthday from one coherent locally verified wallet DB snapshot after explicit sync (no network/implicit sync; unavailable/stale state fails `SYNC_REQUIRED` before mutation); and `WasmArtifact` pins a canonical manifest URL/digest authenticating versions, build/dependency graph, mode and every executable asset before execution or authority/storage. [H1.1](../api/host-contract.md#h1-1-negotiation-before-authority) governs manifest verification and negotiation. These are specification requirements, not implementation evidence.

**Settled v1 scope (D16/D19/D20):** zcash.js does not generate mnemonics or seeds. Applications use a reputable BIP39 npm package and pass the resulting mnemonic to `wallet.accounts.create({ mnemonic })` or `wallet.accounts.import({ mnemonic, accountIndex, birthday })`. Generation entropy/CSPRNG and mnemonic backup belong to the application and chosen package. V1 wallet imports accept mnemonic or UFVK authority; all raw spending-key export and the less-common imports in the [tracked future issue](future-issues.md) are excluded. Standalone UIVK viewing/address tools do not imply UIVK-only wallet support.

UFVK import directly calls `WalletWrite::import_account_ufvk` with public `viewOnly?: boolean`, default `false`. Omitted/false maps internally to `AccountPurpose::Spending { derivation: None }` and retains spend-supporting state; it does not imply, store or manufacture a spending key or signer. `true` maps to `AccountPurpose::ViewOnly` and may require reconstruction/rescan before later spending. Zakura has no public `import_account_uivk`; UIVK-only account import is excluded from v1 and stays in the [tracked future issue](future-issues.md), without inventing a backend path.

The default address request maps exactly to Zakura’s `UnifiedAddressRequest::AllAvailableKeys`: include/require every available supported receiver on the account (transparent, Sapling and the Orchard-encoded receiver used for Ironwood). Publishing this UA links these receivers and permits transparent receipt. Shielded-only is an explicit supported request, never the default; missing required receivers fail without fallback.

Mnemonic recovery accepts every checksum-valid standard BIP39 word count: 12/15/18/21/24. Any preference for 24 words is documentation only, with no runtime warning or result field. zcash.js generates no mnemonics or seeds (D19).

The generic external signer/PCZT seam remains in v1. Concrete Ledger support is only a documented stub/placeholder and is unsupported until later device, app/firmware, pool, version and display/review qualification.

The [transaction/query plan](transaction-query-api.md) and [WASM host plan](wasm-host-architecture.md) supply the current G2–G5 integration specification. Their source mappings and F1–F8 gates refine this workplan; source inspection is not runtime proof.

D26 authorizes the recovery specification amendment and compile-only/consistency tests: opening automatically recovers the entire database inventory without an application ID store. The [normative recovery contract](../api/operations.md) and [future acceptance matrix](recovery-acceptance.md) govern bounded traversal, observation, consent, retry budgets and crash behavior. No production SDK implementation, live probes or qualification gate is authorized or passed by this amendment.

## 1. Establish scope and evidence ownership

Assign a JS API owner, Rust/protocol owner, wallet/scanning owner, browser/runtime owner, and security/privacy reviewer. One person can fill several roles, but protocol correctness and usability need separate review perspectives. Record an owner and decision date for every unresolved item.

Produce a versioned evidence manifest identifying repository SHAs, registry versions/checksums, feature combinations, compiler/target versions, protobuf revision, network parameters and applicable ZIP revisions. Keep source-observed, released, experimentally validated and planned capabilities separate.

Include WebZjs commit `a50df944c32243cb8da9f86e7d52cb65ac926439` and its locked ChainSafe dependency revision `52efe30ef39b2d1871be5673d1921ff33472b347` as a separate comparison graph; record generated/published artifact provenance separately from source manifests.

Start with the landscape's Common 1.1.0 source/registry observations and wallet RC4's exact 1.0.0 dependency pins. Use D06a’s coherent locked Common 1.0.0 graph before any dependency experiment. Inventory all transitive runtime/build dependencies, native C requirements, randomness generations and licenses. Do not silently patch wallet pins or mix upstream and forked crypto types.

Primary protocol scope is **transparent + Sapling + Ironwood** (D04). Sprout is explicitly deferred and backtrackable (D05), including its decoding, scanning and spending scope; record reconsideration triggers without making its implementation a readiness requirement. Sapling and Ironwood must have distinct capability rows; Ironwood is not a synonym for Orchard. Validate exact Zakura Common/wallet key, address, scanning, transaction, PCZT and proving APIs, circuit/version context and network applicability (D06); source feature presence establishes neither end-to-end support nor activation. Any required legacy handling must become an explicit scope decision.

A fully fledged, clean Node.js npm product is required (D02). Recommend one stable TypeScript API with runtime-selected internal backends; start WASM-first in Node/browser, with no N-API promise and acceleration deferred to the future benchmark issue (D03a/D07). External signer/PCZT seams are first-class now (D11); concrete Ledger support is a documented unsupported stub/placeholder until later device/app/pool/version/display qualification. Remote proving is deferred, while its future extension seam must remain possible (D12–D13). Multisig and remote-wallet RPC are out of current scope; do not design them now (D25).

Forking Zakura to add bindings is acceptable (D01). Prefer a new wrapper crate/workspace member depending on the coherent Zakura graph, with preliminary wrapper-level features such as `transparent`, `sapling`, `ironwood` and `proving`. A feature flag alone does not create JS bindings: the wrapper needs exports, type conversion, ownership and host integration. Keep existing Zakura packages unchanged unless target compilation requires a minimal upstreamable dependency feature or fix; retain the failing probe and rationale for each exception.

**Gate G0 — scope/evidence:** approve support environments, supported protocol eras, authority/trust modes and the initial graph. Exit artifact: scope ledger plus immutable evidence manifest; no “latest” dependency as the only identifier.

## 2. Validate personas and end-to-end use cases

Interview or conduct structured walkthroughs with representative developers. Use viem/ethers as developer-experience references for discoverability and composability, while preserving Zcash's UTXO, shielded note, viewing and proving semantics.

| Persona | Required journeys to specify | Main questions |
| --- | --- | --- |
| Node service / block explorer developer | Fetch tip, blocks/headers/transactions/UTXOs; stream ranges; resume after disconnect; observe mempool, confirmation and reorgs. | What is server-reported versus verified? How are pruning, optional indices, pagination and unsupported RPCs surfaced? |
| Browser payment application developer | Decode unified address/payment URI, select a supported receiver, request an external signer, submit and observe settlement. | Can public queries load without crypto/proving assets? How does the user review amount, fee, recipient and privacy consequences? |
| Browser wallet developer | Create/restore accounts; derive receive addresses; sync; send/shield; attach/dispose memory or external signers; recover from storage eviction or interrupted writes. | What owns secrets and durable state? What happens in another tab, on mobile suspension, or during an upgrade? |
| Viewing-only / accounting integrator | Import UFVK; scan history; inspect notes and memos; report balances with limitations. Standalone UIVK address/viewing tools are separate; UIVK-only wallet import is excluded from v1. | Which history/spendability claims can each viewing capability support? How are sensitive viewing exports controlled? |
| Offline / hardware / custody integrator | Propose online; export a PCZT; inspect/sign offline; prove/finalize in a permitted order; import and broadcast. | What is committed by authorization? Which data may cross devices? Which pools and transaction versions does each signer support? |
| Advanced transaction / proving integrator | Manual UTXO/note selection; custom change/fee policy; mixed pools; standalone proving and verification; large jobs. | Can policy be explicit without bypassing protocol invariants? What are witness, parameter and memory requirements? |

For every journey, record preconditions, authority, inputs, outputs, network round trips, privacy disclosures, persistent mutations, recoverability and observable completion. Walk through happy path, cancellation and each plausible failure. Have developers locate required operations without being told the intended names.

Cover at least:

- Every source/destination pair across transparent, Sapling and Ironwood (including Sapling-to-Sapling, shielding/unshielding and Sapling↔Ironwood), plus mixed inputs/outputs where protocol-supported, multiple recipients, send-max, dust/change and insufficient funds. Validate each against exact Common/wallet coverage; Sapling journeys are required; Sprout journeys remain deferred rows.
- Address/network validation, receiver preference/requirements, unknown receiver types, diversifier exhaustion/search, supplied mnemonic/UFVK import policy and account discovery.
- Fresh wallet, old birthday, imported viewing keys, duplicate imports, incomplete scan, historical rescan, restored checkpoint, missing witnesses and reorg across retained history.
- Coinbase maturity and confirmation policy where relevant; address reuse and transparent address discovery; concurrent sends and note/UTXO reservations.
- Expired transactions, anchor changes, fee-policy changes, offline authorization, duplicate submission and submission timeout with an unknown outcome.
- Corrupted assets, unavailable entropy, wrong network, unavailable server method, partial stream, transport switch, database migration failure, worker crash and OOM.

**Gate G1 — journey coverage:** every in-scope persona has complete sequences and failure stories. Exit artifact: numbered use-case catalog with acceptance criteria. Preserve D18/D21’s approved names while validating these workflows and unresolved signatures.

### Requirements and prior-art review: WebZjs

Use the [pinned WebZjs prior-art inventory](../research/zakura-common-landscape.md#webzjs-prior-art-and-differentiation) alongside viem/ethers DX references. The owner reports that WebZjs was made by someone involved with this project. It is a requirements/prior-art guide, not a complete capability map or compatibility target (D10). There is **no WebZjs API or snapshot compatibility requirement**.

Review relevant wallet, key/request and Snap journeys for requirements and lessons: initialization, authority separation, transaction review, PCZT handoffs, errors, persistence and recovery. Map useful observations to independent zcash.js capability rows and record gaps beyond WebZjs. Preserve source names as evidence only. Inspect generated/published artifacts only when needed to substantiate a specific behavior claim; an exhaustive export map or adapter is not a gate requirement.

Protocol interchange must be specified for the selected protocol versions and external signer roles. Compare serialized bytes across separate artifacts where relevant; never pass WASM handles across instances or mix forked Rust types. WebZjs's snapshots and generated API do not constrain zcash.js storage schemas or public names. Snapshot encoding observations remain useful prior art, without an import or migration promise.

Attach requirements/lessons to G2, address resulting JS and host contracts at G3/G4, and validate selected protocol handoffs at G5. The owner's Vizor ecosystem Ledger/external signer observation is an architectural signal for first-class signer/PCZT seams, not evidence that a particular device supports Ironwood; validate generic signer roles now. Concrete Ledger device, firmware/app, pool, transaction version and display/review qualification is later work, not a v1 delivery gate.

## 3. Build the capability matrix in both directions

Each row represents a concrete operation, not a broad label such as “wallet.” Required columns:

| Column | Required content |
| --- | --- |
| Identity | Capability ID, persona/use-case IDs, stable/experimental/deferred/unsupported disposition, owner. |
| Protocol | Pool, network, branch/transaction version, ZIP revision, input/output encodings and invariants. |
| Backend evidence | Exact crate version/SHA, source symbol and URL, feature gates, data/parameter requirements; explicitly “missing” if unavailable. |
| Environment | Node baseline worker and qualified shared Rayon, browser baseline worker and isolated threaded worker, offline/external signer. Native is a deferred benchmark row only. Distinguish inspected/compiled/executed/validated. |
| Prior art / requirements | Relevant WebZjs or other source observation, requirement/lesson, independent coverage gaps and decision ID; no API/snapshot compatibility obligation. |
| JS contract | PRELIMINARY candidate module/export, arguments, result, authority, errors, cancellation and observable state transition. |
| Host mapping | Rust/WASM export(s), host imports, handle/buffer ownership and serialization. Use “host-only; no Rust call” for transport-only actions. |
| State/privacy | Secrets and viewing data touched, persistent changes, atomicity, disclosures and trust assumptions. |
| Validation | Vector/fixture/prototype/review IDs, metrics, blockers, pass criteria and reviewer disposition. |

Seed rows with capabilities from every proposed module: codecs, query transport, key derivation, transparent scripts, shielded notes, transaction building, fees, PCZT, signing, proving, scanning, persistence, wallet orchestration, lifecycle, errors and extension points.

Require **bidirectional traceability**:

1. Every use-case step maps to JS operations and host operations or a documented host-only implementation.
2. Every JS export maps back to a use case and a capability row.
3. Every host export/import has a consumer and a reason to cross the boundary.
4. Every available Rust capability considered for exposure has an explicit include/internal/defer/exclude decision. Do not export low-level gadgets solely because Rust exposes them.
5. Every unavailable capability remains visible with a fallback, design limitation or deferred decision. Do not create imaginary backend methods to fill the matrix.

Keep D20 facilities as deferred capability rows linked to the [tracked future issue](future-issues.md), with its acceptance criteria and review trigger. They are not v1 G3–G6 implementation or validation requirements. GitHub issue #10 (historical) records the post-v1 work without expanding current scope.

**Gate G2 — completeness:** no unowned rows, unmapped critical journeys or implicit support claims. Full-scope deferred rows are allowed only with rationale, consequences and a future review trigger. Exit artifacts include the bidirectional capability matrix and WebZjs requirements/lessons review.

## 4. Specify the entire JavaScript surface on paper

Use the [API namespace audit](api-namespace-audit.md) as the authoritative namespace tree over historical research sketches: D18 approves `wallet.addresses.current/next/list/at`; D21 approves `wallet.accounts.create/import/list/get/remove/attachSigner/detachSigner`, `wallet.pczt.export/import` and `wallet.operations.list/get/resume`. Operations implementation still requires durable-state validation. Keep at most one resource namespace beneath a client, independent public/light/wallet construction and flat public/light methods. G2 evidence tables are internal validation artifacts, not public capability/configuration matrices or service objects.

Create a reviewable export catalog covering functions, factories, classes/handles if any, types, enums, constants, events, error codes, adapter interfaces and package subpath exports. Keep declarations in documentation or an isolated disposable design workspace; do not add a production package scaffold.

For every operation, specify:

- Exact input and output schemas; bytes versus display hex; txid endianness; bigint zatoshis versus decimal text; network/account/pool identifiers; unknown-field behavior.
- Required capability/authority and explicit defaults. Define incoming/full/outgoing viewing roles and the boundary between local wallet and external signer. Remote-wallet RPC is out of current scope and must not be designed now.
- Whether it is sync, Promise-based, an async iterator or an event subscription; ordering, cancellation, backpressure, timeout and disposal.
- Validation versus protocol versus transport versus storage errors; stable machine-readable codes, retryability, retained state and redacted diagnostic context.
- Side effects, idempotency, atomicity and cache invalidation. Define “submitted,” “accepted,” “mined,” confirmation depth, reorged and expired separately.
- Compatibility/versioning: serialization stability, experimental APIs, unsupported capabilities, extension hooks and semver rules.

Specify the complete transaction state model. A candidate starts with payment intent/proposal, then selected inputs and a reviewable plan, then authorized/proven/finalized representations, submission and chain observation. Do not impose one universal sign-before-prove or prove-before-sign sequence: validate supported PCZT roles and signing commitments against the backend. Immutable reviewed-plan identity must prevent accidental recipient/amount/network changes after approval.

Use the authoritative [transaction/query contract](transaction-query-api.md): ordinary `wallet.send({ accountId, to, amount })` returns `PendingPayment`, then `.wait()`. It composes Zakura selection, fees/change, proving/local authorization, serialization/storage and host broadcast. A supplied proposal executes exactly its reviewed plan. `build/prove/sign/finalize` are advanced PCZT operations; the local `create_proposed_transactions` path is fused and supports actual multi-step dependencies, while proposal-to-PCZT is single-step. Preserve optional attached/supplied signer authority and no hidden account defaults.

Review ergonomic query DTOs with `viewOnly`, bigint amounts, scan/revision/nullability and distinct submission/inclusion/expiry state. Do not expose a generic Snapshot wrapper, backend purpose or evidence taxonomy as mandatory call-site ceremony. Full history/inventory/revision/sync/journal gaps map to narrow Rust-owned projections and new integration glue, not test-only APIs or JS wallet algorithms.

Keep one TS API over WASM-first Node/browser: bundled SQLite inside WASM with Node filesystem and browser OPFS VFS. The [host architecture](wasm-host-architecture.md) specifies separate baseline/shared artifacts, worker ownership, scanner liveness and actual host operation families. Native/N-API comparisons and performance budgets are exclusively [future benchmark work](future-issues.md#issue-11-wasm-performance-and-possible-native-acceleration).

Decide internal package topology from realistic bundle and usability evidence: one package with subpaths versus multiple packages; tree-shaking, lazy WASM/assets, initialization, SSR imports and supported ESM/CJS entry points. Document a low-level escape hatch only if its validation and compatibility obligations are clear.

**Gate G3 — JS review:** reviewers complete the persona exercises using only the proposed API docs. Exit artifacts: complete export/type/error catalog, sequence diagrams and state-transition contracts, with usability findings resolved or explicitly accepted.

## 5. Specify the complete Rust/WASM host contract separately

Do not equate wasm-bindgen-generated TypeScript with a designed host contract. Evaluate wasm-bindgen and a narrow WASM ABI against the host operation/ownership catalog; native bindings are deferred acceleration work.

Host contract sections must include:

| Family | Contract requirements |
| --- | --- |
| Runtime | ABI/schema version negotiation, build/feature/protocol capability report, initialization, instance lifetime, worker affinity and deterministic teardown. |
| Keys and authority | Supplied mnemonic/UFVK import, internal derivation and explicit viewing export; no raw spending-key export (D16), opaque handles, viewing/spending distinctions, lock/dispose, stale/wrong-instance handle errors and minimum secret exposure. |
| Codecs and transactions | Canonical byte formats, size bounds, exact numeric conversions, parse failures, version/network checks, construction and PCZT state transitions. |
| Proving | Circuit identity, parameter hash/length, preparation and key caches, job limits, progress semantics, cancellation boundaries, panic/OOM recovery and proof result ownership. |
| Scanning/state | Compact/full data ingestion, scan batches, tree/witness updates, state deltas, checkpoint/rewind, atomic commits and replay behavior. |
| Buffers | Allocation/free or generated ownership rules, copies/transfers, bounds, aliasing, memory-growth invalidation and output lifetime. Never expose a raw Rust object layout as a persistent schema. |
| Host services | Entropy for in-scope signing/proving/cryptographic operations (not mnemonic/seed generation), storage, clocks if needed, asset bytes, scheduling and progress. Network capability is opt-in rather than ambient authority inside crypto. |
| Errors/concurrency | Stable tagged errors, traps versus recoverable failures, reentrancy, concurrent jobs, instance invalidation and cancellation cleanup. |

D07 selects bundled Rust-owned Zakura SQLite inside WASM, with a Node worker/filesystem VFS and browser worker/OPFS VFS; D08 selects independent public/light/wallet clients and host transports without project-operated infrastructure. Validate synchronous Rust traits against the chosen browser persistence bridge and durable reopen/recovery requirements. Do not allow an awaited host callback to retain an unsafe mutable Rust borrow or deadlock the worker.

Specify public-data and secret-data paths across JS, worker messages, Rust memory, persistent storage and external devices. Disposal/zeroization claims must state limits caused by copying, garbage collection and crashes. Evaluate Common's explicit variable-time arithmetic/proving caveats against signing/derivation/proving threat models; a WASM port does not resolve them.

Sapling parameter acquisition, expected hash/length verification, versioned caching, lazy package assets and worker-memory budgets are v1 work. Accept application-supplied bytes or configured third-party sources; assume no project-operated CDN. Test missing/corrupt assets, interrupted acquisition, cold/warm caches, parse panic containment, concurrent jobs and OOM/cancellation. D16a excludes a persistent spending-secret vault; D17 leaves next account-index allocation transactionally owned by Zakura.

**Gate G4 — host review:** Rust, runtime and security reviewers agree on ownership, error and state semantics. Exit artifact: versioned host operation/import schemas and an exact JS-to-host mapping. No export may remain “whatever the binding generator produces.”

## 6. Allow only disposable validation experiments

Experiments are evidence gathering, not the start of the library. Use a separate temporary directory or explicitly disposable branch with no production exports, dependencies or copied implementation merged into this repository. Use synthetic/test keys, local fixtures and regtest where required. Never fund mainnet experiments or handle real wallet secrets.

Before each experiment, record a bounded hypothesis, exact versions/features, expected evidence, pass/fail criterion and deletion/archive policy. Retain results, commands, logs scrubbed of secrets, hashes and design conclusions. A useful prototype must still be rewritten under the eventual reviewed design.

| Experiment | Evidence it must produce |
| --- | --- |
| Minimal dependency/target probes | Final baseline/threaded WASM wallet/prover linking and Node/browser instantiation on the coherent graph; C/VFS/allocator/RNG integration; actual imports/exports, memory and instructions. WASI C compilation is not a supported WASI runtime claim. Compilation is recorded separately from execution. |
| Key/address/encoding vectors | Official seed/ZIP 32 including Sapling diversifier search; default `UnifiedAddressRequest::AllAvailableKeys` including/requiring every available supported transparent/Sapling/Orchard-encoded receiver used for Ironwood, plus explicit shielded-only and transparent omit/allow/require requests and Sprout rejection; unified address/viewing key, note-encryption, transaction digest/serialization and transparent fixtures where available; network and byte-order negatives. |
| Transaction/PCZT round trips | Independent decoding/verification, role handoffs, altered-plan rejection, valid and invalid proofs/signatures; transparent/Sapling/Ironwood flows with validated circuit, transaction version and network context; demonstrate exact Common/wallet coverage gaps. Sapling experiments are required; Sprout experiments require an explicit scope revisit. |
| Prior-art-informed signer handoffs | Validate selected key/address/URI and PCZT formats by pool/network/version, malformed inputs, reviewed-plan integrity and external signer roles. Use WebZjs/Vizor lessons without requiring WebZjs API or snapshot compatibility. |
| Browser proving and scanning | Sapling parameter acquisition/hash verification/cache/package tests and separate Sapling/Ironwood proving and scanning. Baseline and threaded scanner completion with actual supported pool fixtures; Node shared bootstrap and isolated-browser bootstrap/fallback cleanup; valid proof verification and safe cancellation. The unconditional Rayon/flume no-thread liveness risk must pass F2. Timing comparisons and memory measurement are future benchmarks. |
| Persistence/recovery | Interrupted commits, duplicate/replayed batches, reorg rollback, schema upgrade, missing/corrupt state, multi-tab races, quota exhaustion and restore from backup. |
| Transport interoperability | Fixed server versions and schemas for lightwalletd/Zaino/node RPC; bounded streaming, reconnects, unsupported methods, CORS/proxy requirements and ambiguous broadcast response. |
| Runtime ownership and outbox | Execute [F1–F8](wasm-host-architecture.md#functional-acceptance-gates), including exact-byte attempt crash points, extension transaction validity, Node/browser VFS reopen, worker/pool failure and handle/buffer ownership. No N-API comparison in this functional gate. |
| DX and packaging | Small query-only app, browser wallet mock and Node offline signer; import/initialization behavior, bundle composition, worker/asset resolution and TypeScript ergonomics. |

Use [official Zcash test vectors](https://github.com/zcash/zcash-test-vectors) and pin their commit plus individual fixture paths/hashes before execution. Respect their different JSON representations, including byte-reversed display forms. Add upstream/fork differential checks only with compatible protocol context; independent verification is more meaningful than expecting identical randomized proof bytes. Include adversarial malformed lengths, values, wrong branch IDs, wrong keys and corrupted parameters.

Functional validation is bounded correctness/liveness proof, not benchmarking. Performance measurements and numeric budgets belong to the separately specified [future issue](future-issues.md#issue-11-wasm-performance-and-possible-native-acceleration), after these functional gates; no measurements are requested by this integration.

**Gate G5 — feasibility/interoperability:** every supported environment/capability has the required level of evidence. A compile-only result cannot satisfy a browser-proving promise. Failed experiments trigger a documented redesign or explicit support limitation and re-review of affected gates.

## 7. Finalize through independent review and change control

Conduct protocol, wallet-state, security/privacy, browser/runtime and JS usability reviews against the same frozen catalogs and evidence. Validate licenses and dependency update responsibilities. Record each issue's severity, owner, disposition and linked contract change.

The final readiness checklist is:

- Every full-scope capability is supported, deferred or excluded explicitly; every supported capability has a backend and validation evidence.
- Complete JS exports/types/errors/adapter contracts and host exports/imports/ownership schemas are frozen together.
- Pool/version/network support and signer/prover/storage/transport capabilities are explicit; unsupported combinations fail predictably.
- Recoverability is specified for every persistent mutation, job cancellation and ambiguous network outcome.
- Secret and viewing-data flows, timing limitations and remote trust modes have reviewed decisions.
- Query-only loading, browser fallback and bounded admission/cancellation match functional evidence; measured resource budgets remain future benchmark work.
- Known limitations, upgrade policy, test-vector corpus and future conformance-test plan are attached.
- WebZjs requirements/lessons and first-class external signer/PCZT contracts are attached; selected protocol handoffs have evidence. No WebZjs API or snapshot compatibility gate applies.
- WASM-first storage/transport choices are recorded against functional evidence, with native acceleration deferred; deferred pools and remote proving have explicit reconsideration triggers.
- No disposable prototype has become production code by default.

**Gate G6 — implementation readiness:** the project owner and designated reviewers approve the concrete specification and accepted limitations. This is a future project review gate, not a request to approve the present research task. Exit artifacts: approved API specification, evidence pack, decision log and implementation backlog linked to capability IDs.

After G6, any implementation discovery that changes an exported type, state transition, trust assumption, persistent format or host ownership rule reopens the relevant gate. Staged delivery can then prioritize the backlog without silently shrinking the intended full API.

## Documentation integration validation

This integration changed documentation only. `git diff --check` and `git diff --no-index --check /dev/null <file>` cover tracked and untracked Markdown; all 11 Markdown files were checked for NULs, trailing whitespace, final newlines and local targets/anchors. Targeted searches reviewed native-SQLite-on-Node defaults, hidden account defaults, public purpose fields, UIVK wallet imports, supported Orchard pool unions, universal local staging and current benchmark wording. Remaining matches are explicit exclusions, superseded history, source semantics or deferred work. D04–D25 decision rows remain identical except owner-refined D07; D03/D03a references now agree with it. No runtime tests or benchmarks are claimed; F1–F8 remain functional blockers.
