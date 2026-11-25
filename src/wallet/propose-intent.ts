import { confirmationsPolicy } from '../options.js';
import type { Payment, Pool, SyncStatus, TransactionPolicy, WalletClient } from '../types.js';
import { snapshot, ownBytes } from '../clients/owned-plumbing.js';
import { operation } from '../clients/light-chain-reads.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';
import type { WalletProposals, NativeProposalIntent } from './proposals.js';
import type { WalletSync } from './sync.js';
const limit = () => failure('RESOURCE_LIMIT', 'proposal', 'configure', 'Proposal input exceeds its bound.');
function uint(value: number, positive = false) {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0)
    || value > 0xffff_ffff) throw invalidArgument();
  return value;
}
function text(value: string, maximum: number) {
  if (typeof value !== 'string' || !value.length) throw invalidArgument();
  if (value.length > maximum) throw limit();
  return value;
}
function money(value: bigint) {
  if (typeof value !== 'bigint' || value < 0n) throw invalidArgument();
  return value;
}
function list<T>(value: readonly T[], maximum: number, read: (value: T) => T, minimum = 1): T[] {
  try {
    if (!Array.isArray(value)) throw invalidArgument();
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < minimum) throw invalidArgument();
    if (length > maximum) throw limit();
    return Array.from({ length }, (_, i) => {
      const field = Object.getOwnPropertyDescriptor(value, String(i));
      if (!field || !Object.hasOwn(field, 'value')) throw invalidArgument();
      return read(field.value);
    });
  } catch (error) {
    throw isZcashError(error) ? error : invalidArgument();
  }
}
export function policyCopy(value: TransactionPolicy): TransactionPolicy {
  const input = snapshot(
    value,
    [
      'spendPools',
      'transparent',
      'changePool',
      'feeRule',
      'confirmations',
      'expiry',
      'lockExpiryBlocks',
      'shieldingThreshold',
      'freshness',
    ],
  );
  const pools = list(input.spendPools, 3, (pool) => {
    if (!['transparent', 'sapling', 'ironwood'].includes(pool)) throw invalidArgument();
    return pool;
  });
  if (new Set(pools).size !== pools.length
    || !['disallow', 'allow-owned'].includes(input.transparent)
    || !['sapling', 'ironwood'].includes(input.changePool)
    || input.feeRule !== 'zip317-standard') throw invalidArgument();
  const confirmations = confirmationsPolicy(input.confirmations);
  const expiry = snapshot(input.expiry, ['kind', 'blocks']);
  if (expiry.kind === 'offset') {
    uint(expiry.blocks, true);
  } else if (expiry.kind !== 'disabled' || Object.keys(expiry).length !== 1) {
    throw invalidArgument();
  }
  const freshness = snapshot(input.freshness, ['mode', 'maxLagBlocks', 'timeoutMs']);
  uint(freshness.maxLagBlocks);
  if (freshness.mode === 'catch-up') {
    uint(freshness.timeoutMs, true);
    if (freshness.timeoutMs > 0x7fff_ffff) throw invalidArgument();
  } else if (freshness.mode !== 'require-synced' || Object.hasOwn(freshness, 'timeoutMs')) throw invalidArgument();
  return {
    ...input,
    spendPools: pools as [Pool, ...Pool[]],
    confirmations,
    expiry,
    freshness,
    lockExpiryBlocks: uint(input.lockExpiryBlocks, true),
    shieldingThreshold: money(input.shieldingThreshold),
  };
}
function payment(value: Payment): { to: string; amount: bigint; memo?: Uint8Array } {
  const input = snapshot(value, ['to', 'amount', 'memo']);
  let memo: Uint8Array | undefined;
  if (input.memo !== undefined) {
    const field = snapshot(input.memo, ['text', 'bytes']);
    if (Object.keys(field).length !== 1) throw invalidArgument();
    if (Object.hasOwn(field, 'text')) {
      if (typeof field.text !== 'string') throw invalidArgument();
      if (field.text.length > 512) throw limit();
      memo = new TextEncoder().encode(field.text);
      if (memo.length > 512) throw limit();
      if (new TextDecoder().decode(memo) !== field.text) throw invalidArgument();
    } else memo = ownBytes(field.bytes!, invalidArgument, limit, 512);
  }
  return { to: text(input.to, 2048), amount: money(input.amount), ...(memo === undefined ? {} : { memo }) };
}
const CATCH_UP_ROUNDS = 8;
function progressed(before: SyncStatus, after: SyncStatus) {
  return after.scan.revision !== before.scan.revision
    || after.enhancement.actionable !== before.enhancement.actionable;
}
function fresh(status: SyncStatus, maxLag: number) {
  const tip = status.scan.tipHeight,
    scanned = status.scan.fullyScannedHeight;
  return tip !== null && scanned !== null && status.scan.scanComplete === true && status.enhancement.actionable === 0
    && Math.max(tip, status.target?.height ?? tip) - scanned <= maxLag;
}

