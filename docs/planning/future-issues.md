# Tracked future work

## Issue #10 — Assess less-common account imports and unstable key interchange

**Status:** deferred beyond v1 (D20), tracked as GitHub issue #10 (historical) in the `Post-v1 — Deferred` milestone and [project board](https://github.com/users/jp4g/projects/4). No delivery commitment or v1 scope expansion is implied.

**Problem and baseline:** v1 supports application-supplied mnemonic creation/recovery and UFVK wallet import. Applications use a reputable BIP39 npm package, retain their mnemonic backup, and pass the mnemonic to `wallet.accounts.create({ mnemonic })` or `wallet.accounts.import({ mnemonic, accountIndex, birthday })`. zcash.js provides no mnemonic/seed generation and no raw spending-key export (D16/D19). Source codecs alone do not establish safe, coherent wallet imports. Standalone UIVK codecs/address derivation remain distinct from wallet scanning and balances.

**Scope and required outcomes:**

| Facility to assess | Required investigation and contract |
| --- | --- |
| UIVK-only wallets | Establish a supported backend import/storage/scan path or document the missing primitive. Define incoming-only history, inability to determine shielded spentness/balance, explicit errors for balance/spend APIs, birthdays/rescan, and upgrade to matching UFVK with reconstructed state. Never present incoming totals as spendable balance. |
| Standalone transparent WIF/private-key and account-level imports | Verify pinned codecs, network/compression/encoding checks, key-to-account mapping, viewing/signing coverage, duplicate/collision behavior, discovery ranges, birthday/recovery, and backup of non-derived keys. Do not fabricate shielded components to fit a unified account. Include raw seed/seed-handle helper assessment separately from mnemonic onboarding. |
| P2SH/redeem-script imports | Define script ownership/watch-only versus spendable semantics, supported script templates, required keys/thresholds, script-hash validation, discovery and recovery metadata, and actual transaction/PCZT signing limitations. Decoding an address is not arbitrary script-spending support. |
| Raw Orchard/Ironwood component keys | Verify exact codec/length/validity and authority derivation; shared Orchard key structure does not imply legacy Orchard transaction support. Define explicit network/pool context, account registration and collision rules; never imply Sapling/transparent authority from one component. |
| Unstable USK binary import/export | Pin graph, codec version and era; establish format detection, bounds, malformed-input behavior, migration and incompatibility policy. Evaluate whether any public exposure is justified; this is not a portable user-facing standard. Any future raw spending-key export requires a new scope decision, disclosure/custody policy and security review; v1 stays excluded for every pool and encoding. |
| Coherent ZeWIF import | Assess available specification, implementation and version maturity on one coherent dependency graph. Map supported account/key/script/viewing data and recovery metadata; define unknown/unsupported item behavior, atomicity or explicit partial-import reports, duplicates, provenance and secret handling. Record unsupported cases rather than guessing encodings or promising complete recovery. |
| Any future stable Zakura mnemonic utility | Recheck actual availability, stability, target support, BIP39 validation/passphrase behavior and dependency coherence. Evaluate reuse for supplied-mnemonic processing; generation remains application-owned unless a later explicit decision revisits D19. Do not claim a utility exists or add a generation API based on this deferred assessment. |

**Acceptance criteria:**

- Record exact specification revisions, crate versions/SHAs, features, source symbols and missing backend paths on the coherent pinned Common/wallet graph (initially 1.0.0). Do not mix 1.1.0 evidence into the runtime graph.
- Give each facility an explicit include/defer/reject disposition with rationale, supported runtimes, limitations and review trigger. Assessment may conclude that a facility should remain unsupported.
- For each proposed inclusion, specify JS and host inputs/results, encoding/version/network validation, authority, secret lifetime/redaction, persistence, cancellation/atomicity, collision/upgrade behavior, recovery and structured errors. Preserve all-or-none authority for tracked account outputs.
- Define and, before implementation readiness, execute relevant pinned vectors and negative tests: malformed/wrong-network keys, version mismatch, duplicate/conflicting imports, script/key mismatch, partial authority, UIVK balance rejection, upgrade rescans, restore round trips and Node/browser behavior. Distinguish source inspection from executed evidence.
- Obtain protocol, wallet-state, runtime and security review; update the decision log, keys plan, namespace audit and capability matrix together before approving any expanded surface. No automatic v1 expansion, compatibility promise, dependency addition or production implementation follows from issue creation.

