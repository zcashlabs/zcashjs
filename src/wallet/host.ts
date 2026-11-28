import type {
  NativePcztBuildInput,
  NativeProposalInput,
  NativeProposalIntent,
  ProposalInventoryInput,
} from './proposals.js';
import type {
  PaymentInventoryInput,
  PaymentObserve,
  PaymentAttemptInput,
  PaymentAttemptFinish,
  NativeFusedInput,
  PaymentReconcile,
} from './payment-journal-types.js';
import type { AccountsApi, ConfirmationsPolicy, Op, ViewingImport, WalletAddressesApi, ZcashError } from '../types.js';
import type { WalletClient } from '../types.js';
import { errorMessage, failure, invalidArgument, isZcashError } from '../errors.js';
import { saplingAssets } from './proving-assets.js';
import { ownBytes, snapshot as fields } from '../clients/owned-plumbing.js';
import { prepareCommand } from './command-inputs.js';
import type { CopyBounds } from './command-inputs.js';
import type { WalletInput, WalletResult } from './commands.js';
import { operation } from '../clients/light-chain-reads.js';
import type { ScanTarget, ScanBatch, ScanRewind, ScanCompletion, Completion } from './session.js';
import type { EnhancementApply } from './session.js';
import type { WalletCommand, WalletReply } from './worker.js';
import { walletErrorCodes, mnemonicCommand, clearMnemonic } from './worker.js';
import type { MnemonicAccountInput, NativeCreatedAccount, NativeSignerAuthorization } from './session.js';
import { addListener, removeListener } from '../abort.js';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const add = addListener,
  remove = removeListener;
const signalOf = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const node = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === 'string';
const abortError = () => failure('ABORTED', 'runtime', 'none', 'Wallet operation aborted.');
const closedError = () => failure('CLOSED', 'runtime', 'none', 'Wallet is closed.');
const crashedError = () => failure('WORKER_CRASHED', 'runtime', 'reopen', 'Wallet worker failed.');
const limitError = () => failure('RESOURCE_LIMIT', 'runtime', 'configure', 'Wallet queue limit exceeded.');

/** Follow native cancellation, including suppressed/synthetic caller events. */
async function watch(signal: AbortSignal | undefined, cancel: () => void): Promise<() => void> {
  if (signal === undefined) return () => { };
  if (node) {
    const util = 'node:util',
      events = 'node:events';
    if ((await import(util)).types.isProxy(signal)) throw invalidArgument();
    const { addAbortListener } = await import(events);
    const view: AbortSignal = signalOf.call(new AbortController());
    Object.defineProperties(view, {
      aborted: { get: () => aborted.call(signal) },
      addEventListener: {
        value: (type: string, listener: EventListener, options: AddEventListenerOptions) =>
          add.call(signal, type, listener, { ...options, once: false }),
      },
      removeEventListener: { value: remove.bind(signal) },
    });
    const subscription = addAbortListener(view, () => {
      if (aborted.call(signal)) cancel();
    });
    if (aborted.call(signal)) cancel();
    return () => subscription[(Symbol as SymbolConstructor & { readonly dispose: symbol }).dispose]();
  }
  const pending = operation(signal);
  const dependent = pending.signal;
  add.call(dependent, 'abort', cancel);
  if (aborted.call(signal)) cancel();
  return () => {
    remove.call(dependent, 'abort', cancel);
    pending.close();
  };
}

