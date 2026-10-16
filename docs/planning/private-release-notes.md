# Private delivery status

This is the private conformance record, not a publication announcement or live-chain result. The owner authorized local distribution qualification and subsequently MIT licensing; `private: true` remains intentional. The bounded offline work in #122–124 is complete; #121 (historical) remains open for the owner-assisted live-chain check on hold in #125. The receipts below retain their original tested source identities; later documentation does not change those identities.

## Qualified scope

The [payment qualification record](wallet-payments-qualification.md) binds the accepted synthetic Node filesystem and Firefox OPFS workflows to their source, runtime package and retained receipts. It covers public wallet construction, local transfer/shielding/TEX execution, PCZT proving/finalization, consent-bounded exact-byte recovery, a retained draft alongside a finalized operation, and the separately recorded worker-interruption cases. Those interruption checks do not establish whole-process crash recovery or in-page detection of silent browser-worker termination.

[Installation](../api/installation.md) records local tarball installation, Node ESM, browser imports, declarations, query-only tree-shaking, and the tested Vite/Webpack paths. The Webpack browser check opens, reads and closes an OPFS wallet using unchanged verified external assets; it does not run proving through that bundle. No CommonJS `require` entry is provided or claimed.

## Final workflow followthrough

Both original E2E05 processes exited zero using native `bb74dace75d6f1ca3c43108cf46390db9469b5e4`, build receipt `635f8a8163fbd94c4c7ff0a2d6a47b5b3971b070b18475f7bfbe7f4428e4cdb7`, and runtime manifest `8388ccc38b861ef5da60eaa7ced46809afaea826dd8821769a117bc780a7f677` (packaging source `e786711`). Native PR #28 merged as `9bc4597e90e95db0ec6b2bbc6a3ed636a7aaea7f`; SDK PR #114 merged as `77aba180f95e1bb4f941936665ddb650179b11d5`. The tested source identities above remain unchanged.

