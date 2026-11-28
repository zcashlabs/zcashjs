import type { AccountRecord, SignerSelector } from '../types.js';
import type { attachWalletWorker } from './host.js';
import { failure } from '../errors.js';
import { sha256Hex } from '../hash.js';

/** Lookup hint only; callers still verify the returned key against the native account. */
export async function signerSelector(
  session: ReturnType<typeof attachWalletWorker>,
  account: AccountRecord,
  signal?: AbortSignal,
): Promise<SignerSelector> {
  if (account.accountIndex !== null) return { kind: 'derived', accountIndex: account.accountIndex };
  const key = await session.accounts.viewingKey({ accountId: account.id, ...(signal === undefined ? {} : { signal }) });
  if (key === null) {
    throw failure(
      'SIGNER_CAPABILITY_MISMATCH',
      'account',
      'reattach-signer',
      'Account has no full viewing key for signer lookup.',
    );
  }
  if (typeof key !== 'string' || !key.length || key.length > 4096) {
    throw failure(
      'PROTOCOL_MISMATCH',
      'account',
      'reopen',
      'Invalid native viewing key.',
    );
  }
  const bytes = new TextEncoder().encode(key);
  return {
    kind: 'fingerprint',
    fingerprint: await sha256Hex(bytes),
  };
}
