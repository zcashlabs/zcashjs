# Security and privacy

::: tip Proposed Contract
Keep spending secrets out of wallet SQLite and ordinary backups. Treat viewing keys, history, addresses, memos, PCZTs and operation records as sensitive even when they cannot spend funds.
:::

## Data paths

Applications own mnemonic generation, backup and input collection. Supplied secret bytes are copied into the authority domain; memory signers expose only opaque authority. Best-effort clearing cannot erase every JS copy, string, garbage-collected allocation or crash artifact. WASM and workers are not secure enclaves and cannot defend against malicious application code in the same trust domain.

Wallet storage includes viewing authority, recovery metadata and financial history. Node filesystem storage supports [authenticated at-rest encryption](wallet-runtime.md#encrypt-storage-at-rest) with a key the application supplies; without that key, or with OPFS, the files are plaintext. No persistent spending-secret vault is established. Exporting a UFVK/UIVK requires explicit disclosure acknowledgment; outgoing recovery is limited by key policy and available transaction data.

## Network disclosure

Public address/UTXO requests reveal addresses and their grouping. Transaction fetches reveal interest in a txid. Sync ranges/timing reveal activity patterns. Broadcast links a connection with transaction bytes. A proxy adds an observer; tokens correlate requests. No viewing or spending keys should be sent just to obtain chain data. No automatic provider failover or remote proving fallback may broaden disclosure.

Default unified receive addresses link all available supported receivers and allow transparent receipt. Shielded-only requests are explicit. Shielding cannot erase already public history. External PCZT handoff must minimize disclosed metadata while retaining enough for qualified independent review; returned effects and authorization are revalidated in Rust.

## Application responsibilities

Pin the canonical artifact manifest digest through trusted application configuration and verify the complete executable closure before execution as required by [H1.1](host-contract.md#h1-1-negotiation-before-authority), choose endpoint and storage policy, keep credentials out of browser bundles and diagnostics, and protect the application against injected code. Parameter caches are integrity-checked on every retrieval. Runtime entropy must fail closed when unavailable; mnemonic generation remains outside zcash.js.

::: info Requires Qualification
Protocol validation, timing behavior, RNG wiring, asset integrity, storage recovery, redaction and signer review require dedicated security/functional evidence. Source timing caveats are not resolved by compiling to WASM. This documentation is not a security audit.
:::

For issue reports use synthetic fixtures only. Never include real endpoints with credentials, addresses, txids, keys, wallet/operation identifiers, database backups, PCZTs, raw transaction bytes or sensitive logs. Follow the [contribution privacy policy](../contributing.md).

Endpoint construction defaults to offline recovery. In component construction, omitting `recovery` selects online recovery when a light client is present; this discloses recorded transaction queries to that endpoint. Select `recovery: { mode: 'offline' }` to prevent recovery network requests. Startup rebroadcast is separately opt-in and binds stored consent to exact bytes and route identity, with durable retry limits. No startup path requests secrets, signer authorization or proving material. See [recovery consent](operations.md#choose-startup-network-behavior).