/** Copy supported control values without invoking caller getters or cloning unbounded inputs. */
function snapshot(args: object, maximum: number, command: WalletCommand, pcztMaximum: number) {
  let size = 0;
  const copied: Uint8Array[] = [];
  let signal: AbortSignal | undefined;
  let maxDepth = 5;
  // Reserve both the queued owned input and its structured-clone transfer copy.
  const charge = (n: number) => {
    size += 2 * n;
    if (size > maximum) throw limitError();
  };
  const copy = (value: unknown, depth: number, bounds: CopyBounds = {}): unknown => {
    charge(8);
    if (depth > maxDepth) throw invalidArgument();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') {
      if (value < 0n || value >= (1n << 88n)) throw invalidArgument();
      charge(16);
      return value;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (typeof value === 'string') {
      charge(value.length * 2);
      return value;
    }
    if (typeof value !== 'object' || value === null) throw invalidArgument();
    if (ArrayBuffer.isView(value)) {
      const owned = ownBytes(
        value,
        invalidArgument,
        limitError,
        Math.min(bounds.bytes ?? 4 * 1024 * 1024, Math.floor((maximum - size) / 2)),
      );
      copied.push(owned);
      charge(owned.byteLength);
      return owned;
    }
    if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) throw invalidArgument();
    if (Array.isArray(value) && value.length > (bounds.items ?? 16)) throw invalidArgument();
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string') throw invalidArgument();
      charge(key.length * 2 + 8);
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !Object.hasOwn(property, 'value')) throw invalidArgument();
      if (depth === 0 && key === 'signal') {
        signal = property.value;
        if (signal !== undefined) {
          try {
            if (typeof aborted.call(signal) !== 'boolean') throw invalidArgument();
          } catch {
            throw invalidArgument();
          }
        }
      } else {
        const childBounds = Array.isArray(value) ? bounds.element : bounds.fields?.[key];
        Object.defineProperty(result, key, { value: copy(property.value, depth + 1, childBounds), enumerable: true });
      }
    }
    return result;
  };
  let value: unknown;
  try {
    const prepared = prepareCommand(command, args, pcztMaximum);
    maxDepth = prepared.maxDepth;
    value = copy(prepared.args, 0, prepared.bounds);
  } catch (error) {
    for (const bytes of copied) bytes.fill(0);
    if (isZcashError(error)) throw error;
    throw invalidArgument();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidArgument();
  // Each owned copy has a fresh, exactly sized backing store that only the queued job references.
  const transfer = command === 'scan_ingest_batch' ? copied.map(bytes => bytes.buffer as ArrayBuffer) : [];
  return { args: value, size, signal, transfer };
}

export interface WalletCompletion {
  readonly completion: Completion;
  /** Private reconciliation value after cancelled successful native work. Never diagnostic data. */
  readonly value?: unknown;
}

/** One admitted queue budget shared by every wallet port in a native owner. */
export interface WalletQueueBudget {
  jobs: number;
  bytes: number;
  active: boolean;
  wake: Set<() => void>;
  crash?: () => void;
  /** Native tokens never recycle; this owner issues at most 1024 over its lifetime. */
  signers?: Map<number, { release?: Promise<void> }>;
  proving?: { capacity: number; bytes: number; active: boolean };
}

