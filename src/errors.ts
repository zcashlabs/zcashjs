import type { ErrorInfo, SyncStatus, ZcashError, PaymentState } from './types.js';

// A local identity check never reads properties/getters from a foreign exception.
const errors = new WeakSet<object>();

export function isZcashError(value: unknown): value is ZcashError {
  return typeof value === 'object' && value !== null && errors.has(value);
}

/** Internal only: all messages are fixed SDK text, never foreign exception text. */
export function failure(
  code: ErrorInfo['code'],
  stage: ErrorInfo['stage'],
  recovery: ErrorInfo['recovery'],
  message: string,
  retryable = false,
  syncStatus?: SyncStatus,
  paymentState?: PaymentState,
  operationId: string | undefined = paymentState?.operationId,
): ZcashError {
  const error: ZcashError = Object.assign(new Error(message), {
    name: 'ZcashError',
    code,
    stage,
    recovery,
    retryable,
    ...(syncStatus === undefined ? {} : { syncStatus }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(paymentState === undefined ? {} : { paymentState }),
  });
  errors.add(error);
  return Object.freeze(error);
}

export function invalidArgument(): ZcashError {
  return failure('INVALID_ARGUMENT', 'validation', 'correct-input', 'Invalid argument.');
}

/** Read a native tag without invoking accessors; contain foreign proxy failures. */
export function errorTag(error: unknown): string | undefined {
  try {
    const tag = typeof error === 'string' ? error : Object.getOwnPropertyDescriptor(error, 'message')?.value;
    return typeof tag === 'string' ? tag : undefined;
  } catch {
    return undefined;
  }
}

const messages: Partial<Record<ErrorInfo['code'], string>> = {
  INVALID_ARGUMENT: 'Check the supplied values and options.',
  INVALID_MNEMONIC: 'Check the mnemonic words, word count and checksum.',
  ENTROPY_UNAVAILABLE: 'Secure randomness is unavailable; check the runtime before creating an account.',
  NETWORK_MISMATCH: 'Check the network and consensus context of the supplied data.',
  PROTOCOL_MISMATCH: 'The response or stored operation is inconsistent with the expected protocol.',
  METHOD_NOT_SUPPORTED: 'This operation is not supported by the configured backend.',
  UNSUPPORTED_POOL: 'A requested pool is unsupported or unavailable for this authority or consensus context.',
  UNSUPPORTED_VERSION: 'The data version or requested format is unsupported.',
  ACCOUNT_NOT_FOUND: 'The account does not exist in this wallet.',
  ACCOUNT_KEY_MISMATCH: 'The signing authority does not match the wallet account.',
  ACCOUNT_COLLISION: 'This account already exists in the wallet; use the existing account.',
  FULL_VIEWING_KEY_REQUIRED: 'This operation requires full viewing authority.',
  INCOMING_ONLY_WALLET_UNSUPPORTED: 'Wallet import requires a full viewing key; incoming-only keys are unsupported.',
  RECOVERY_REQUIRED: 'Resolve the retained wallet operation before starting another payment.',
  RECEIVER_UNAVAILABLE: 'The viewing authority lacks a requested receiver, or an address could not be derived.',
  ADDRESS_ALREADY_EXPOSED: 'This address index has already been exposed; choose an unused index.',
  DISCOVERY_RANGE_UNSAFE: 'The address request exceeds the supported discovery range.',
  SIGNER_CAPABILITY_MISMATCH: 'The signer cannot authorize the requested account, pool or operation.',
  SYNC_REQUIRED: 'Sync the wallet before continuing; retain any existing payment operation.',
  INSUFFICIENT_FUNDS: 'Eligible funds are insufficient for the requested payment and fee.',
  NOTHING_TO_SHIELD: 'No eligible transparent funds meet the shielding request.',
  FEE_LIMIT_EXCEEDED: 'The required fee exceeds the configured maximum; review the fee limit.',
  STALE_PROPOSAL: 'Wallet state changed; resolve the retained intent before reviewing a fresh proposal.',
  INPUT_LOCKED: 'An input is reserved by another operation; resolve that operation first.',
  IDEMPOTENCY_CONFLICT: 'The idempotency key belongs to a different payment intent.',
  PCZT_MULTI_STEP_UNSUPPORTED: 'This PCZT workflow does not support a multi-step proposal.',
  INVALID_PCZT: 'The PCZT is malformed or inconsistent with the expected transaction.',
  PCZT_ASSOCIATION_MISMATCH: 'The PCZT artifacts do not belong to the same transaction or wallet operation.',
  ROLE_PRECONDITION: 'The transaction has not completed the steps required for this role.',
  PROVING_MATERIAL_REQUIRED: 'Configure matching local proving assets before generating proofs.',
  ASSET_UNAVAILABLE: 'A required proving asset could not be loaded; check its configured location and availability.',
  ASSET_INTEGRITY: 'A proving asset failed validation; replace it with the expected verified asset.',
  PROOF_FAILED: 'Proof generation or verification failed; check the transaction and proving configuration.',
  NOT_FINALIZED: 'Finalize the transaction before submission.',
  OPERATION_NOT_FOUND: 'The wallet operation does not exist.',
  PAYMENT_BLOCKED: 'A payment dependency is not ready; inspect the retained operation.',
  TRANSACTION_EXPIRED: 'The transaction has expired; reconcile the retained operation before replacing it.',
  SUBMISSION_REJECTED: 'Submission was rejected; inspect the retained operation before taking further action.',
  SUBMISSION_UNKNOWN: 'Submission outcome is unknown; reconcile the existing transaction before retrying.',
  CURSOR_STALE: 'Wallet state changed; restart pagination or sync from a fresh state.',
  STORAGE_ERROR: 'Wallet storage failed; check its availability and integrity before reopening.',
  STORAGE_BUSY: 'Wallet storage is already in use; release the other owner before reopening.',
  STORAGE_QUOTA: 'Storage capacity or quota was exhausted; free space before reopening.',
  STORAGE_KEY_MISMATCH: 'Wallet storage cannot be opened with the supplied encryption key or setting.',
  MIGRATION_REQUIRED: 'Wallet schema initialization or migration failed; check runtime compatibility before reopening.',
  RUNTIME_UNAVAILABLE: 'The wallet or codec runtime failed; check its configuration and recovery action.',
  RESOURCE_LIMIT: 'The operation exceeds a resource limit; reduce the workload or adjust its configured budget.',
  STALE_HANDLE: 'The handle is no longer valid; reopen its owner or obtain a fresh handle.',
  CLOSED: 'The wallet or handle is closed.',
  ABORTED: 'The operation was aborted; inspect retained progress before retrying a write.',
};

/** Fixed local text only, including when reconstructing an error received from a worker. */
export function errorMessage(code: ErrorInfo['code']): string {
  return Object.hasOwn(messages, code) ? messages[code]! : 'SDK operation failed.';
}
