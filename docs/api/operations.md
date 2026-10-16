# Payment operations and restart recovery

A payment is a recorded operation, potentially containing multiple transaction steps. The database retains its state, exact finalized bytes, and submission attempts. A `PendingPayment` is a handle for interacting with that recorded operation.

## Reopen and discover work

Reopen the same database with the same network/runtime configuration. Wallet opening reconciles recorded operations; your application does not need a separate file of operation IDs to discover them.

```ts
import type { PaymentState, WalletClient } from '@zcashlabs/zcash.js';

export async function discoverPayments(wallet: WalletClient) {
  const operations: PaymentState[] = [];
  let cursor: string | undefined;
  do {
    const page = await wallet.operations.list({ limit: 200, ...(cursor ? { cursor } : {}) });
    operations.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { recovery: wallet.recovery, operations };
}

export async function resumePayment(wallet: WalletClient, operationId: string) {
  const pending = await wallet.operations.resume({ operationId });
  return pending.snapshot();
}
```

`resume` rehydrates behavior; it does not sign or broadcast. Inspect the snapshot before deciding whether to wait, request authorization, or explicitly broadcast retained bytes. An operation ID identifies recorded work, not permission to create a different transaction.

## Choose startup network behavior

| Policy | On open |
| --- | --- |
| `{ mode: 'offline' }` | Reconcile locally; no recovery network pass |
| `{ mode: 'online', timeoutMs: 15000 }` | Reconcile locally, then observe within a bounded pass |
| Online with `rebroadcast` | Additionally allow policy-limited retry of previously dispatched exact bytes |

Endpoint construction defaults to offline recovery. In component construction, omitting the policy selects online recovery with a 15-second deadline when `light` is present, otherwise offline. See the [wallet defaults](wallet-runtime.md#defaults). Online recovery needs a light client; rebroadcast additionally needs a broadcaster.

```ts
import type { RecoveryPolicy } from '@zcashlabs/zcash.js';

export const recovery: RecoveryPolicy = {
  mode: 'online',
  timeoutMs: 15_000,
  rebroadcast: {
    mode: 'previously-dispatched',
    maxAttempts: 2,
    minIntervalMs: 30_000,
  },
};
```

Automatic recovery does not grant first-dispatch consent, resume unfinished signing/proving, or turn an unbuilt proposal into a payment. Local recovery failure rejects opening. A failed or incomplete network pass can leave a usable local wallet; inspect `wallet.recovery.lastError` and its deferred-operation count.

## Unknown submission and cancellation

A source can accept a transaction while its response is lost. `unknown` is neither success nor rejection. Continue observing the recorded transaction or explicitly retry its retained bytes after reviewing state. Creating a fresh spend can produce a duplicate payment.

Independent source reads can briefly report a mined transaction ahead of their
latest-tip view. The wallet does not accept this as confirmation or absence.
Each observation makes at most three coherent-read attempts, spaced by 250 ms;
`events()` and `wait()` continue at the configured polling interval if the tip
still lags. The last coherent state is retained. Caller cancellation, wallet
closure and the `wait()` timeout remain effective; without a timeout, waiting
can continue until cancelled. Malformed evidence, source identity changes and
stable conflicting hashes still fail. No broadcast occurs in this polling path.

`pending.events()` observes changing state. `pending.wait({ confirmations, timeoutMs, signal })` observes every required step. Aborting or timing out a wait does not cancel a transaction, erase its attempts, or release its locks.

Memory storage has no restart recovery. Copying or rolling back database files is outside the SDK's backup/restore API; there is no public database backup/restore method. A mnemonic recovers account authority and scan history, not a lost database's operation journal.


## Closed-wallet backup on Linux

The supported same-candidate procedure below copies an **offline** Node wallet.
First stop application admission and await `wallet.close()` in every owner. Keep
other processes stopped throughout backup/restore. Use the same SDK/runtime and
network configuration to reopen the snapshot. Do not copy an active database.

Choose a private parent directory for snapshots. On Linux, these commands create
a fresh destination and hold the SDK's existing ownership lock during copying:

```sh
wallet=/absolute/path/to/my-wallet
backup=$(mktemp -d /private/backup-parent/zcash-backup.XXXXXX) &&
flock -n "$wallet/owner.lock" cp -a -- "$wallet/." "$backup/"
```

Check the command succeeds before treating the snapshot as complete. A lock
failure means an owner is still active; do not bypass it. Preserve the **entire**
directory, file permissions and journal files. `mktemp` gives each attempt its
own directory; discard a failed partial snapshot instead of using it.

For restoration, stop all owners and retire the original wallet. Copy the backup
to another fresh private directory and configure that directory as the wallet
path. Do not run the original and restored copies concurrently or independently.

```sh
restored=$(mktemp -d /private/wallet-parent/zcash-restored.XXXXXX) &&
cp -a -- "$backup/." "$restored/"
```

Check this copy succeeds, then open `restored` with the original network and
runtime configuration and offline recovery. Inspect `wallet.recovery` and the
operation journal before reconnecting. A stale snapshot lacks later operations
and address exposures: reconcile these before creating any new payment. A
snapshot is not permission to replay payments or roll back known chain activity.

The regression check verifies ownership exclusion, account/address retention
and the next address after a same-candidate restore. It does **not** qualify
older database migrations, every payment-journal state, macOS/Windows, OPFS
export, or encrypted backup storage. Preserve recovery material separately;
this procedure does not add a secret vault.
