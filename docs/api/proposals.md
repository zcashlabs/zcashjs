# Review a proposal before execution

A proposal binds the selected inputs, outputs, fees, and consensus context. Review every step: one payment operation can require several transactions.

Endpoint-created wallets use the Ironwood-only policy described in
[Open a wallet](wallet-runtime.md). To select different pools or transaction
limits, supply a complete `transactionPolicy` when opening the wallet:

```ts
import { createWalletClient } from '@zcashlabs/zcash.js';
import type { TransactionPolicy, WalletStorage } from '@zcashlabs/zcash.js';

export function openWithPolicy(endpoint: string, storage: WalletStorage, transactionPolicy: TransactionPolicy) {
  return createWalletClient(endpoint, { network: 'testnet', storage, transactionPolicy });
}
```

The policy's confirmation requirements also apply to balance queries unless
explicitly supplied separately; conflicting confirmation requirements reject.

```ts
import { parseZec } from '@zcashlabs/zcash.js';
import type { AccountRecord, Proposal, WalletClient } from '@zcashlabs/zcash.js';

export async function reviewedSend(
  wallet: WalletClient,
  account: AccountRecord,
  recipient: string,
  requestId: string,
  approve: (proposal: Proposal) => Promise<boolean>,
) {
  const proposal = await wallet.propose({
    accountId: account.id, to: recipient, amount: parseZec('0.00125'),
    idempotencyKey: requestId,
  });
  if (!await approve(proposal)) {
    await wallet.operations.abandon({ operationId: proposal.operationId });
    return null;
  }
  return wallet.send({ proposal });
}
```

Show recipients, amounts, input pools, changes, total fee, expiry, and dependencies. Keep the SDK-returned proposal intact. Passing `{ proposal }` executes that reviewed proposal; do not combine it with a new amount or recipient. SDK handles are bound to their owning wallet and cannot be reconstructed by parsing saved JSON.

`operations.abandon` retires an unbuilt proposal and releases its proposal locks. Once artifacts or finalized transactions exist, it can reject. Abandoning an operation is not a way to undo broadcast.

For external signing, `build({ proposal })` creates a PCZT artifact. The next chapter explains signing and explicit local finalization.