The shared workflow additionally qualifies an Ironwood-funded public local send, empty-fork replacement/replay/reopen, and two finalized operations discovered in one database without replenishing the older retry budget. The separate supplemental native funding fixture retains its own `9813235` source and hash receipt; it is not relabeled as output of the final producer. Two-operation recovery is not a large-inventory fairness claim; the [bounded recovery closeout](wallet-payments-qualification.md#bounded-offline-recovery-closeout-122) adds exact byte limits, persisted paging/rotation and expiry/branch/dependency guards without a stress campaign.

Node log: `/tmp/final-wallet-gaps-node-05.log`, SHA-256 `731d191116fa8eff4e3d01090c2f019497655aa201b7d67c28b9d2100a7ad61a`. Firefox receipt: `/home/jack/zcash-final-wallet-gaps-firefox-05-logs/firefox-3EjUSL.json`, SHA-256 `1539a37abc3c6bc70f864780d2d433782ac2b75059765ca96adb9421fc1a6295`: 45 workers destroyed, 301,589 ms, no unexpected requests, complete cleanup. Independent evidence review checked 82 saved assets. Earlier failed attempts remain retained; neither those failures nor older receipts were rebound to this result.

## Known limitations and dispositions

- #98 (historical) is resolved: mnemonic account creation/import no longer accepts `enabledPools`; native HD allocation retains the full supported key set. Viewing imports and spend/address policy remain separate.
- #97 (historical) now has passing actual Node/Firefox evidence for canonical UFVK-fingerprint lookup through a custom adapter and native key correspondence. The correction is integrated through PR #114 (historical); this scoped result does not close the remaining qualification obligations.
- #102 (historical) is explicitly deferred. Native import can retain verified finalized transparent scripts, but wallet finalization rejects already-finalized transparent inputs with `METHOD_NOT_SUPPORTED`. External signing that returns partial signatures and ordinary local sending remain in scope.
- #107 (historical) is implemented and qualified on actual Node and Firefox: current shared wallet startup, native scan parity, persistence/reopen, signer lifetime, cancellation and bootstrap cleanup. See the final threaded result in [wallet qualification](wallet-payments-qualification.md).

- #115 (historical) is reconciled for the retained SDK/runtime distribution: owned code is MIT, and the package carries the original permissive dependency notices. See [MIT distribution closeout](mit-distribution.md).
- #116 (historical) is complete: both current packages passed actual OPFS space exhaustion, interrupted writes and interrupted opening migration. The [source-bound receipt](../api/installation.md#current-opfs-fault-recovery-116) records rollback/retry/reopen and cleanup, independently of older fault and dispatch-interruption results.
- #123 (historical) resolves restore applicability: there is no public database backup/restore API. Conditional explicit-restore cases are not applicable, not passed tests. [External copies/rollback remain outside restore guarantees](../api/wallet-runtime.md#backup-and-restore-scope).

The deferred [#10–#12](future-issues.md) and #102 scope is unchanged. Whole-process/power-loss recovery, every browser/platform, performance budgets and independent security auditing are not established by the scoped synthetic receipts. Publication and deployment remain outside authorization.

## Security, privacy and provenance

The [security/privacy contract](../api/security-privacy.md) documents application-owned mnemonic input, caller-owned signers, sensitive viewing/history/PCZT data, network disclosure and trusted artifact pinning. Worker isolation is not a secure enclave; no encrypted-at-rest wallet or persistent spending-secret vault is claimed. Functional checks and independent source reviews support the specific behaviors recorded above, not a completed security/privacy audit.

Accepted receipts bind source archives, JS/WASM and worker inputs, artifact hashes and actual host results. Installation verifies the trusted manifest digest and executable closure. This is provenance for the named private artifacts, not a claim that every build is bit-for-bit reproducible or that a published artifact exists.

The [MIT distribution closeout](mit-distribution.md) supersedes the missing-notice observations in the historical [dependency inventory](dependency-inventory.md) for the retained distributions. It covers checksum-verified npm/Cargo sources and the native C/WASI/toolchain notices, without changing executable artifacts. That license/provenance work is not a vulnerability audit.

## Capability and boundary evidence

| Scope | Implemented boundary and retained evidence |
| --- | --- |
| Runtime and lazy imports | Verified manifests, bounded workers, cancellation/fallback, Node filesystem and OPFS: PR #69/#94/#118/#120. Query-only imports/tree-shaking and installed declarations: PR #105/#109 and [installation](../api/installation.md). Node ESM and browser ESM are supported; CommonJS is not. |
| Accounts, authority and addresses | Rust-owned mnemonic/UFVK account allocation, address derivation and signer correspondence: PR #85/#88/#95/#96/#99/#114. The real host workflows exercise retained native authority; focused signer checks cover captured adapters, bounded owned values and cancellation. No mnemonic generation or persistent spending-secret vault. |
| Clients, synchronization and queries | Public/light clients, native gRPC/gRPC-Web, source/network validation, bigint projections, pagination, scan/enhancement and rewind/replay: PR #74–83/#114 and [wallet qualification](wallet-payments-qualification.md). No operator failover or live provider claim. |
| Spending and PCZT | Public transfer/shield/TEX/Ironwood and native PCZT roles: PR #99–104/#114. Native effect/authorization validation and explicit signer export/redaction are exercised by the existing PCZT checks. External multi-step and already-finalized transparent inputs are explicitly unsupported; #102 remains deferred. |
| Durable operations | DB-owned discovery, consent/route/budget bounds, exact finalized bytes, unknown dispatch and fresh-owner recovery: PR #106/#108/#112/#114. Native journal/dependency observations compose with focused all-step wait tests. [#122's bounded edge-case evidence](wallet-payments-qualification.md#bounded-offline-recovery-closeout-122) is separate from the happy-path send. |
| Integrity and privacy checks | Artifact digest/media/size/path admission precedes execution (`tests/runtime/artifacts.test.js`); adapter ownership/redaction and native correspondence checks precede signing (`tests/sdk/signer-checks.js`, `tests/sdk/pczt-checks.js`, real account/PCZT host workflows). Payment source checks reject inconsistent identity/inclusion; offline recovery avoids endpoint/secret/prover calls. These are functional/source-review evidence, not enclave, zeroization or whole-project security-audit guarantees. |
| Distribution | Actual installed Node wallet and Webpack Firefox OPFS checks, browser Vite imports and types, complete matching runtime assets and third-party notices: PR #105/#109/#119. Historical Webpack receipts identify their tested bundle; they are not relabeled as a new bundle/proving test. |

## Owner handoff: live-chain check

#125 (historical) remains on hold. The owner will provide the test network/endpoint and coordinate a small test-funded wallet after offline closeout. Agree one public-API receive/sync/balance/send/confirmation/reopen workflow and the Node/browser execution scope before contacting that endpoint. No test funds, keys or live transaction have been requested or used by these offline checks. No further implementation feature is implied by the handoff.
