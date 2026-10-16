# Single-import release handoff

**rc.2 fixes are merged and the fresh Node testnet round trip passed.** Publication
remains owner-only. rc.1 was previously published and is not changed by this merge.
Parent: #165. Evidence/history: [release qualification](single-import-release.md).

The current source version is `0.1.0-rc.2`, addressing observation lag (#176) and
enhancement scan races (#177), merged by PR #178 at
`8aa6e41ecf3d2e7971635189f80e1b8afb920f84`. The exact post-merge artifact is
`/home/jack/zcash-package-consumer-TFjoGs/zcashlabs-zcash.js-0.1.0-rc.2.tgz`, SHA-256
`f6ae0df7944d4362759c165af044558e68121bcb34ca1fea2599bb4c833b17fd`.
It passed fresh Node/Firefox installation and persistence checks. The earlier rc.1 registry
artifact matched its tested tarball, but its live Node example needed manual
observation resumes; that is not acceptable qualification for these fixes.
The owner has set aside live endpoint work to focus on packaging; the remaining
qualification gates below are recorded, not silently waived.

## What consumers receive

One `@zcashlabs/zcash.js` dependency, imported through the public root. The baseline
wallet WASM, worker, Node/OPFS adapters, internal manifest and Sapling proving files
ship in that package. Ordinary installation needs no Rust build or asset download.
Wallet use loads the engine; proving loads only the assets the selected pool needs.
The files are separate lazy assets, not one enormous JavaScript file.

Persistent Node storage currently requires Linux and `/usr/bin/flock`. Testnet
acceptance is Ironwood-only at owner request. Independent development-candidate
Node A → B → A acceptance passed; browser and registry acceptance remain pending.

## Gates before owner publication

- [x] Two native builds with different source/cache locations match all 19 artifacts.
- [x] Locked dependency and policy-patch verification (257 packages), tool pins,
  native proof/fused-send tests, and retained notices.
- [x] Bundled default Node startup, persistent reopen, and asset integrity negatives.
- [x] Final packaging-only pass: independent installed Node and real Firefox/Vite
  worker/WASM/OPFS creation and reopen, lazy asset requests, complete packed asset
  inventory/digests, consumer types, root exports, and distributable README links.
- [x] Installed-package Ironwood receipt and owner-directed drain on the earlier candidate.
- [x] Development-candidate Node Ironwood round trip, exact receipt/balance/fee
  accounting, reopen, and duplicate-submission checks. Qualified tarball digest
  and first-leg pre-submission recovery caveat are in the qualification report;
  repeat qualification after changing publishable package bytes.
- [x] Pin rc.2 footprint and tarball digest: 59,863,855 bytes packed / 86,321,467
  unpacked. A fresh checkout of the merge passed 604 tests, one optional TLS skip,
  and the installed-package Node/Firefox checks. GitHub PR and main checks passed.
- [x] Fresh installed-package rc.2 Node Ironwood round trip passed, uninterrupted:
  funding, A → B → A, three confirmations, exact receipts/fees, reopen and one
  submission per payment. Zero manual resumes. See the release report.
- [x] Implement and Node-qualify #172/#173 recovery: bounded revalidation/replanning,
  actual native revision-race rejection/recovery, and concurrent watch/wait.
  Explicit targets and validation remain intact. See the release report for
  the limits of synthetic chain-view injection and unexplained source errors.
- [x] Fix and qualify #174 pre-submission freshness and #175 observation-tip races.
  Fresh Ironwood send across a forced tip advance, concurrent confirmation,
  single submission, exact receipts/fees and persistent reopen passed. Source
  changes are local and unpublished; GitHub tracking does not imply a release.
- [x] Explicitly limit release compatibility: README, changelog and platform guide
  state historical retained-database migration is unqualified. Fresh/same-candidate
  reopen coverage does not prove historical database compatibility.
- [ ] Live browser acceptance and final browser-candidate recheck. Owner resumed:
  reads, funded Ironwood receipt, OPFS persistence and proving/signing passed;
  pre-broadcast observation is blocked by the endpoint returning INTERNAL for an
  absent transaction. The finalized browser payment has zero attempts. See the
  release report; no server-error-to-absence bypass is permitted.
- [x] Next candidate metadata is `0.1.0-rc.2`; package, lockfile, test application
  pin and guide agree. No agent publication is authorized.

## Prepare the exact publishable candidate

Metadata preparation is complete. The owner published rc.1. After rc.2 testing,
the owner must decide whether to publish this explicitly limited prerelease
before full browser acceptance. No publishing credentials are inspected or stored.

```sh
npm ci
npm run check
npm run docs:typecheck
npm run docs:check-recovery
npm run docs:build
npm run test:package:browser
```

The installed-consumer runner retains the exact tarball and `result.json` outside
the repository, including SHA-256, compressed/uncompressed size and Node memory
snapshots. The browser runner also checks the installed Node consumer.
Run the testnet project against the selected final tarball; any content/version
change after qualification requires a new digest and requalification.

Publish tested bytes, not a newly packed working directory. After qualification,
these are the **owner-only** commands for the pinned rc.2 artifact:

```sh
sha256sum /home/jack/zcash-package-consumer-TFjoGs/zcashlabs-zcash.js-0.1.0-rc.2.tgz
npm publish /home/jack/zcash-package-consumer-TFjoGs/zcashlabs-zcash.js-0.1.0-rc.2.tgz --ignore-scripts --access public --tag next
```

Full live browser acceptance remains outstanding; do not describe it as qualified.
No publishing token belongs in source, issues, command arguments or test logs.

## Registry acceptance after owner publication

Create another independent project, install the exact published version with
`npm install @zcashlabs/zcash.js@0.1.0-rc.2`, and verify the registry tarball's integrity
against the owner-published artifact. Re-run public-import Node/browser wallet
loading, independent Ironwood send/receipt/restart and duplicate-prevention checks.
Only then can #171 and the parent be closed. Neither a passing tarball test nor
the act of publishing by itself proves registry acceptance.

The test application is in `examples/testnet/`; its README contains the commands.
Recovery material stays in its private directory; never attach it to an issue or
copy it into a browser bundle. Preserve the current databases and operation
receipts when recovering from an interrupted test; do not recreate a payment
with a new idempotency key merely because observation failed.
