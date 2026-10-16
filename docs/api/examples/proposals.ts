import { waitForConfirmation } from './confirmation.js';
import type { AccountId, ProposedOutput, Proposal, Signer, WalletClient } from "@zcashlabs/zcash.js";

declare const wallet: WalletClient;
declare const accountId: AccountId;
declare const signer: Signer;
declare const recipient: string;
declare function review(proposal: Proposal): Promise<boolean>;

const proposal = await wallet.propose({ accountId, to: recipient, amount: 125_000n });
if (await review(proposal)) {
  const pending = await wallet.send({ proposal, signer });
  await waitForConfirmation(wallet, pending);
} else {
  await wallet.operations.abandon({ operationId: proposal.operationId });
}

// Proposal recipients are always exact; internal addresses may be selected at build time.
function displayedAddress(output: ProposedOutput): string {
  if (output.kind === "payment") return output.address;
  return output.address ?? "Wallet-owned address assigned during construction";
}
void displayedAddress;

// @ts-expect-error Payment destinations cannot be unresolved.
const invalidRecipient: ProposedOutput = { kind: "payment", address: null, accountId: null, pool: "sapling", amount: 1n, memo: null };
void invalidRecipient;