/** Exact public intent shape; caller supplies the configured policy and existing sync owner. */
export function walletPropose(
  proposals: WalletProposals,
  sync: Pick<WalletSync, 'getSyncStatus' | 'sync'>,
  policy: TransactionPolicy,
): WalletClient['propose'] {
  const configured = policyCopy(policy);
  return async (args) => {
    const input = snapshot(
      args,
      [
        'kind',
        'accountId',
        'to',
        'amount',
        'memo',
        'payments',
        'fromAddresses',
        'toPool',
        'threshold',
        'idempotencyKey',
        'maxFee',
        'signal',
      ],
    );
    text(input.accountId, 128);
    const common = {
      accountId: input.accountId,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: text(input.idempotencyKey, 256) }),
      ...(input.maxFee === undefined ? {} : { maxFee: money(input.maxFee) }),
    };
    const { freshness, shieldingThreshold, ...nativePolicy } = configured;
    let intent: NativeProposalIntent;
    if ('kind' in input) {
      if (input.kind !== 'shield'
        || ['to', 'amount', 'memo', 'payments'].some(key => Object.hasOwn(input, key))) throw invalidArgument();
      const pool = input.toPool ?? configured.changePool;
      if (!['sapling', 'ironwood'].includes(pool)) throw invalidArgument();
      intent = {
        ...common,
        kind: 'shield',
        policy: { ...nativePolicy, changePool: pool },
        threshold: money(input.threshold ?? shieldingThreshold),
        ...(input.fromAddresses === undefined
          ? {}
          : {
              fromAddresses: list(input.fromAddresses, 16, value => text(value, 2048), 0),
            }),
      };
    } else {
      if (['fromAddresses', 'toPool', 'threshold'].some(key => Object.hasOwn(input, key))) throw invalidArgument();
      const payments = 'payments' in input
        ? (['to', 'amount', 'memo'].some(key => Object.hasOwn(input, key))
            ? (() => {
                throw invalidArgument();
              })()
            : list(input.payments!, 16, value => value).map(payment))
        : [
            payment({
              to: input.to!,
              amount: input.amount!,
              ...(input.memo === undefined ? {} : { memo: input.memo }),
            }),
          ];
      intent = { ...common, policy: nativePolicy, payments };
    }
    const pending = operation(input.signal);
    let timer: ReturnType<typeof setTimeout> | undefined,
      timedOut = false;
    try {
      pending.check();
      if (intent.idempotencyKey !== undefined) {
        const retained = await proposals.lookup({
          ...intent,
          idempotencyKey: intent.idempotencyKey,
          signal: pending.signal,
        });
        pending.check();
        if (retained !== null) return retained;
      }
      if (freshness.mode === 'catch-up') {
        timer = setTimeout(() => {
          timedOut = true;
          pending.cancel();
        }, freshness.timeoutMs);
      }
      let status = await pending.wait(sync.getSyncStatus({ signal: pending.signal }));
      // A finite sync() can reach its target with enhancement still actionable, and a new
      // block can land meanwhile, so catch-up repeats passes while they make progress.
      for (let round = 0; freshness.mode === 'catch-up' && round < CATCH_UP_ROUNDS
        && !fresh(status, freshness.maxLagBlocks); round++) {
        const before = status;
        status = await pending.wait(sync.sync({ signal: pending.signal }));
        if (round > 0 && !progressed(before, status)) break;
      }
      pending.check();
      if (!fresh(status, freshness.maxLagBlocks)) {
        throw failure(
          'SYNC_REQUIRED',
          'proposal',
          'sync',
          'Wallet does not satisfy proposal freshness.',
        );
      }
      clearTimeout(timer);
      timer = undefined;
      return await proposals.create({ ...intent, revision: status.scan.revision, signal: pending.signal });
    } catch (error) {
      if (timedOut) throw failure('TIMEOUT', 'proposal', 'sync', 'Proposal catch-up deadline exceeded.');
      throw error;
    } finally {
      clearTimeout(timer);
      pending.close();
    }
  };
}
