# Private local creation snapshot

`account_create_hd` now accepts only `name` and `enabledPools`, plus the existing
owned seed parameter. It derives its birthday from a completed local snapshot
inside the same transaction that allocates the account. Import operations retain
their explicit birthday input. This does not provide a public memory signer.

Explicit sync first calls `scan_plan`, then completes through
`sync_call(generation, "scan_complete", {revision, target, treeState})`.
The native JSON uses protocol-order lowercase hex for `target.hash` and hex for
the canonical encoded TreeState; the JS facade accepts TreeState bytes. Completion
checks the current target/revision, native coverage, network and pool frontiers.
For scanned wallets, frontier roots must match native target checkpoints.

The single `ext_wallet_creation_snapshot` row persists the pending target and
completed TreeState. Opening an older DB creates an empty row, never a completed
snapshot. A newer target, scan ingestion or rewind invalidates completion;
historical targets cannot supersede a newer known target. New-account creation
returns `SYNC_REQUIRED` before allocation when state is unavailable or stale.
Historical completion checks retained block identity and native coverage without
requiring a pruned tree checkpoint, and never replaces the current creation row.

Host integration must pin the source target before recording completion. No
network operation occurs in the native creation path. Package schema/profile
pins and real Node/OPFS qualification must be updated before distributing this
changed private ABI; the previous runtime package remains a separate candidate.
