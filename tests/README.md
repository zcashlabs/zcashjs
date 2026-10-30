# Running tests

For development use Node ^22.13.0 or >=24, as required by ESLint, and the
[source-build prerequisites](../docs/api/building-locally.md). From a fresh checkout:

```sh
npm ci
npm run check
```

`check` runs lint, builds `dist/`, and runs `tests/*/*.test.js` with four files
at a time. `npm test` omits lint; `npm run test:sdk` runs only SDK tests.
The first build compiles Rust; later builds reuse verified native output.
No live blockchain endpoint is needed.
The `SDK regression` workflow runs this command on Linux for pull requests and
main-branch pushes. Fork workflows may need maintainer approval before running.

The network-parameter tests also migrate genuine RC4 databases containing
prepared and finalized payments; see [fixture provenance](fixtures/nu7/README.md).

Native integration tests execute the pinned WASM in [fixtures/](fixtures/README.md).
Missing or modified fixtures fail rather than silently skipping native coverage.
All source-under-test imports use the current repository's `dist/` directory.
When invoking a test file directly, run `npm run build` first.

`tests/wallet/bundled.test.js` also opens the shipped runtime and verifies the
included proving files offline, without explicit runtime or asset-loader options.
The packed Node consumer rejects missing/corrupted installed WASM.

For a fresh, genuinely installed Node/Vite/Firefox consumer, run:

```sh
npm run test:package:browser
```

This installs the tarball and npm dependencies in a new sibling project, builds
a nested-base Vite application, checks lazy network loading and OPFS persistence
for both legacy `/1` and NU7 `/2` network documents,
and retains `result.json`, asset sizes, a tarball digest and Node memory snapshots.
It needs registry access, Firefox and geckodriver. This is not a live-chain test;
the separate [testnet application](../examples/testnet/README.md) requires funding
and the appropriate network endpoint. Publication and live acceptance status are
tracked in [the release report](../docs/planning/single-import-release.md).

For an opt-in runtime recovery check, close a testnet wallet containing an
observed finalized payment, let it fall behind the chain, then run:

```sh
node tests/wallet/runtime-recovery-live.js /absolute/path/to/closed-wallet revision
node tests/wallet/runtime-recovery-live.js /absolute/path/to/closed-wallet source-change
```

Each run locks and copies the database into a private temporary directory, then
tests the bundled native runtime without submitting a payment or changing the
original wallet. `revision` records a real native observation between planning
and ingest, verifies stale-plan rejection, and requires successful replanning.
`source-change` injects one synthetic changed predecessor into a live source and
requires a fresh validated pass. Both retain transaction identity and attempts;
the latter is not a simulated consensus reorg. The temporary copy is removed on
exit. These checks require the public testnet endpoint, not recovery material.

`npm run test:package:node` runs only the clean installed Node portion, without
building or launching the browser application. To compare the same installed
engine loaded locally versus externally, run
`node scripts/compare-wallet-memory.js CONSUMER CERT KEY` with that retained
consumer and a locally trusted TLS certificate/key. The child processes trust
only the supplied additional CA; certificate verification is not disabled.

## Optional browser and TLS tests

The Node suite includes mocked browser-runner lifecycle checks and a VM bundle
check. Those do not claim real browser coverage. Actual browser runners require
Linux, Firefox, and a compatible geckodriver on PATH. Set `GECKODRIVER` to choose
another driver executable; let that driver select its Firefox executable.

```sh
npm run test:sdk:real-firefox
npm run build
node tests/clients/grpc-web-browser.js
node tests/clients/public-chain-reads-browser.js
node tests/clients/public-block-reads-browser.js
node tests/clients/public-transaction-reads-browser.js
node tests/clients/light-chain-reads-browser.js
node tests/clients/light-transparent-reads-browser.js
node tests/clients/light-server-observation-browser.js
node tests/wallet/host-browser.js
```

These use local fixture servers and write logs/profiles under the ignored
`.local/tests/` directory by default. Existing per-runner `*_LOGS` and `*_SCRATCH`
environment variables override output locations only. Build overrides have been
removed so a runner cannot accidentally test a stale SDK build.

The artifact HTTPS test explicitly skips unless `ARTIFACT_TLS_CERT` and
`ARTIFACT_TLS_KEY` name local certificate/key files. To run it, provide those
variables and trust the test certificate for that Node process with
`NODE_EXTRA_CA_CERTS`. Never commit the private key. The artifact browser runner
also requires `ARTIFACT_WEBDRIVER` and a Firefox profile that trusts the certificate;
it does not disable certificate validation. See its entrypoint in
`runtime/artifacts-browser.js` for the optional hostname/profile variables.

The proving-cache test skips unless `PCZT_PROVING_PARAMETERS` names a directory
containing the canonical Sapling parameters. After building, run it with:

```sh
PCZT_PROVING_PARAMETERS="$PWD/.cache/proving" node --test tests/wallet/proving.test.js
```

Documentation checks remain available as `npm run docs:typecheck`,
`npm run docs:check-recovery`, and `npm run docs:build`.

Advanced wallet runtime runners accept explicitly supplied runtime packages and proving
parameters through `WALLET_*` variables. Those optional runs are separate from the
self-contained Node suite and default OPFS bridge test; TLS runs also require
`WALLET_TLS_KEY` and `WALLET_TLS_CERT`.

Advanced signer runs read `bundle/tests/signer-fixture.json` from the supplied
native packet, or `WALLET_SIGNER_FIXTURE`; its original receipt hash is still required.
