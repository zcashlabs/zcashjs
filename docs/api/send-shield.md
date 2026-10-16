# Send and shield funds

Before sending, fund and sync the account, then attach a ready signer (or pass one
explicitly). Endpoint-created wallets supply an Ironwood transaction policy,
bundled proving assets, and a submission route. For explicit component setup,
configure `transactionPolicy` and `broadcaster` yourself. See [Open a
wallet](wallet-runtime.md) for defaults and overrides.

## Send a payment

```ts
import { parseZec } from '@zcashlabs/zcash.js';
import type { AccountRecord, PendingPayment, WalletClient } from '@zcashlabs/zcash.js';

export async function sendPayment(
  wallet: WalletClient, account: AccountRecord, recipient: string, requestId: string,
) {
  const pending = await wallet.send({
    accountId: account.id,
    to: recipient,
    amount: parseZec('0.00125'),
    idempotencyKey: requestId,
  });
  return waitForConfirmation(wallet, pending);
}

async function waitForConfirmation(wallet: WalletClient, pending: PendingPayment) {
  const timeoutMs = 900_000;
  const stop = new AbortController();
  const signal = stop.signal;
  const watching = (async () => {
    for await (const _status of wallet.watchSync({ signal })) { /* Drain every status. */ }
    throw Error('Sync watcher ended before confirmation.');
  })();
  const waiting = pending.wait({ confirmations: 3, timeoutMs, signal });
  try {
    return await Promise.race([watching, waiting]);
  } finally {
    stop.abort();
    await Promise.allSettled([watching, waiting]);
  }
}
```

Assign a stable application request ID to one intended payment. Reuse that ID when recovering the same intent; generate a new ID only for a genuinely new payment. Conflicting reuse fails with `IDEMPOTENCY_CONFLICT`.

The helper above consumes `watchSync()` while waiting, then cancels and drains both tasks. `pending.wait()` owns the fifteen-minute deadline so a timeout preserves its operation ID and payment state. It follows the [tested testnet helper](https://github.com/zcashlabs/zcashjs/blob/main/examples/testnet/confirmation.js). `pending.wait()` alone observes payment state; it does not scan your wallet.

`send` plans, executes, and dispatches, then returns a `PendingPayment`. It does not mean the transaction is mined. `wait` returns confirmation for every required transaction step, or rejects with a timeout/error and any available payment state.

With a light client configured, explicit submission refreshes the wallet scan if
the observed chain tip has advanced during proving. It joins an existing scan
or starts one, then obtains fresh payment evidence before native submission
admission. This preserves the finalized transaction bytes; it does not rebuild,
re-sign, or retry a network submission. After three unsuccessful refreshes,
continued tip movement returns `SYNC_REQUIRED`; recover the same operation.
Automatic startup recovery does not initiate this scan refresh.

Keep `watchSync()` running and consume its statuses while waiting for confirmation.
Each observation attempts a coherent chain view up to three times. `events()` and
`wait()` keep polling when a mined transaction is temporarily ahead of the source’s
latest tip; other coherence failures return retryable `OBSERVATION_UNAVAILABLE`.
Stable inconsistent evidence remains `PROTOCOL_MISMATCH`. See
[observation and recovery](operations.md#unknown-submission-and-cancellation).

For interactive approval, use [reviewed proposals](proposals.md) so the user approves the exact proposal before execution.

## Shield transparent funds

Open the wallet with an explicit policy that admits owned transparent inputs.
This keeps shielded spending and change in Ironwood, matching the receive example:

```ts
import { createWalletClient, parseZec } from '@zcashlabs/zcash.js';
import type { WalletStorage } from '@zcashlabs/zcash.js';

export function openForShielding(endpoint: string, storage: WalletStorage) {
  return createWalletClient(endpoint, {
    network: 'testnet', storage,
    transactionPolicy: {
      spendPools: ['transparent', 'ironwood'], transparent: 'allow-owned', changePool: 'ironwood',
      feeRule: 'zip317-standard',
      confirmations: { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false },
      expiry: { kind: 'offset', blocks: 80 }, lockExpiryBlocks: 20,
      shieldingThreshold: parseZec('0.0001'),
      freshness: { mode: 'require-synced', maxLagBlocks: 0 },
    },
  });
}
```

Import or create the account, attach its signer, and fund an address issued with
`request: { format: 'transparent' }`. Sync before calling `shield` below, and close
the wallet when finished. The ordinary default policy disallows transparent
inputs and cannot be used for this recipe.

```ts
import { parseZec } from '@zcashlabs/zcash.js';
import type { AccountRecord, WalletClient } from '@zcashlabs/zcash.js';

export async function shield(wallet: WalletClient, account: AccountRecord, requestId: string) {
  const pending = await wallet.shield({
    accountId: account.id,
    toPool: 'ironwood',
    threshold: parseZec('0.001'),
    idempotencyKey: requestId,
  });
  return pending.snapshot();
}
```

Shielding selects eligible owned transparent funds under your policy. It can fail with `NOTHING_TO_SHIELD`; do not turn that into a successful zero-value payment. Policy and destination pools must match the capabilities of your network/runtime.

## If a send is interrupted

An abort stops local waiting where possible; it cannot undo a committed transaction or a network submission. Inspect `error.operationId` and `error.paymentState`, then use [operations and recovery](operations.md). Do not create a replacement payment merely because the first call timed out.