/** Packaging supplies an initialized private port, worker destruction, and calls crashed() on worker loss. */
export function attachWalletWorker(port: MessagePort, destroy: () => Promise<void>,
  limits: { maxQueuedJobs: number; maxQueuedBytes: number; maxPcztBytes?: number }, shared?: WalletQueueBudget) {
  const { maxQueuedJobs, maxQueuedBytes, maxPcztBytes = 4 * 1024 * 1024 } = limits;
  if (![maxQueuedJobs, maxQueuedBytes, maxPcztBytes].every(
    n => Number.isSafeInteger(n) && n > 0,
  )) {
    throw invalidArgument();
  }
  type Job = {
    id: number;
    command: WalletCommand;
    args: object;
    size: number;
    transfer: ArrayBuffer[];
    ready: boolean;
    cancelled: boolean;
    cleanup: () => void;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  };
  const proving = shared?.proving ?? { capacity: 0, bytes: 0, active: false };
  const provingCleanup = new Set<() => Promise<void>>();
  const queue: Job[] = [],
    receipts = new WeakMap<object, WalletCompletion>();
  let active: Job | undefined,
    bytes = 0,
    nextId = 0,
    stopped = false;
  let closing: Promise<void> | undefined,
    destroyed: Promise<void> | undefined;
  const dispose = () => destroyed ??= Promise.resolve().then(destroy).finally(async () => {
    await Promise.all([...provingCleanup].map(cleanup => cleanup()));
    provingCleanup.clear();
    shared?.wake.delete(pump);
    port.onmessage = null;
    port.onmessageerror = null;
    port.close();
  });
  const reject = (job: Job, error: ZcashError, receipt: WalletCompletion) => {
    receipts.set(error, Object.freeze(receipt));
    job.reject(error);
  };
  const release = (job: Job) => {
    bytes -= job.size;
    if (mnemonicCommand(job.command)) clearMnemonic(job.args);
    if (shared) {
      if (job.command !== 'close') {
        shared.jobs--;
        shared.bytes -= job.size;
      }
      if (active === job) shared.active = false;
      queueMicrotask(() => {
        for (const wake of shared.wake) wake();
      });
    }
    try {
      job.cleanup();
    } catch { /* Do not replace completion. */ }
  };
  const crashed = () => {
    if (stopped) return;
    stopped = true;
    shared?.crash?.();
    if (active) {
      release(active);
      reject(active, crashedError(), { completion: 'unknown' });
      active = undefined;
    }
    for (const job of queue.splice(0)) {
      release(job);
      reject(job, crashedError(), { completion: 'none' });
    }
    void dispose().catch(() => { });
  };
  const pump = () => {
    if (active || stopped || shared?.active) return;
    const job = queue[0];
    if (!job?.ready) return;
    queue.shift();
    active = job;
    if (shared) shared.active = true;
    try {
      port.postMessage({ id: job.id, command: job.command, args: job.args }, job.transfer);
    } catch {
      crashed();
    }
  };
  const call = <C extends WalletCommand>(
    command: C,
    args: WalletInput<C>,
    close = false,
    cleanup = false,
  ): Promise<WalletResult<C>> => {
    if (stopped || (closing && !close)) {
      const error = closedError();
      receipts.set(error, { completion: 'none' });
      return Promise.reject(error);
    }
    let input: ReturnType<typeof snapshot> | undefined;
    try {
      // One fixed close control is reserved even when the work queue is full.
      input = close
        ? { args: {}, size: 0, signal: undefined, transfer: [] }
        : snapshot(args ?? {}, maxQueuedBytes, command, maxPcztBytes);
      if (input.signal && aborted.call(input.signal)) throw abortError();
      if (!close && !cleanup
        && (queue.length + (active ? 1 : 0) >= maxQueuedJobs
          || input.size > maxQueuedBytes - bytes)) throw limitError();
      if (!close && !cleanup && shared
        && (shared.jobs >= maxQueuedJobs || input.size > maxQueuedBytes - shared.bytes)) throw limitError();
      if (nextId >= Number.MAX_SAFE_INTEGER) throw limitError();
    } catch (error) {
      if (mnemonicCommand(command)) clearMnemonic(input?.args);
      if (error && typeof error === 'object') receipts.set(error, { completion: 'none' });
      return Promise.reject(error);
    }
    const admitted = input;
    return new Promise<WalletResult<C>>((resolve, rejectPromise) => {
      const job: Job = {
        id: ++nextId,
        command,
        args: admitted.args,
        size: admitted.size,
        transfer: admitted.transfer,
        ready: false,
        cancelled: false,
        cleanup: () => { },
        resolve: value => resolve(value as WalletResult<C>),
        reject: rejectPromise,
      };
      queue.push(job);
      bytes += job.size;
      if (shared && !close) {
        shared.jobs++;
        shared.bytes += job.size;
      }
      void watch(admitted.signal, () => {
        job.cancelled = true;
        const index = queue.indexOf(job);
        if (index >= 0) {
          queue.splice(index, 1);
          release(job);
          reject(job, abortError(), { completion: 'none' });
          pump();
        }
      }).then((cleanup) => {
        job.cleanup = cleanup;
        if (!queue.includes(job) && active !== job) {
          try {
            cleanup();
          } catch { /* Already settled. */ }
          return;
        }
        job.ready = true;
        pump();
      }, () => {
        const index = queue.indexOf(job);
        if (index >= 0) {
          queue.splice(index, 1);
          release(job);
          reject(job, invalidArgument(), { completion: 'none' });
          pump();
        }
      });
    });
  };
  port.onmessage = ({ data }: MessageEvent<WalletReply>) => {
    const job = active;
    if (!job || !data || data.id !== job.id || !['none', 'committed', 'unknown'].includes(data.completion)
      || typeof data.invalid !== 'boolean' || typeof data.outcome?.ok !== 'boolean') {
      crashed();
      return;
    }
    if (!data.outcome.ok) {
      const e = data.outcome.error;
      if (!e || !walletErrorCodes.has(e.code) || e.retryable !== false || typeof e.message !== 'string'

        || ![
          'validation',
          'storage',
          'runtime',
          'account',
          'address',
          'query',
          'sync',
          'authorization',
          'proposal',
          'proving',
          'finalization',
          'submission',
          'observation',
        ].includes(e.stage)

        || ![
          'reopen',
          'sync',
          'none',
          'correct-input',
          'configure',
          'review-new-proposal',
          'resume-operation',
          'reconcile-exact-bytes',
        ].includes(e.recovery)) {
        crashed();
        return;
      }
    } else if (data.invalid) {
      crashed();
      return;
    }
    if (data.outcome.ok && mnemonicCommand(job.command) && shared?.signers) {
      const token = (data.outcome.value as NativeCreatedAccount)?.signerToken;
      if (!Number.isInteger(token) || token <= 0 || token > 0xffff_ffff
        || shared.signers.has(token)
        || shared.signers.size >= 1024) {
        crashed();
        return;
      }
      shared.signers.set(token, {});
    }
    release(job);
    active = undefined;
    if (job.cancelled && data.outcome.ok) {
      reject(job, abortError(), { completion: data.completion, value: data.outcome.value });
    } else if (data.outcome.ok) job.resolve(data.outcome.value);
    else {
      const e = data.outcome.error;
      reject(
        job,
        failure(e.code, e.stage, e.recovery, errorMessage(e.code), false),
        { completion: data.completion },
      );
    }
    if (data.invalid) crashed();
    else pump();
  };
  port.onmessageerror = crashed;
  shared?.wake.add(pump);
  port.start();
  const submissions = new Set<string>();
  const reserveWorking = (bytes: number, cleanup: () => Promise<void>) => {
    if (stopped || closing) throw closedError();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || proving.bytes + bytes > proving.capacity) throw limitError();
    proving.bytes += bytes;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        proving.bytes -= bytes;
        provingCleanup.delete(close);
      }
    };
    const close = async () => {
      try {
        await cleanup();
      } finally {
        release();
      }
    };
    provingCleanup.add(close);
    return release;
  };
  return {
    reserveWorking,
    committed(error: object, value: unknown) {
      receipts.set(error, { completion: 'committed', value });
    },
    check() {
      if (stopped || closing) throw closedError();
    },
    fused: { send: (args: NativeFusedInput & Op) => call('fused_send', args) },
    payments: {
      abandon: (args: { operationId: string } & Op) => call('payment_abandon', args),
      start(operationId: string) {
        if (stopped || closing) throw closedError();
        if (submissions.has(operationId)) {
          throw failure(
            'STORAGE_BUSY',
            'submission',
            'none',
            'Submission is already active.',
          );
        }
        if (submissions.size >= maxQueuedJobs) throw limitError();
        submissions.add(operationId);
        return () => {
          submissions.delete(operationId);
        };
      },
      get: (args: { operationId: string } & Op) => call('payment_get', args),
      list: (args: PaymentInventoryInput & Op) => call('payment_list', args),
      reconcile: (args: PaymentReconcile & Op) => call('payment_reconcile', args),
      observe: (args: PaymentObserve & Op) => call('payment_observe', args),
      begin: (args: PaymentAttemptInput & Op) => call('payment_attempt_begin', args),
      finish: (args: PaymentAttemptFinish) => call('payment_attempt_finish', args),
      position: (args: { afterSequence: string } & Op) => call('payment_recovery_position', args),
    },
    pczt: {

      finalize: (
        args: { operationId: string; artifactId: string; spend: Uint8Array; output: Uint8Array } & Op,
      ) => call('pczt_finalize', args),
      finalized: (args: { operationId: string } & Op) => call('finalized_get', args),
      checkProvingAssets() {
        if (maxQueuedBytes < 2 * saplingAssets.reduce(
          (sum, value) => sum + value.byteLength,
          0,
        ) + 1024) {
          throw limitError();
        }
      },
      reserveProving: reserveWorking,
      startProof() {
        if (stopped || closing) throw closedError();
        if (proving.active) throw limitError();
        proving.active = true;
        let released = false;
        return () => {
          if (!released) {
            released = true;
            proving.active = false;
          }
        };
      },
      prove: (
        args: { operationId: string; artifactId: string; spend: Uint8Array; output: Uint8Array } & Op,
      ) => call('pczt_prove', args),
      get maximum() {
        return Math.min(maxPcztBytes, 4 * 1024 * 1024);
      },
      import: (args: { operationId: string; bytes: Uint8Array } & Op) => call('pczt_import', args),
      build: (args: NativePcztBuildInput & Op) => call('pczt_build', args),
      get: (args: { operationId: string; artifactId?: string } & Op) => call('pczt_get_artifact', args),
    },
    proposals: {
      lookup: (args: NativeProposalIntent & { idempotencyKey: string } & Op) => call('proposal_lookup_intent', args),
      create: (args: NativeProposalInput & Op) => call('proposal_create', args),
      get: (args: { operationId: string } & Op) => call('proposal_get', args),
      list: (args: ProposalInventoryInput & Op) => call('proposal_list', args),
    },
    mnemonic: {
      restore: (args: MnemonicAccountInput & Op) => call('account_restore_mnemonic_signer', args),
      create: (args: MnemonicAccountInput & Op) => call('account_create_mnemonic_signer', args),
      import: (args: MnemonicAccountInput & Op) => call('account_import_mnemonic_signer', args),
    },
    signers: {
      capabilities: (args: { token: number } & Op) => call('signer_capabilities', args),
      authorize: (args: NativeSignerAuthorization & Op) => call('signer_authorize', args),
      describe: (args: { token: number } & Op) => call('signer_describe', args),
      release: (args: { token: number }) => {
        const input = fields(args, ['token']);
        const issued = shared?.signers?.get(input.token);
        if (!issued) return Promise.reject(failure('STALE_HANDLE', 'account', 'none', 'Unknown signer authority.'));
        // One bounded cleanup control per genuinely issued token, even when work is full.
        return issued.release ??= call('signer_release', input, false, true);
      },
      bind: (args: { token: number; accountId: string } & Op) => call('signer_bind', args),
      unbind: (args: { token: number; accountId: string }) => call('signer_unbind', args),
    },
    accounts: {
      remove: (args: Parameters<AccountsApi['remove']>[0]) => call('account_remove', args),
      viewingKey: (args: { accountId: string } & Op) => call('account_viewing_key', args),
      checkKey: (args: { accountId: string; viewingKey: string } & Op) => call('account_check_key', args),
      import: (args: ViewingImport) => call('account_import', args),
      list: (args?: Op) => call('account_list', args),
      get: (args: Parameters<AccountsApi['get']>[0]) => call('account_get', args),
    },
    addresses: {
      current: (args: Parameters<WalletAddressesApi['current']>[0]) => call('address_current', args),
      next: (args: Parameters<WalletAddressesApi['next']>[0]) => call('address_next', args),
      list: (args: Parameters<WalletAddressesApi['list']>[0]) => call('address_list', args),
      at: (args: Parameters<WalletAddressesApi['at']>[0]) => call('address_at', args),
    },
    getBalance: (args: { accountId: string; confirmations: ConfirmationsPolicy } & Op) => call('account_balance', args),
    listNotes: (args: Parameters<WalletClient['listNotes']>[0]) => call('wallet_notes', args),
    listUtxos: (args: Parameters<WalletClient['listUtxos']>[0]) => call('wallet_utxos', args),
    getHistory: (args: Parameters<WalletClient['getHistory']>[0]) => call('wallet_history', args),
    getTransaction: (args: Parameters<WalletClient['getTransaction']>[0]) => call('wallet_transaction', args),
    scan: {
      state: (args?: Op) => call('scan_state', args),
      block: (args: { height: number } & Op) => call('scan_block_hash', args),
      rewind: (args: ScanRewind & Op) => call('scan_rewind', args),
      complete: (args: ScanCompletion & Op) => call('scan_complete', args),
      plan: (args: { target: ScanTarget } & Op) => call('scan_plan', args),
      ingest: (args: ScanBatch & Op) => call('scan_ingest_batch', args),
    },
    enhancement: {
      requests: (args?: Op) => call('enhancement_requests', args),
      apply: (args: EnhancementApply & Op) => call('enhancement_apply', args),
    },
    completion: (error: object) => receipts.get(error),
    crashed,
    close(): Promise<void> {
      closing ??= call('close', {}, true).then(async () => {
        stopped = true;
        await dispose();
      }, async (error) => {
        stopped = true;
        try {
          await dispose();
        } catch { /* Preserve the storage close failure. */ }
        throw error;
      });
      return closing;
    },
  };
}
