# Changelog

## Unreleased

### Added
- React Native support with the same API, through the companion package
  `@zcashlabs/zcash.js-native`. The Zakura core runs as a native library (iOS
  XCFramework, Android `arm64-v8a`/`x86_64`) instead of WebAssembly.
- `native-filesystem` wallet storage on React Native, with optional at-rest
  encryption in the Node format.
- `nativeProving` and `downloadProvingParameters` for proving parameters read and
  verified by the native library.
- `transportOptions.fetch` to supply a `fetch` implementation (for example a
  streaming `fetch` on React Native).

### Changed
- JSON-RPC parsing no longer requires `JSON.parse` reviver `context.source`; an
  equivalent strict parser is used when the engine lacks it.
- Cancellation and hashing no longer require `AbortSignal.any` or WebCrypto.
- The native bindings were restructured into shared core, WebAssembly and native
  crates. Behavior is unchanged, and a native/WebAssembly parity suite checks this.

## 0.1.4

- Native components are built from zakura-wasm-bindings v0.1.4, which no longer patches any
  upstream crate. Behaviour is unchanged.
- `PaymentState` now reports `lockExpiryHeight`, so apps can show when a signed but
  never-dispatched operation's inputs become spendable again (#36).
- The `mainnet` and `testnet` presets now include NU7 (mainnet 3543405, testnet 4465026),
  as version-2 network documents. Before this, preset wallets and light clients failed with
  `NETWORK_MISMATCH` against any server past NU7 activation (#30).
  **Breaking for stored wallets:** a database created with an earlier preset is bound to the
  old parameter bytes and now fails to open with `NETWORK_MISMATCH`. Such wallets cannot sync
  past NU7 anyway; restore them from the mnemonic with the new preset. To read one offline,
  open it with the old schedule passed explicitly through `encodeNetworkParameters` (no `Nu7`).
- `freshness: { mode: 'catch-up' }` now repeats `sync()` passes (up to 8, within
  `timeoutMs`) while each pass changes the wallet revision or the actionable enhancement
  count, instead of running exactly one. A finite `sync()` can reach its target with
  enhancement still outstanding, so `propose()`/`send()` right after a sync could fail with
  `SYNC_REQUIRED` and succeed on retry, which was common with NU7's 25 s blocks. A pass that
  changes nothing still ends with `SYNC_REQUIRED` (#35).

- Under Bun, a filesystem wallet whose worker died without an orderly close (crash,
  invalidation, runtime trap) can be reopened in the same process. Bun's
  `Worker.terminate()` leaves the worker's descriptors open, so the owner lease stayed held
  and reopening failed with `STORAGE_BUSY` until the process exited. Each wallet now records
  its descriptors in a shared ledger that the runtime reclaims after the worker has fully
  exited (native `zakura-wasm-bindings` v0.1.3) (#34).

## 0.1.3

- Idle wallets are much cheaper to keep synced (measured on a testnet wallet with 17
  transparent receivers: 21.6% → 2.6% CPU while watching):
  - `watchSync()` skips a full pass when the source tip is the block its last pass
    reached and the wallet revision is unchanged (one tip read and one local read per poll).
  - Standing unspent-address requests are answered once per target block instead of on
    every poll, and all due ones share one tip bracket and one `GetAddressUtxos` call
    (falling back to one request at a time if the combined inventory is too large).
  - The Node gRPC transport reuses one HTTP/2 channel across operations and closes it
    after 30 s idle, instead of a TCP+TLS handshake per request (~26 ms → ~5 ms CPU per
    unary call).
  One-off `sync()` calls still run full passes and answer every request.
- Target native `zakura-wasm-bindings` v0.1.2 from `jp4g/zakura-wasm-bindings`, with
  Node filesystem storage on macOS (`flock(2)` owner lease, `F_FULLFSYNC`) and Windows
  (exclusive-open owner lease under Node and Bun). CI runs the filesystem storage tests
  on macOS and Windows. The native runtime also gains ZIP-321 payment request parsing;
  the SDK does not expose payment request URIs yet.
- Accept lightwallet-protocol v0.6.0 servers alongside v0.5.0, so the documented
  `testnet.zec.rocks` endpoint no longer fails with `PROTOCOL_MISMATCH` (#28).
- Add an isolated native THS client with scoped tests and sandbox controls for
  local integration testing (#27).

- Add optional authenticated at-rest encryption for Node filesystem wallet
  storage (`storage.encryptionKey`), covering the database and rollback journal,
  with a new `STORAGE_KEY_MISMATCH` error for wrong or missing keys.
- `SYNC_REQUIRED` raised while refreshing the scan before submitting a finalized
  payment now always carries `operationId` and `paymentState`, so callers can see
  the signed transaction is retained and recover it with `broadcast` (#36).

## 0.1.2

- Add explicit `Nu7` custom network schedules using `zcash-js-network/2`,
  preserving version-1 bytes when `Nu7` is omitted (#23).
- Add regression coverage for legacy wallet/payment database reopen and browser
  OPFS persistence with both schedule formats. Changing an existing wallet's
  schedule still requires a new database; automatic schedule migration is not provided.
- Add THS NU7 Regtest checks for Ironwood/Sapling spending and saved-birthday
  recovery. Full-history recovery remains unqualified; the SDK remains experimental.
- Target native `zakura-wasm-bindings` v0.1.1 from `jp4g/zakura-wasm-bindings`.
- Update `@grpc/grpc-js` to 1.14.7 for GHSA-m9gg-hp2v-232j.

## 0.1.1

- Pin Node to 22.23.4 for the Brotli security update.
- Publish the public developer guide on GitHub Pages and update installation
  instructions and examples for 0.1.1 under the npm `latest` tag.
- The SDK remains experimental. This release adds no new transaction
  qualification.

## 0.1.0-rc.5

- Publish under `@zcashlabs/zcash.js`; update application imports to this scope.

- Build native components from the `zakura-wasm-bindings` v0.1.0 release.
  Runtime and proving assets remain bundled in npm; generated output stays out of Git.
- Add `getConsensusContext({ network, targetHeight })`, export the documented public types,
  and preserve actionable error codes with sanitized recovery guidance.

- Recognize Zaino's plain transaction ID in successful broadcast replies, while
  retaining lightwalletd's JSON-quoted format and exact transaction matching.

- Fix wallet sync missing funds sent to ordinary transparent receiving and
  change addresses by updating the bundled native wallet runtime (#14).

- Accept Zakura/Zaino's `test` label for configured Regtest light clients while
  retaining genesis and consensus checks. Normalize aliased tree states for
  native birthday resolution and wallet sync without changing address encoding.
  Network mismatch messages now identify the failed check without server values.

- Add `readGenesisHash(transport, { signal? })` for custom-network bootstrap
  using the existing HTTP transport, without application-written JSON-RPC.

- Rename the public `http` transport factory to `httpTransport`. Update imports
  and calls to the new name; transport options and behavior are unchanged.

## 0.1.0-rc.4 — wallet endpoint defaults

- `createWalletClient(endpoint, { network, storage })` configures network,
  light client, broadcaster, confirmations, observation and an Ironwood-only
  transaction policy. Storage remains explicit; startup recovery is offline.
- Complete option objects override defaults. The explicit component form keeps
  its offline/read-only configuration semantics.

## 0.1.0-rc.3 — built-in network and light-client defaults

- `defineNetwork()` defaults to mainnet; `defineNetwork('testnet')` selects the
  package-pinned testnet genesis and activation schedule. Full definitions still work.
- `await createLightClient(endpoint, { network: 'testnet' })` replaces application
  network/transport boilerplate. Endpoint-only calls default to mainnet. Network
  objects and transport options remain explicit overrides; handshake checks are unchanged.
- Existing `createLightClient({ network, transport })` stays synchronous.
- No new dependencies or runtime/proving assets. This version needs owner publication.

## 0.1.0-rc.2 — observation and enhancement fixes

- Payment observation distinguishes temporary tip lag from malformed or conflicting
  evidence. Finite reads retry at most three times with cancellable 250 ms spacing;
  payment events/wait continue polling through this narrowly classified condition
  without committing incoherent observations or resubmitting transactions (#176).
- Tip-dependent unspent enhancement remains pending when the source advances
  beyond the finite scan target or moves during inventory collection. Revision
  races replan normally; explicit historical targets and hash checks remain intact
  (#177). Continuous sync can fulfill deferred requests on a later scan.
- Historical database migration and full live-browser sending remain unqualified.
  This candidate requires owner publication; it does not change installed rc.1.

## 0.1.0-rc.1 — single-import release candidate

- Initial single-import release candidate.
- Wallet creation defaults to the included baseline WASM engine, worker and
  storage adapters. Runtime configuration is an optional advanced override.
- Canonical Sapling proving parameters are included and load only when needed.
  Ironwood execution does not require downloading those Sapling parameter files.
- Node reads package assets locally. Browser application bundlers emit lazy assets
  alongside application JavaScript; the root import does not start a wallet.
- Native builds verify locked dependencies, policy patches and tool identities;
  source-path normalization enables byte-identical builds across source/cache paths.
- Builds verify bundled asset hashes, license inventory, manifest pins and worker
  source correspondence. Normal `npm pack` runs those checks before packaging.
- Sync revalidates and replans after mid-run source-view changes and stale native
  revisions, with bounded retries and unchanged explicit targets (#172, #173).
- Explicit submission refreshes a scan left behind during proving without
  replacing finalized bytes or retrying broadcast (#174).
- Payment observation retries when the chain advances during its reads, while
  continuing to reject stable inconsistent evidence.

This prerelease is not fully release-qualified. Persistent Node storage is
Linux-only; historical wallet-database migration is unqualified. Browser reads,
funded Ironwood receipt, proving/signing and OPFS reopen passed, but the full live
browser send/receive round trip remains blocked by endpoint transaction lookup.
The Node test application uses concurrent scan/observe confirmation. The owner
controls npm publication under the `next` tag; release tracking is in issue #165.
