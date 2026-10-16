import { formatZec } from "@zcashlabs/zcash.js";
import type { AccountId, ScanState, WalletBalance, WalletClient } from "@zcashlabs/zcash.js";

declare const wallet: WalletClient;
declare const accountId: AccountId;
declare function showUnavailable(scan: ScanState): void;
declare function showBalance(totalZec: string, balance: WalletBalance): void;

const balance = await wallet.getBalance({ accountId });
if (balance.amounts === null) showUnavailable(balance.scan);
else showBalance(formatZec(balance.amounts.total), balance);
const history = await wallet.getHistory({ accountId, limit: 50 });
if (history.nextCursor !== null) {
  await wallet.getHistory({ accountId, limit: 50, cursor: history.nextCursor });
}
const first = history.items[0];
if (first) await wallet.getTransaction({ txid: first.txid });
await wallet.listNotes({ accountId }); // all known states
await wallet.listUtxos({ accountId, spendState: 'unspent' }); // not an eligibility verdict
