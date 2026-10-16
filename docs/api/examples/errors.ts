import { isZcashError } from "@zcashlabs/zcash.js";
import type { ErrorCode, ErrorInfo, PaymentState, PendingPayment } from "@zcashlabs/zcash.js";

declare const pending: PendingPayment;
declare const signal: AbortSignal;
declare function showRecovery(code: ErrorCode, recovery: ErrorInfo['recovery']): void;
declare function retainPrivateState(state: PaymentState): void;

try {
  await pending.wait({ timeoutMs: 120_000, signal });
} catch (error: unknown) {
  if (!isZcashError(error)) throw error;
  showRecovery(error.code, error.recovery);
  if (error.paymentState) retainPrivateState(error.paymentState);
  // No blind retry, automatic logging or release of locks.
}
