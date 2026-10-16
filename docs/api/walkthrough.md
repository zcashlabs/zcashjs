# Wallet walkthrough

This example imports an existing mnemonic account, scans it, issues a receive address, reviews a payment, and waits for confirmation. It uses the configuration described in [open a wallet](wallet-runtime.md).

Starting with a new wallet instead? Follow [create a new mnemonic account](accounts-signers.md#create-a-new-mnemonic-account) to generate and confirm a backup before receiving funds.

Before running it, supply a matching network, a functioning light source and broadcaster, and a mnemonic account with sufficient eligible funds. The package supplies the baseline wallet runtime and local proving material by default. `sync()` discovers funds; it does not create them. The example assumes derivation index zero and uses a full scan for explicit recovery.

```ts
import { accountIndex, createWalletClient, formatZec, parseZec } from '@zcashlabs/zcash.js';
import type { MemorySigner, PendingPayment, Proposal, SignerBinding, WalletClient, WalletOptions } from '@zcashlabs/zcash.js';

export async function walletWalkthrough(
  options: WalletOptions,
  mnemonic: Uint8Array,
  recipient: string,
  requestId: string,
  approve: (proposal: Proposal) => Promise<boolean>,
) {
  const wallet = await createWalletClient(options);
  let signer: MemorySigner | undefined;
  let binding: SignerBinding | undefined;
  try {
    const imported = await wallet.accounts.import({
      mnemonic, accountIndex: accountIndex(0), birthday: 'fullScan',
    });
    signer = imported.signer;
    const accountId = imported.account.id;
    binding = await wallet.accounts.attachSigner({ accountId, signer });
    if (binding.state !== 'ready') throw new Error('The account needs signer recovery');

    const synced = await wallet.sync();
    if (!synced.targetReached) throw new Error('Sync stopped before reaching its target');
    const received = await wallet.addresses.next({ accountId, request: { format: 'unified', transparent: 'omit', sapling: 'omit', ironwood: 'require' } });
    const balance = await wallet.getBalance({ accountId });
    if (balance.amounts === null) throw new Error('Balance is not available yet');

    const proposal = await wallet.propose({
      accountId, to: recipient, amount: parseZec('0.00125'), idempotencyKey: requestId,
    });
    if (!await approve(proposal)) {
      await wallet.operations.abandon({ operationId: proposal.operationId });
      return { receiveAddress: received.address, totalZec: formatZec(balance.amounts.total), sent: false };
    }
    const pending = await wallet.send({ proposal });
    const confirmation = await waitForConfirmation(wallet, pending);
    return { receiveAddress: received.address, confirmation, sent: true };
  } finally {
    try { await binding?.dispose(); }
    finally {
      try { await wallet.close(); }
      finally { await signer?.dispose(); }
    }
  }
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

The confirmation helper runs scanning and payment observation together, propagates failure from either, and cancels and drains both before the wallet closes. It uses the lifecycle tested in the [runnable testnet example](https://github.com/zcashlabs/zcashjs/blob/main/examples/testnet/confirmation.js). The fifteen-minute deadline belongs to `pending.wait()`, preserving its operation ID and payment state on timeout. A timeout stops waiting; it does not cancel the payment.

The application owns the mnemonic bytes and should clear them when its input flow no longer needs them. `approve` is your review UI: show every recipient, amount, fee, pool, expiry, and transaction step, and resolve only after the user's decision.

If the function rejects after a send starts, do not rerun it with a new request ID. Inspect the structured error, reopen the same database, and [discover/resume the recorded operation](operations.md). A restart flow should list existing accounts rather than blindly importing the account again.

This is a usage example, not a claim that every runtime, provider, or external signer combination has been exercised end to end. The default test suite covers native persistence and many boundary behaviors; complete custom-signer finalization and production deployment combinations need their own integration validation.
