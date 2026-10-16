> Historical qualification record. For the current source build, use
> [Build from source](../api/building-locally.md); the build commands below describe earlier runs.

# Single-import release qualification

Tracking: historical issue #165 (children #166–#171).

## Current candidate: 0.1.0-rc.2

Issues #176 and #177 track the remaining fatal observation/enhancement races
identified by the registry-installed rc.1 example. The owner requested issue
creation, fixes, merge, and post-merge testing. The published single-import
baseline is preserved separately from the new fixes in Git history.

PR #178 merged the fixes at `8aa6e41ecf3d2e7971635189f80e1b8afb920f84`.
GitHub PR checks, explicit workflow checks, and post-merge main checks passed.

Exact post-merge artifact:
`/home/jack/zcash-package-consumer-TFjoGs/zcashlabs-zcash.js-0.1.0-rc.2.tgz`

SHA-256: `f6ae0df7944d4362759c165af044558e68121bcb34ca1fea2599bb4c833b17fd`.
Size: 59,863,855 bytes packed / 86,321,467 unpacked.

A new detached checkout of that merge installed dependencies from the lockfile
and passed lint/build/full tests with proving files enabled: 604 passed, one
optional TLS skip, zero failures. Its tarball passed the isolated installed Node
and Firefox 156 bundled WASM/worker/OPFS account create/reopen checks. It is
byte-identical to the independently tested pre-merge tarball. No SDK executable
changes are part of this documentation-only evidence update.

The new candidate adds spaced coherent-observation retries and continued
observation-only polling, and defers unspent enhancement when the source view
moves beyond the finite scan target. Permanent evidence conflicts remain errors.
The fresh post-merge Node acceptance passed in one uninterrupted process from
2026-09-20 22:19:00 UTC to 22:22:28 UTC. Its independent application is retained at
`/home/jack/zcash-rc2-testnet.dLZ6EN`; `result.json` records the audit. It installed
the exact tarball above, not a source link or the published rc.1.

- Fresh Ironwood-only A/B wallets; 300,000 zat funding from the authorized existing
  testnet wallet, followed by A → B 100,000 zat and B → A 50,000 zat.
- Each payment reached at least three confirmations. Exact receipt balance
  deltas, Ironwood spendability and database reopen checks passed.
- Final spendable A = 240,000 zat, B = 40,000 zat. The 280,000-zat sum is funding
  less the two 10,000-zat demo fees (external funding also cost 10,000 zat).
- Both demo operations retained exactly one acknowledged submission attempt and
  unchanged finalized transaction digests. Funding also had one attempt.
- No manual confirmation resumes, process restarts, replacement payment intents,
  or swallowed command failures. The acceptance runner has an exclusive start
  marker so a rerun cannot be mislabeled as this uninterrupted pass.

Funding: `a473a4e38b527c4421194a8b18b6043f96456d0d656a60dc4a62869fa5478a5c`.
A → B: `d29e5e7404f52a33d7da51d397b8b7ebda144424182602ebb4f7e878d8b912d2`.
B → A: `9fca80d7b214dba0ca1bff66bd6e1201b37ec3fb16dc040a67e0259c570d1cb4`.

These are real live acceptance results, not proof that every future endpoint
failure is recoverable. Deterministic regressions separately force delayed tip
catch-up and post-scan advancement. The older rc.1 manual-resume run remains
historical evidence, not acceptance of these fixes. rc.2 remains unpublished;
registry acceptance follows owner publication. Full browser testnet sending and
historical database migration remain unqualified. Wallet recovery material stays
in ignored private directories and is not part of this report or package.

## Prior release candidate: 0.1.0-rc.1

Owner selected `0.1.0-rc.1`. Package/lockfile/application pins and installation
instructions agree; `private` is removed and publishConfig defaults to public
access on npm with the `next` tag. No publication was performed.

Exact tested artifact:
`/home/jack/zcash-package-consumer-IL8mxE/zcashlabs-zcash.js-0.1.0-rc.1.tgz`

SHA-256: `bd47e04bcd2c1dd5b9ed75df83684790720c10a8a4027690c50df6b6479f358e`.
Size: 59,863,523 bytes packed / 86,318,679 unpacked.

- Full lint/build/test check passed: 591 passed, one optional TLS skip, zero
  failures (592 total), with actual proving files enabled.
