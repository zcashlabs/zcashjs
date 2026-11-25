# Private viewing account/address candidate

This is real backend code on the existing worker-local WalletDb, not a public WalletClient or root SDK factory. Acceptance is pending independent HIGH review and final storage/host integration. The original base is `dbd67c0`; the authorized correction incorporates the necessary accepted storage prerequisites. No upstream crate is patched (#46).

## View-only policy and storage integration

The express owner authorization supersedes the historical VIEW hold. This worktree
incorporates the necessary merged storage PR3 source from `c44bded`, including exact
schema admission and Node hardlink ownership checks. The viewing extension is
explicitly admitted by exact object definitions and initialized on the same owned
connection after native migrations. Independent review and integration remain the
coordinator's responsibility.

The view-only policy lives in `src/wallet/view_only.rs` and uses only public upstream
APIs; upstream `zakura-client-{backend,sqlite}` are used unmodified.

After every scan (`put_blocks` or the threaded `scan_cached_blocks`), in the same
transaction, the bindings remove the witness mark of every note owned by a true
view-only account, immediately rather than as of a checkpoint. View-only notes keep
viewing/history data (including nullifiers and positions); block checkpoints remain
shared chain state. Omitted/false imports keep normal marked retention.
`commitment_tree_position` is unique per pool, so a mark belongs to exactly one account.

Proposals (`proposal_create`, transfer or shielding) for a true view-only account are
refused with `INSUFFICIENT_FUNDS` or `NOTHING_TO_SHIELD`, the outcome of an account with
nothing spendable, so no view-only input is ever selected. UFVK possession is not signer
possession; no signer attachment or implicit upgrade is introduced. Upstream storage
itself does not know the policy: code that calls upstream selection APIs directly,
rather than through the bindings, must apply it too.

`account_balance` reports a true view-only account's spendable and locked value as
pending spendability; totals and uneconomic value are unchanged. Upstream counts a note
as locked only when it is otherwise spendable, and a spendable note is never pending
change, so this matches classifying the note as unspendable. That bucket name does not
imply automatic future upgrade. Omitted/false classification is unchanged.

Extension version 2 migrates populated pre-policy wallets after native migrations and
before the wallet is exposed: one transaction removes view-only marks and updates the
version. Failure rolls back both; reopening retries version 1, and version 2 opens are
idempotent. Deferred checkpoint-removal records and upstream stabilization flags are
left as they are: the mark they refer to is already removed, and spendability is
governed by the rules above. This is logical removal of per-note spend support, not
physical media erasure or removal of shared commitment data. Later spending still
requires explicit recovery/upgrade.

## Private interface

```js
const owner = await initializeViews(wasmBytes, actualWorkerBackend,
  'zcash-js-network/1', parameterBytes, genesisBytes);
const account = owner.call(owner.generation, owner.instance, 'account_import', {
  viewingKey: applicationUfvk,
  birthday: {
    parameters: parameterBytes, genesis: genesisBytes,
    firstScanHeight, priorTreeState: pinnedTreeStateProtobufBytes,
    source: 'checkpoint', recoverUntilExclusive,
  },
});
const address = owner.call(owner.generation, owner.instance, 'address_next', {
  accountId: account.id,
});
owner.close(owner.generation, owner.instance);
```

The owner privately retains the one actual `initializeStorage` result, and imports the same `bindings.js`. No caller wallet handle, mutable wallet-state copy, duplicate WASM instance, signer registry or fake JS database is admitted. Every call uses the actual storage generation/instance guard before the native method. Native borrow/lifecycle guards repeat generation checks. A trapped owner is invalidated and must be destroyed; close failures retain ownership according to the inherited storage policy.

`call` supports `account_import`, `account_list`, `account_get`, `address_current`, `address_next`, `address_list`, and `address_at`. Argument fields follow the frozen account/address subset, with this private birthday lowering replacing the public Network object by exact registered parameter/genesis bytes. `birthday: 'fullScan'` explicitly starts at block 1 with the registered genesis and empty pre-scan trees, without a recovery boundary. Imports never silently substitute the current tip. Indices are exactly 88-bit bigint in JS; the internal JSON lowering uses canonical decimal strings. Returned records contain fresh bigint indices. No mnemonic, account-create, signer, recovery runner, send, proving or PCZT API exists.

The caller may supply an actual worker-local AbortSignal in `args.signal`. Pre-call abort reports `ABORTED` with `commit: none`; an abort observed after a successful native write reports `commit: committed`. A synchronous WASM call cannot process a second worker message while running. The tests exercise an abort at a real storage callback; they do not establish cross-worker interrupt/preemption or operation-ID recovery after a lost reply.

## Native policy and durable state

- Native UUIDs identify accounts across reopen; no list positions or account indices are identifiers. UFVK import defaults to spending-purpose tracking with no secret or signer. True view-only persists native tracking policy. UIVK wallet import rejects. A later signer could not implicitly upgrade this policy; no signer API is present.
- Enabled pools default to all three and require actual transparent/Sapling/Orchard-encoded Ironwood key components and configured activation heights. Subset projection uses the actual upstream UFVK container codec and preserves the original separately. Any overlapping registered component rejects before upstream's capability-upgrade import path. Unknown components reject.
- A projection containing only transparent authority cannot be represented as a valid UFVK by this backend and rejects `UNSUPPORTED_POOL_PROJECTION`. Transparent **addresses** from shielded-capable accounts are supported. This limit is not a fabricated transparent-only account path.
- Birthday bytes are decoded with pinned upstream prost TreeState, including separate legacy Orchard and Ironwood fields. Canonical protobuf and native tree reserialization reject ignored/unknown/duplicate/trailing data. Network, exact prior height, genesis at height zero, recovery boundary, complete active frontiers and empty pre-activation trees are checked. Same-height retained checkpoints must agree in hash and all frontiers. This validates supplied checkpoint coherence, not provider authenticity or proof of chain ancestry; the enclosing host authenticates network/checkpoint registration.
- `next` and exact-index `at` validate and commit native exposure before returning. Reads regenerate stored receivers against the actual registered key and index. `current` does not allocate and rechecks actual receiver requirements rather than trusting cached flags alone. Transparent-only exposure is retained in an extension record and verified against native external-scope exposure/derivation; its current value is the most recent explicitly recorded transparent-only exposure.
- Transparent allocations respect the native default discovery gap, using the real transactional gap query. Imports whose mandatory native default UA would fall beyond that gap reject before mutation. Exact-index requests never search or fall back; index reuse with different receivers rejects. No new discovery-range policy is invented.
- This account/address subset does not scan, spend or route legacy Orchard. Historical authority in an Orchard-encoded component is not a deployed Ironwood activation claim. Synthetic regtest heights in tests are not deployed network parameters.

## Qualification and retained limitations

Native tests use actual SQLite/WalletDb transactions and synthetic upstream-derived keys/tree vectors. Real WASM is built with offline locked Cargo and the approved wasm-bindgen 0.2.128 executable. Node tests use actual filesystem storage in destroyed/reopened workers, including write/commit/entropy failures and pre/post abort checks. Browser tests run an ordinary page module and dedicated-worker OPFS; the Firefox runner requires observed BiDi worker destruction before reopening. The coordinator must run it if this worker's loopback socket is denied, with unchanged browser security policy.

The producer source graph remains the base's Common 1.0.0 package family, `zakura-client-{backend,sqlite} 0.1.0-rc4`, and `zcash_protocol 0.10.6`; it does not substitute a distinct upstream `zcash_client_sqlite 0.18.12` package or Common 1.1.0. Exact archive/source inventories, inherited provenance and package versions are in the receipt. No package was installed or fetched. Fixture authority is **synthetic, never for production funds**; no user secret is included.

Inherited Common advisories remain open. Existing delivery evidence reports `RUSTSEC-2023-0089` (`atomic-polyfill@1.0.3`) coalesced across six qualification records; this work performs no new advisory scan and makes no clean-security claim. Encryption at rest, real browser quota exhaustion/eviction, power loss, full H1 negotiation/error/recovery envelopes, verified public loader integration, and final storage/host acceptance remain separate gates. No publication, push or merge is performed.

Fresh qualification and exact remaining limitations are recorded in the assigned
`native-policy-r2/REPORT.md` and raw command logs. Historical build04/05 and
parent Firefox evidence are retained evidence, not fresh qualification of these
changed bytes. No loader-provider review, bypass, push, merge or publication occurs.
