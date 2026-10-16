import { accountIndex } from "@zcashlabs/zcash.js";
import type { Birthday, SecretInput, WalletClient } from "@zcashlabs/zcash.js";

declare const wallet: WalletClient;
declare const mnemonic: SecretInput; // supplied by application BIP39 tooling
declare const birthday: Birthday;
declare const recoveredIndex: number;
declare const ufvk: string; // synthetic test fixture, never a real key

// Mnemonic create/import uses all supported pools; spend/address policy is separate.
// Alternative onboarding paths for distinct fixture accounts, not duplicate imports.
export async function recoverMnemonic() {
  return wallet.accounts.import({
    mnemonic, accountIndex: accountIndex(recoveredIndex), birthday,
  }); // caller owns and must dispose the returned signer
}
export async function importViewing() {
  return wallet.accounts.import({ viewingKey: ufvk, birthday, viewOnly: false });
}
export async function createNew() {
  const synced = await wallet.sync(); // explicit network work, including for an empty wallet
  if (!synced.targetReached) return; // stopped before establishing current local state
  return wallet.accounts.create({ mnemonic }); // local state only; may fail SYNC_REQUIRED
}
