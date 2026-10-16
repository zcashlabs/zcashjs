import type { AccountId, WalletClient } from "@zcashlabs/zcash.js";

declare const wallet: WalletClient;
declare const accountId: AccountId;
const request = {
  format: 'unified', transparent: 'omit', sapling: 'omit', ironwood: 'require',
} as const;

const existing = await wallet.addresses.current({ accountId, request });
const address = existing ?? (await wallet.addresses.next({ accountId, request })).address;
// Display only in the application's intended receive UI; do not log.
