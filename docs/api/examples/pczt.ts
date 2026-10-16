import { waitForConfirmation } from './confirmation.js';
import type { PcztArtifact, ReviewedOutput, WalletClient } from "@zcashlabs/zcash.js";

declare const wallet: WalletClient;
declare const prepared: PcztArtifact; // single-step, required proofs already satisfied
// Application-owned reviewed exchange; qualified for this artifact's role state.
declare function reviewBuiltOutputs(outputs: readonly ReviewedOutput[]): Promise<boolean>;
declare function exchangeWithSigner(bytes: Uint8Array): Promise<Uint8Array>;

if (await reviewBuiltOutputs(prepared.outputs)) {
  const exchange = await wallet.pczt.export({ pczt: prepared });
  const returned = await exchangeWithSigner(exchange.bytes);
  const authorized = await wallet.pczt.import({
    operationId: exchange.operationId, bytes: returned,
  });
  if (authorized.proofsComplete && authorized.authorizationComplete) {
    const pending = await wallet.finalize({ pczt: authorized }); // stores, no network
    await pending.broadcast(); // explicit dispatch of stored bytes
    await waitForConfirmation(wallet, pending);
  }
}
