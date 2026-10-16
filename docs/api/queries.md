# Balances, history, and inventory

Wallet queries describe the local database at its scan state. Sync first when your UI needs current chain data.

```ts
import { formatZec } from '@zcashlabs/zcash.js';
import type { AccountRecord, WalletClient } from '@zcashlabs/zcash.js';

export async function accountOverview(wallet: WalletClient, account: AccountRecord) {
  const balance = await wallet.getBalance({ accountId: account.id });
  const history = await wallet.getHistory({ accountId: account.id, limit: 50 });
  return {
    totalZec: balance.amounts === null ? null : formatZec(balance.amounts.total),
    scan: balance.scan,
    history,
  };
}
```

A `null` amount means unavailable accounting, not zero. Pool balances distinguish spendable, locked, pending, and uneconomic amounts. A total balance is not a promise that every amount is eligible for the next proposal.

## Read all history pages

```ts
import type { AccountRecord, HistoryEntry, WalletClient } from '@zcashlabs/zcash.js';

export async function history(wallet: WalletClient, account: AccountRecord) {
  const entries: HistoryEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await wallet.getHistory({
      accountId: account.id, limit: 200, ...(cursor ? { cursor } : {}),
    });
    entries.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return entries;
}
```

The default page size is 50; the maximum is 200. Cursors are opaque. If a changing database invalidates a cursor, restart the listing after `CURSOR_STALE` rather than editing the token.

`wallet.getTransaction({ txid })` reads a wallet-wide transaction. `listNotes({ accountId, pool })` and `listUtxos({ accountId })` inspect inventory; `spendState: 'unspent'` is an inventory filter, not a complete spendability check. Proposal selection applies the actual spending policy.