- Documentation typechecking, recovery specification checks and site build passed.
- Fresh tarball-installed Node and Firefox 156 consumers passed bundled runtime
  startup, OPFS account creation and persistent reopen at a nested Vite base.
  No wallet or proving asset was fetched before wallet use; no Sapling parameters
  were requested for this read-only check. Retained `result.json` records all
  requests, emitted asset sizes and Node memory snapshots.
- Installed SDK `dist` bytes exactly match the previous packaging candidate;
  this version preparation changes metadata/documentation, not wallet execution.
  Initial application JS remains 655,446 bytes unminified. Open-wallet Node RSS
  was 354,234,368 bytes (a snapshot, not peak memory or a regression benchmark).
- Historical database migration and full live browser sending remain explicitly
  unqualified in shipped documentation. No new live sends occurred in this pass.
  Earlier Node testnet evidence is retained below, not relabeled as a new rc.1 run.
- Registry lookup returned E404; scope ownership and publishing permissions have
  not been verified. Owner publication and post-publication acceptance remain.

See [owner handoff](single-import-handoff.md) for the exact publication command.

## Prior development packaging handoff (0.0.0)

Owner asked to set aside the live endpoint blocker and finish package assembly.
The latest installable development tarball is:

`/home/jack/zcash-package-consumer-ZvkClr/zcashlabs-zcash.js-0.0.0.tgz`

SHA-256: `2dc77d28d8d9444acef6d1b71cfb3d1fc9c6378f6f432f982fac2a0b983892a3`.
Size: 59,863,396 bytes packed / 86,318,270 unpacked.

- Package contents are limited to `dist/src`, licenses, README, changelog and npm
  metadata. Removed the obsolete internal planning document from distribution;
  README guide links now work independently of a repository checkout.
- The isolated consumer verifies every bundled runtime/proving inventory entry's
  length and SHA-256, rejects extra asset files and unexpected top-level or
  wallet-data paths, checks README local links and absence of SDK install hooks.
- `npm run check`: 591 passed, one optional TLS skip, zero failures (592 total),
  with actual proving files enabled. A recovery error-classification fixture now
  has its own one-second deadline; deadline-specific tests retain short budgets.
- Documentation typechecking/recovery checks/site build and `git diff --check`
  passed. One cancellation fixture failed in the initial concurrent documentation
  build run; its focused rerun and the final complete suite passed.
- `npm run test:package:browser` installed this exact tarball into a new independent
  project and passed Node default-wallet startup plus actual Firefox 156 bundled
  WASM/worker/OPFS account creation, close and reopen. Vite emitted a single copy
  of each asset at a nested deployment base. Initial requests were HTML and
  655,446 bytes of unminified application JS; wallet/proving assets were not
  requested before wallet use, and no Sapling parameter requests occurred in the
  read-only wallet check. Asset requests repeat on wallet reopen; this is not a
  claim of cross-wallet runtime caching.
- The installed `dist` tree matches the current build and the prior live-qualified
  runtime-fix candidate. Packaging/README changes did not change SDK executable
  bytes. The retained `result.json` contains request lists, emitted sizes and
  Node memory snapshots (open-wallet RSS 356,245,504 bytes; not peak memory).

Release version is awaiting owner choice (`0.1.0-rc.1` recommended). The package
remains deliberately `0.0.0`, `private: true`; no publication was performed.
Selecting release metadata requires a new exact tarball and consumer recheck.
Packaging success does not waive historical migration qualification or the
incomplete live browser round trip recorded below. Its funded wallets and
unsubmitted operation remain preserved; no further live sends in this pass.

## Live browser qualification update

Owner resumed browser testing on 2026-09-20 with a new private gRPC-Web endpoint.
Actual Firefox 156 passed CORS, network/consensus validation, tip/tree matching,
three-block streaming, bundled runtime loading, and empty OPFS wallet sync/reopen.
The installed candidate remains SHA-256
`30c9f1682047f8b530b213300ccb7de74a951adc0e45ab668b07e69918bf4587`.

The independent project then built a Vite browser application importing the
installed package's public root and created independently keyed Ironwood-only
OPFS wallets C/D. Recovery material is privately backed up outside the application
bundle; the build is checked for accidental inclusion. The existing Node test
wallet funded C with 300,000 zat (10,000 zat fee), one acknowledged attempt.
Firefox verified C's exact incoming transaction/delta and spendability.

