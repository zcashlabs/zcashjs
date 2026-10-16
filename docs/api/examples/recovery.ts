// Compile-only specification: no SDK runtime or actual database is supplied.
import { createWalletClient } from "@zcashlabs/zcash.js";
import type { PaymentState, WalletOptions } from "@zcashlabs/zcash.js";

declare const options: WalletOptions; // same application-owned durable database
// No application operation-ID store or signer is needed to recover the inventory.
declare function render(state: PaymentState): void;
const reopened = await createWalletClient({ ...options, recovery: { mode: 'offline' } });
try {
  // Recovery already covered ALL records. This pagination only renders the UI.
  let cursor: string | undefined;
  do {
    const page = await reopened.operations.list({ ...(cursor ? { cursor } : {}), limit: 50 });
    for (const state of page.items) render(state);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  // A UI may select any listed operationId and use operations.resume to bind a handle.
  // Selection, missing authority and finalized bytes do not imply submission consent.
} finally {
  await reopened.close();
}
