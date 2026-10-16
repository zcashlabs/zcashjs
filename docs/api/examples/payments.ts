import { waitForConfirmation } from './confirmation.js';
import type { AccountId, Signer, WalletClient } from "@zcashlabs/zcash.js";

declare const wallet: WalletClient;
declare const accountId: AccountId;
declare const signer: Signer;
declare const recipient: string; // synthetic fixture destination

export async function sendPayment() {
  const pending = await wallet.send({ accountId, to: recipient, amount: 125_000n, signer });
  return waitForConfirmation(wallet, pending);
}
export async function shieldFunds() {
  // Open with the explicit allow-owned transparent policy in the shielding guide.
  const pending = await wallet.shield({ accountId, toPool: 'ironwood', signer });
  return pending.snapshot(); // inspect initial attempts, not a mining claim
}
