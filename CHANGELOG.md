# Changelog

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