**The browser round trip is not complete.** C successfully proved/signed its
100,000-zat payment to D (10,000 zat planned fee), but pre-submission observation
failed. The durable operation is finalized with zero submission attempts; it was
inspected after a complete browser-process restart. No browser payment was
broadcast and no replacement intent was created.

The endpoint's `GetTransaction` returns successful data for the known funding
transaction, but returns gRPC `INTERNAL` (13), with `InternalServerError: error
receiving data from backing node`, for the unbroadcast transaction and a zero-hash
absent-transaction probe. The reference Node endpoint reports the unbroadcast
transaction absent. The SDK must not translate arbitrary backend failures into
absence or bypass pre-broadcast observation. The endpoint needs to preserve
authoritative absence as `NOT_FOUND` (5), while retaining genuine backend errors.
No server deployment/change or validation bypass was performed.

Private retained application/profile and receipts:
`/home/jack/zcash-testnet-acceptance-20260920/` (`browser-roundtrip.mjs`,
`browser-app.mjs`, `browser-funding.mjs`, `private/browser-*`). Run
`node browser-roundtrip.mjs --inspect-only` for local retained-operation inspection;
it does not submit funds. After endpoint correction, inspect expiry and resume the
retained intent. Full C → D → C confirmation, receiver audits and final restart
checks remain outstanding. The runner's `--audit-only` is only valid after a
completed round trip.

## Current non-browser pass

Runtime fixes are implemented and Node-qualified in the unpublished working tree
(2026-09-20):

- #172: bounded chain-view revalidation/replanning, specific retryable
  `SYNC_REQUIRED`, and no replacement of caller-supplied targets. Malformed data,
  unexplained native protocol errors, and unknown write completion are not replayed.
- #173: bounded replanning after native stale-revision rejection. The real-runtime
  test records a native payment observation between plan and ingest, verifies the
  rejection, and then completes non-empty scanning without changing transaction
  identity or attempts. A separate synthetic predecessor-change test recovers
  through a fresh validated pass against the real runtime; it is not a consensus
  reorg simulation. Commands are in `tests/README.md`.
- #174 first-send guard: explicit submission refreshes a scan left behind during
  proving, then re-observes before native admission. Finalized bytes are retained;
  no construction, signing, or network submission is retried by this path.
- #175: coherent payment observation retries when a new block arrives during
  evidence collection. Stable invalid evidence remains rejected. The example now
  consumes `watchSync` concurrently with payment waiting, without the workaround.

Regression: `npm run check` with actual proving files enabled passed 591 tests,
one optional TLS skip, zero failures (592 total). Documentation typechecking,
recovery-spec checks, site build, and `git diff --check` passed.

Live runtime-fix candidate SHA-256:
`32779ef65d262e4f0d5aca5c559c3deab5d0747585290d163f15e9ca7d4c5c02`.
The first test payment's retained bytes submitted once after a forced tip advance;
its initial confirmation exposed #175. After fixing observation, concurrent
watch/wait confirmed that same payment at 38 confirmations without resubmission.
A second, fresh payment then passed in one invocation: scan height 4,371,395,
observed height 4,371,398, SDK scan refresh, one submission, and four confirmations
with concurrent watch/wait. Both payments sent 100,000 zat, each with a 10,000 zat
fee. Exact Ironwood receipts, balance deltas, fees, retained transaction digests,
single acknowledged attempts and spendability passed before and after reopening.
Balances after these additional tests: A 99,720,000 zat, B 240,000 zat; combined
99,960,000 zat equals the 1 TAZ funding less four total 10,000 zat test fees.

The live source also exhausted three target-pin attempts during the balance audit;
it returned the intended retryable `SYNC_REQUIRED`. Three subsequent tip/tree
comparisons agreed, and the unchanged audit then passed. An earlier generic
native batch rejection at target 4,371,331 was not independently diagnosed; a later
hash comparison alone cannot prove its cause. Unexplained native rejections remain
errors, not an excuse to bypass validation or claim every provider failure fixed.

Final documentation/notice candidate:
`/home/jack/zcash-package-consumer-mebHQF/zcashlabs-zcash.js-0.0.0.tgz`, SHA-256
`30c9f1682047f8b530b213300ccb7de74a951adc0e45ab668b07e69918bf4587`;
59,870,216 bytes packed / 86,336,861 unpacked. Clean installed Node checks passed.
Its distributed `dist` tree is byte-identical to the live runtime-fix candidate;
the changelog changed. Installing this final tarball into the independent testnet
project also passed concurrent confirmation of the retained payment (88
confirmations, one unchanged attempt) and both-wallet exact balance/fee/reopen
audits, with no new submissions. No browser run or npm publication is claimed.