**Evidence and dependencies:** [Keys plan K2–K5 and W1–W5](keys-accounts-signers-api.md#source-evidence-and-semantic-differences), [decision log D16/D16a/D17/D19/D20](decision-log.md), and [workplan G2–G6](api-surface-workplan.md). Persistent encrypted custody remains separately deferred by D16a; an import assessment does not implement a vault. Existing namespace conclusions remain in force.

## Issue #11 — WASM performance and possible native acceleration {#issue-11-wasm-performance-and-possible-native-acceleration}

**Title:** Benchmark qualified WASM and evaluate optional native acceleration.

**Status:** deferred performance study tracked as GitHub issue #11 (historical) in the `Post-v1 — Deferred` milestone and [project board](https://github.com/users/jp4g/projects/4). It commits no delivery date or N-API implementation. **Execution dependencies:** [F1–F8 functional evidence](wasm-host-architecture.md#functional-acceptance-gates), stable [transaction/query semantics](transaction-query-api.md), coherent pinned dependency graph and qualified storage/worker variants. Functional correctness/liveness proof is separate from this benchmark study.

**Problem:** determine which WASM boundary, concurrency, SIMD, asset-cache and batching choices meet product budgets while preserving custody, protocol behavior and durability. WASM-first Node/browser is the baseline. Native/N-API is only a separately approved follow-up comparison after a demonstrated WASM budget shortfall; no native SQLite default or acceleration promise follows from this tracked issue.

**Acceptance criteria:**

- Before collecting comparative measurements, record agreed numeric budgets for representative scan/proof latency, p50/p95 response time, responsiveness, memory, asset download size and acceptable regression on each target class. Assign an owner to each budget; do not invent thresholds or assume upstream speedup multipliers.
- Publish reproducible fixtures/provenance/hashes, dependency lockfiles, feature trees, Rust/C toolchain and adapter versions, module/glue hashes, build flags, engines/OS/CPU/memory and package/bundler configuration. Cover supported Node releases, representative Chromium/Firefox/WebKit, and a constrained mobile device. Record isolation headers and unsupported cells explicitly.
- Separate cold download/load/compile/instantiate/pool/parameter setup from warm operations. Measure scanning across block/output/key counts and batch sizes, subtree work, Sapling and Ironwood proving/verification separately, signing, PCZT serialization/exchange, local finalization and SQLite commits. Use small/larger transactions and wallets; include realistic combined scan/prove/sign contention.
- Compare non-shared single worker, independent baseline workers, qualified Node shared Rayon and isolated-browser shared Rayon over bounded pool sizes. Compare SIMD only where supported and actually emitted. Preserve the no-SAB baseline and identical public semantics.
- Record end-to-end wall time, p50/p95, throughput, cold asset size, peak WASM and available host/process memory, duplicated parameters, worker stacks, allocations/copies/transferred bytes, memory growth, event-loop/UI responsiveness, cancellation acknowledgment, pressure/OOM and failures. Publish warmup, repetitions, variance and environmental limitations; separate storage/network/CPU costs.
- Compare owned array marshalling and checked internal leases, transferable batches/shared queues, batch sizes, parameter/proving-key reuse, and release/LTO/codegen/optimization settings. Keep simple defaults unless measured benefit justifies complexity, privacy and memory cost; do not expose wallet memory to applications for a benchmark gain.
- Require correctness, effect/verification and durability parity for every comparison, including exact-byte outbox recovery. Publish a pass/fail table against agreed budgets and explain unsupported/failing workloads rather than hiding them in averages.
- Deliver a written decision on default worker count/admission, shared-browser selection, cache/batch defaults, optional SIMD variants and upstream work. If a WASM budget shortfall remains, document its workload and evidence, obtain a separate acceleration scope decision, and only then specify a native/N-API comparison with the same fixtures/API plus installation, platform distribution and maintenance costs. Any native storage change requires an explicit architecture decision; it is not a free VFS replacement.

**Exit artifacts:** reproducibility manifest, benchmark harness/results, budget comparison and reviewed architecture decision; update D03a/D07, host plan and workplan only for justified changes. No benchmarking is authorized by this documentation integration.

## Issue #12 — Coherent Common 1.1.0 migration

D06a follow-up tracked as GitHub issue #12 (historical) in the `Post-v1 — Deferred` milestone and [project board](https://github.com/users/jp4g/projects/4). Align every Common/wallet/crypto edge on one pinned 1.1.0 graph, preserve lock/checksum provenance, run the first-party graph audit, compile supported targets and execute transparent/Sapling/Ironwood local/PCZT/scan/storage/reorg fixtures before replacing the coherent 1.0.0 baseline. A mixed published compile spike is not migration acceptance. Performance comparisons remain in the separate benchmark issue above.