## Earlier Node round-trip qualification

Earlier live result (2026-09-20): the development tarball with SHA-256
`fe366c180cc273111b27daa0ab78f21724c98dab5753cad3e9c5017af8a554fe`
completed the independent Node Ironwood A → B → A round trip after owner funding
of 1 TAZ. A sent 100,000 zat with a 10,000 zat fee (mined at 4,371,071);
B returned 50,000 zat with a 10,000 zat fee (mined at 4,371,076). Both reached
three confirmations. Exact received balance deltas and spendability passed before
and after reopening. Repeating both original send commands with their original
request IDs preserved transaction IDs, exact-byte digests and one acknowledged
submission attempt per operation. Final reopened spendable balances were
99,940,000 zat in A and 40,000 zat in B: 99,980,000 zat combined, accounting for
exactly 20,000 zat in fees. All balances and transaction history pools were Ironwood.
The independent project's `audit-roundtrip.mjs` asserts this accounting and
retained-operation identity without submitting transactions.

Qualification caveat: the first send finalized but failed before submission with
`RECOVERY_REQUIRED`, zero attempts and retained exact bytes. Reopening, syncing
and resuming the same request submitted those bytes once and confirmed. The
observed tip had advanced during proving; native submission requires its observed
tip to match the wallet's scanned chain tip. This is consistent with that freshness
guard, not a missing runtime/proving asset. No claim is made that uninterrupted
send across a tip advance or SDK concurrency issue #173 is fixed. Subsequent return
send completed in one invocation. Browser and registry acceptance remain pending.

Browser work is deferred by owner request. The owner also retains npm publication.
The existing goal has been resumed; browser work remains outside the active pass.
The owner publication checklist is [the handoff](single-import-handoff.md).

- Path normalization is verified: two builds using different source and Cargo
  cache locations matched all 19 artifacts. WASM SHA-256:
  `3545cfd587e6724a7da50ba26461cf64b52ce2b96b00a5f017821738883ec6b5`.
  Both builds verified all 257 locked dependencies. Only the diagnostic source
  paths changed from the earlier binary; the prior unnormalized clean-cache
  comparison correctly failed byte equality and was not accepted.
- Current vendored runtime: `.local/single-import/runtime-remapped-09`, manifest
  SHA-256 `be375d498d52fc64e12056139dca86aa6d4087fe73c5d6fc8154ae1f7ebbd145`.
  This supersedes the earlier candidates documented below; final-candidate
  installed Node verification passed. No npm release has been published.
- Fresh normal npm installation: `/home/jack/zcash-package-consumer-9G2LwO`.
  Candidate tarball SHA-256:
  `942854df5de6c6499efba909325e720dc579823ba50d662886232fb095979700`.
  Size: 59,866,516 bytes packed / 86,326,298 unpacked. No browser run in this pass.
  SDK regression: 573 passed, 1 optional TLS test skipped, 0 failed (574 total);
  actual proving files enabled. Lint and all 29 displayed documentation examples
  passed, and `git diff --check` was clean.
- The previously installed candidate received 0.01 TAZ into Ironwood, verified
  the exact funding transaction and spendability after reopening, and then—at
  the owner's explicit request—sent 0.0099 TAZ to the owner's address with a
  0.0001 TAZ fee. One submission attempt was acknowledged; native operation state
  reached `complete` with 5 confirmations, and the reopened/synced balance was zero.
  No private transaction/address/account identifiers are included in this report.
- That earlier owner transfer was not the independent A → B → A round trip.
  Both wallets were then empty; subsequent owner funding enabled the completed
  round trip recorded above. Funding is no longer a blocker. The harness requires
  Ironwood-only receivers, spending and change.
- The payment observation wait alone did not complete before a separate wallet
  sync; after reopening/syncing, the operation projected as complete. The harness
  now uses the sequential scan/observation flow that passed the Node round trip.
- Mid-sync source-view changes are separately tracked in #172 with a verified
  no-funds reproduction. Recovery diagnostics must not be confused with missing
  runtime assets or Ironwood encoding incompatibility.
- Concurrent `watchSync` and payment waiting exposed a separate native revision
  interleaving failure (#173). The application now alternates finite sync with
  bounded payment observation. This sequential workaround successfully resumed
  the existing operation to 30 confirmations with exactly its original single
  submission attempt. The SDK issue remains open.
- Current worker-pinned runtime supersedes runtime-remapped-09: manifest SHA-256
  `0f96be360949ff6d8a9167d21be2cacf91005c41f5a16a226b5e1d434a9426f7`.
  Builds now verify worker source correspondence, the generated manifest pin and
  retained runtime notices in addition to executable/proving file hashes. Normal
  `npm pack` runs the build verification. Targeted failure tests reject stale
  worker input, stale manifest pin and a missing inventoried file.
- Same-engine Node memory comparison passed three paired isolated-process runs:
  bundled loading made zero asset requests, HTTPS loading made six per run.
  Median open-wallet RSS: bundled 352,292,864 bytes; external 356,458,496 bytes.
  Both used identical manifest/engine bytes and default runtime/proving settings.
  These forced-GC snapshots do not measure peak/proving memory or browser memory,
  and are not a general performance/no-regression guarantee. Evidence:
  `/home/jack/zcash-package-consumer-xM3aRA/memory-comparison.json`.
- Latest metadata/notice candidate was packed with the normal prepack checks and
  installed successfully in `/home/jack/zcash-package-consumer-DorthF`.
  Tarball SHA-256 `fe366c180cc273111b27daa0ab78f21724c98dab5753cad3e9c5017af8a554fe`;
  59,868,747 packed bytes / 86,330,213 unpacked bytes. Regression: 576 passed,
  one optional TLS skip, zero failures (577 total). The current package remains
  private version 0.0.0; this is a development candidate, not publication approval.
- The same-engine comparison was repeated against this exact latest tarball:
  median open-wallet RSS was 353,755,136 bundled versus 359,567,360 HTTPS bytes,
  again with zero versus six runtime-asset requests. Full paired observations:
  `/home/jack/zcash-package-consumer-DorthF/memory-comparison.json`.
- This exact tarball was also installed into the independent testnet project.
  Its public-API `confirm` command reopened the existing owner-directed payment
  and reached `complete` at 47 confirmations, retaining the original exact-byte
  digest and exactly one acknowledged submission attempt. This command only
  observes an existing operation; no new transfer was submitted. It verifies
  final-candidate persisted-operation recovery, not final-candidate send proving.
- Retained migration coverage requires the external immutable corpus consumed by
  native `schema_retained_fixture_admission`: 67 legitimate migration prefixes
  and 54 contradictory original fixtures, with source-bound inventory receipts.
  The recovered source contains the test and inventory generator, but not that
  historical corpus. Native `src/wallet/schema.md` explicitly says the ordinary
  native pass does not qualify it. Do not replace this gate with fresh synthetic
  fixtures or a claim of broad historical database compatibility.

The acceptance target is a clean installed `@zcashlabs/zcash.js` consumer that loads
its included engine and proving assets and completes confirmed testnet A → B → A
transfers, receipt, spendability and restart checks in Node and a real browser.
The owner publishes npm; registry acceptance follows publication.

## Native source recovery

Source: https://github.com/jp4g/zakura-wasm-bindings

Pinned candidate: `83b4693a83722d534d98cc5c7a7532e38a54a4db`.
The native Rust source is unchanged from the previously packaged native revision
`ac9a46a0b499859bb18a6b116f533f91ee8105ee`; subsequent changes fix JS runtime
exports and packaging. This is source evidence, not fresh native qualification.

The old producer depends on unavailable absolute scratch paths, an inherited
build receipt and private tool locations. `scripts/build-native-wallet.js` is
the replacement candidate: explicit paths, pinned source/bindgen, locked Cargo
inputs and a newly generated receipt. It is not yet a completed release pipeline.

Tools recovered from upstream release archives:

| Tool | Archive SHA-256 |
| --- | --- |
| wasi-sdk 27.0 x86_64-linux | `b7d4d944c88503e4f21d84af07ac293e3440b1b6210bfd7fe78e0afd92c23bc2` |
| wasm-bindgen 0.2.128 x86_64-unknown-linux-musl | `b51f0208fdff83515a787bd8ab9ac5865ed84dabb66d0c709957bb59793c645f` |

The wasm-bindgen executable also matches the historical pinned SHA-256
`dc9e4f1e03996c26fb8bfedfded73d81120a37251c3f19eb87bb460f1f89a5be`.
Current compiler: Rust 1.98.1 (`48a229ceaefd4985c50990b14116b6d856af0985`).

Prepare the owned source checkout with `python3 native-policy/prepare.py` after
the two locked upstream policy crates are available in the Cargo cache. This
verifies archives and applies the committed patches. `cargo fetch --locked`
prepares remaining dependencies; compilation itself uses `--locked --offline`.
The producer expects this prepared checkout. A fresh checkout and empty Cargo
cache have now successfully bootstrapped using the commands below; its independent
compilation is being checked. `scripts/verify-native-inputs.py` verifies each
locked registry archive and extracted source and independently reconstructs the
native policy patches before compilation; all 257 packages passed. The producer pins
the Rust version, bindgen executable, WASI compiler and WASI libc. A second fresh
target build matched all 19 artifacts byte-for-byte, including wallet WASM
`770b15f068c5903f789b9aa57ffa6c367f44f9d038a2df3c919981fa22ba4c4a`.
This comparison used the same source checkout and Cargo registry paths; arbitrary
path-independent byte reproduction has not yet been established.

```sh
node scripts/build-native-wallet.js SOURCE WASI_SDK WASM_BINDGEN NEW_OUTPUT
```

Clean-cache preparation (use an absolute, new `CARGO_HOME`, and run `cargo info`
outside the native checkout before preparing its local patches):

```sh
git clone --no-checkout https://github.com/jp4g/zakura-wasm-bindings.git SOURCE
git -C SOURCE checkout --detach 83b4693a83722d534d98cc5c7a7532e38a54a4db
export CARGO_HOME=/absolute/new/cargo-cache
cargo info zakura-client-backend@0.1.0-rc4
cargo info zakura-client-sqlite@0.1.0-rc4
cd SOURCE
python3 native-policy/prepare.py
cargo fetch --locked
```

Install Rust 1.98.1 with the `wasm32-unknown-unknown` target and the pinned WASI
SDK/bindgen archives above. From this SDK checkout, run the producer, followed by:

```sh
npm ci
npm run build
node scripts/build-wallet-worker.js NEW_WORKER.mjs
node scripts/package-native-wallet.js NATIVE_BUILD SOURCE NEW_WORKER.mjs NEW_RUNTIME
```

To replace package assets deliberately, preserve the current `src/runtime/assets`
directory in an owned backup first, then run
`node scripts/bundled-assets.js --generate NEW_RUNTIME PROVING_DIRECTORY`.
The generator refuses to overwrite the existing inventory. Run `npm run build`
again to verify/copy the new pins and assets. Ordinary consumer builds do not
compile Rust or download tools, runtime files or proving parameters.

Native tests need a new `WALLET_TEST_ROOT`. Proving tests additionally need
`PCZT_PROVING_PARAMETERS` containing the canonical Sapling spend/output files.
Both parameter files were retrieved from `https://download.z.cash/downloads/`
and matched the SDK's existing SHA-256 pins. Both were independently reconstructed
byte-for-byte from the six `wagyu-zcash-parameters` 0.2.0 crate distributions;
the distributions' MIT/Apache notices are retained in `licenses/SAPLING-PARAMETERS*`.

## Existing evidence and outstanding acceptance

- Historical live Node receive/send/confirmation: issue #125. This did not use
  the proposed self-contained package.
- Browser gRPC-Web/CORS endpoint qualification: issue #128 remains open.
- Matching historical baseline bundle: native persistence and startup rejection
  checks passed with the current freshly bundled SDK worker; manifest file hashes
  and build/dependency receipt hashes matched.
- The original npm dry-run omitted wallet WASM and runtime manifests. The current
  candidate includes the baseline engine, workers and both Sapling parameters.
- Fresh native library run passed 71 tests with 7 ignored and 2 filtered out
  (`schema_source_effects_compose`, `schema_document_committed_prefixes_resume`).
  These exclusions remain explicit; this is not full migration/proving coverage.
- Follow-up optimized native schema run passed all 4 enabled checks, including
  both previously filtered checks. The retained-fixture migration test requires
  separately retained historical database receipts and remains unqualified.
- Real fused-send coverage passed transfer, shielding, multi-step TEX, injected
  rollback, exact-byte retries without authority/proof reload, and persistence
  after reopening (1 test, 57 seconds).
- Fresh baseline WASM compilation succeeded using recovered upstream tools.
  Memory/import inspection passed. `scripts/package-native-wallet.js` assembled
  that binary with the current SDK worker; six startup/persistence cases passed
  (including account/address/balance and close/reopen).
- Local candidate: `.local/single-import/runtime-01`, manifest SHA-256
  `46273eea373cfcd33f407b7f6f7246ae23747f51769448f6cd719c4cfde3eb11`.
  This generated candidate is not yet shipped or a release pin.
- The current vendored candidate supersedes it with verified dependency receipts:
  `.local/single-import/runtime-verified-05`, manifest SHA-256
  `4082c5500784281e97886dc470363fb2e0e2f84e51379598bc4139b1d8e63337`.
  The WASM and worker remain byte-identical; build/graph/identity receipts changed.
- `/tmp` hit a write quota during package creation and proof tests. Running the
  runtime test with storage under `.local/single-import/` passed. The interrupted
  proof/finalization checks are being repeated with workspace storage; their
  earlier storage-error results are not successful qualification.
- Native real Sapling and Ironwood proof/finalization checks both passed with
  workspace-backed test storage (278 seconds, 2 tests).
- Root-import regression opens the packaged engine with no runtime/proving
  options or network fetch, imports an account and verifies persistent reopen.
- SDK suite: 571 passed, 2 skipped, 0 failed (573 total). Lint, documentation
  typechecking (29 examples) and the documentation production build passed.
- Isolated packed Node consumer imports/types and actual default wallet opening
  passed; missing and corrupted installed WASM are rejected before wallet
  startup. Webpack and Vite browser import checks passed.
- `scripts/verify-bundled-browser.js` installs the tarball into a new project
  outside this repository, produces a Vite application with `/nested/` base, and
  runs public wallet import/address/balance/OPFS reopen in real Firefox 156.
  It passed without runtime overrides. No wallet/proving files were fetched on
  initial import; no proving parameters were fetched by the read-only workflow.
  Evidence: `/home/jack/zcash-package-consumer-Coach3/result.json`.
- That candidate measured 59,814,757 packed bytes / 86,210,062 unpacked bytes.
  Unminified application JS: 651,145 bytes; lazy codec JS: 3,989,094 bytes;
  wallet WASM: 21,149,840 bytes; proving parameters: 51,551,256 bytes.
  These are measured sizes, not a before/after memory or performance comparison.
- The latest verified-receipt candidate passed another independent Node/Firefox
  installation at `/home/jack/zcash-package-consumer-8wbK1V/result.json`.
  Tarball SHA-256: `e4a08344a66b7d01d8686737c479d7beb2352885cac7ded99e998934169a1da2`;
  packed 59,866,659 bytes, unpacked 86,329,500 bytes. Browser asset sizes are
  unchanged. Forced-GC Node 26.8.1/Linux x64 RSS snapshots were 47,190,016 bytes
  before import, 60,071,936 after import, 354,488,320 with an empty memory wallet
  open, and 295,948,288 after close. RSS includes workers; these are snapshots,
  not peak/proving memory, a browser measurement, or evidence of no regression.
- Bundled proving loads passed offline integrity verification, corrupted proving
  bytes were rejected, and the existing canonical memory/persistent-cache test
  passed with actual parameters (4 targeted tests, no skips).
- Fresh installed testnet project: `/home/jack/zcash-testnet-acceptance-20260920`.
  Its public SDK handshake reached testnet tip 4,370,653. Two fresh independently
  keyed persistent wallets were created and subsequently synced to 4,370,664/665,
  with zero balances. Recovery material is private and never copied into this repo.
  The initial sync correctly rejected a changing target: block 4,370,659's hash
  changed between the failed run and a read-only follow-up. A subsequent explicit
  sync succeeded. This is live chain movement, not a waived consistency check.
- Browser live endpoint recheck: `testnet.zec.rocks` still returns preflight 404;
  `zaino.testnet.unsafe.zec.rocks` returns native gRPC without CORS, and
  `lwd.testnet.zec.pro` returned HTTP 521. No browser live-transfer claim.
- At this earlier checkpoint, funding had been requested and no live spend had
  been submitted. The later installed-package Node round trip is recorded above.
- Complete retained native migration coverage and registry-installed acceptance
  remain unqualified; installed-package Node live transfers have since passed.
