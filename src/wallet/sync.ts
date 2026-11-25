import { delay } from '../abort.js';
import { observationOptions } from '../options.js';
import { ObserverBuffer } from '../observer-buffer.js';
import type { ChainPoint, ErrorInfo, LightClient, ObservationOptions, Op, SyncStatus } from '../types.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';
import { operation } from '../clients/light-chain-reads.js';
import { blockHash } from '../primitives.js';
import type { attachWalletWorker } from './host.js';
import { applyEnhancement, applyUnspentBatch } from './enhancement.js';
import type { EnhancementRequest } from './session.js';

type Session = ReturnType<typeof attachWalletWorker>;
const reverse = (hash: string) => hash.match(/../g)!.reverse().join('');
const changedSource = new WeakSet<object>();
const sourceChanged = (check: string) => {
  const error = failure(
    'SYNC_REQUIRED', 'sync', 'sync', `Sync source changed at ${check}; retry a validated sync.`, true,
  );
  changedSource.add(error);
  return error;
};
const mismatch = () => failure(
  'PROTOCOL_MISMATCH',
  'sync',
  'sync',
  'Sync source changed or returned inconsistent blocks.',
);
const unavailable = () => failure(
  'OBSERVATION_UNAVAILABLE',
  'sync',
  'configure',
  'No light client is configured for wallet sync.',
);
const recovery = () => failure('RECOVERY_REQUIRED', 'sync', 'sync', 'No retained common checkpoint is available.');

type Subscriber = { push(status: SyncStatus): void; finish(error?: unknown): void };

/** Wallet-owned finite and shared continuous sync lifecycle. The enclosing wallet owns and closes the worker. */
export class WalletSync {
  private activity: SyncStatus['activity'] = 'idle';
  private target: ChainPoint | null = null;
  private reached = false;
  private lastError: ErrorInfo | null = null;
  private controller: AbortController | undefined;
  private running: Promise<SyncStatus> | undefined;
  private readonly subscribers = new Set<Subscriber>();
  private watching: Promise<void> | undefined;
  private watchController: AbortController | undefined;
  private readonly observation: ObservationOptions;
  /** Open-ended unspent-address polls already answered at a tip, keyed by request. */
  private readonly polled: PolledAddresses = new Map();
  /** Wallet revision right after the last pass that reached `target`; cleared by any new run. */
  private settledRevision: string | undefined;
  constructor(
    private readonly session: Session,
    private readonly light: LightClient | undefined,
    observation: ObservationOptions,
    private readonly scanBatchSize = 16,
  ) {
    if (!Number.isSafeInteger(scanBatchSize) || scanBatchSize < 1) throw invalidArgument();
    this.observation = observationOptions(observation);
  }

  watchSync(args: Op = {}): AsyncIterableIterator<SyncStatus> {
    let owned: Op;
    try {
      if (!args || ![Object.prototype, null].includes(Object.getPrototypeOf(args))
        || Reflect.ownKeys(args).some(key => key !== 'signal')) throw invalidArgument();
      const field = Object.getOwnPropertyDescriptor(args, 'signal');
      if (field && !Object.hasOwn(field, 'value')) throw invalidArgument();
      owned = field ? { signal: field.value } : {};
    } catch {
      throw invalidArgument();
    }
    const buffer = new ObserverBuffer<SyncStatus>(this.observation.maxBufferedUpdates,
      () => failure('RESOURCE_LIMIT', 'sync', 'configure', 'Sync observation buffer exceeded.'),
      () => failure('RESOURCE_LIMIT', 'sync', 'configure', 'Concurrent sync observation reads are unsupported.'));
    let started = false;
    let pending: ReturnType<typeof operation> | undefined;
    const subscriber: Subscriber = {
      push: (status) => {
        if (buffer.finished) return;
        try {
          buffer.push(structuredClone(status));
        } catch (error) {
          subscriber.finish(error);
        }
      },
      finish: (error) => {
        if (buffer.finished) return;
        buffer.close(error);
        pending?.close();
        this.subscribers.delete(subscriber);
        if (!this.subscribers.size) this.watchController?.abort();
      },
    };
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => buffer.next(async () => {
        if (started) return;
        started = true;
        try {
          // Native host admission checks arguments and caller signal before subscription.
          const initial = await this.getSyncStatus(owned);
          if (!this.light) throw unavailable();
          if (buffer.finished) return;
          pending = operation(
            owned.signal,
            () => subscriber.finish(failure('ABORTED', 'sync', 'none', 'Sync observation aborted.')),
          );
          pending.check();
          this.subscribers.add(subscriber);
          subscriber.push(initial);
          this.startWatching();
        } catch (error) {
          subscriber.finish(error);
          throw error;
        }
      }),
      return: async () => {
        subscriber.finish();
        if (!this.subscribers.size) await this.watching;
        return { done: true, value: undefined };
      },
    };
  }

  private publish(status: SyncStatus) {
    for (const subscriber of this.subscribers) subscriber.push(status);
  }

  private startWatching() {
    if (this.watching || !this.subscribers.size) return;
    const controller = new AbortController();
    this.watchController = controller;
    this.watching = (async () => {
      while (!controller.signal.aborted && this.subscribers.size) {
        try {
          // Waiting on an independently started finite run does not grant cancellation ownership.
          if (this.running) {
            const waiting = operation(controller.signal);
            try {
              await waiting.wait(this.running);
            } finally {
              waiting.close();
            }
          } else if (!await this.settled(controller.signal)) await this.sync({ signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted) break;
          if (!isZcashError(error) || !error.retryable || !['TRANSPORT_ERROR', 'TIMEOUT'].includes(error.code)) {
            for (const subscriber of this.subscribers) subscriber.finish(error);
          }
        }
        if (controller.signal.aborted || !this.subscribers.size) break;
        await delay(this.observation.pollIntervalMs, controller.signal);
      }
    })().finally(() => {
      this.watching = undefined;
      this.watchController = undefined;
      this.startWatching();
    });
  }

  /**
   * True when a watcher pass would find nothing new: the last pass reached its target,
   * the source tip is still that exact block, and no local write has happened since.
   * Costs one tip read and one local read instead of a full scan/enhancement pass.
   */
  private async settled(signal: AbortSignal): Promise<boolean> {
    const revision = this.settledRevision,
      target = this.target;
    if (revision === undefined || !this.reached || !target || !this.light) return false;
    try {
      const tip = await this.light.getTip({ signal });
      if (tip.height !== target.height || tip.hash !== target.hash) return false;
      const scan = await this.session.scan.state({ signal });
      return scan.revision === revision && this.settledRevision === revision;
    } catch {
      return false; // Let a full pass surface and classify the failure.
    }
  }

  async getSyncStatus(args: Op = {}): Promise<SyncStatus> {
    // Both reads are local. Equal revisions bind their projections to one database state.
    for (let attempt = 0; attempt < 3; attempt++) {
      const scan = await this.session.scan.state(args);
      const pending = await this.session.enhancement.requests(args);
      if (scan.revision !== pending.revision) continue;
      const delayed = pending.requests.filter(
        r => r.kind === 'address' && r.requestAt !== null && r.requestAt > Date.now(),
      ).length;
      return {
        activity: this.activity,
        scan,
        target: this.target,
        targetReached: this.reached,
        enhancement: { actionable: pending.requests.length - delayed, delayed },
        workEstimate: null,
        lastError: this.lastError,
      };
    }
    throw failure('STORAGE_BUSY', 'sync', 'none', 'Wallet changed during the status read.');
  }

  sync(args: { target?: ChainPoint } & Op = {}): Promise<SyncStatus> {
    if (this.running) return Promise.reject(failure('STORAGE_BUSY', 'sync', 'none', 'Wallet sync is already running.'));
    let target: ChainPoint | undefined,
      signal: AbortSignal | undefined;
    try {
      if (!args || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) throw invalidArgument();
      const input: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(args)) {
        if (key !== 'target' && key !== 'signal') throw invalidArgument();
        const field = Object.getOwnPropertyDescriptor(args, key)!;
        if (!Object.hasOwn(field, 'value')) throw invalidArgument();
        input[key] = field.value;
      }
      signal = input.signal as AbortSignal | undefined;
      if (input.target !== undefined) {
        const value = input.target as ChainPoint;
        const height = Object.getOwnPropertyDescriptor(value, 'height'),
          hash = Object.getOwnPropertyDescriptor(value, 'hash');
        if (!height || !hash || !Object.hasOwn(height, 'value') || !Object.hasOwn(hash, 'value')

          || Reflect.ownKeys(value).length !== 2
          || !Number.isInteger(height.value)
          || height.value < 0
          || height.value >= 0xffffffff) throw invalidArgument();
        target = Object.freeze({ height: height.value, hash: blockHash(hash.value) });
      }
    } catch {
      return Promise.reject(invalidArgument());
    }
    this.controller = new AbortController();
    this.running = this.run(target, signal).finally(() => {
      this.running = undefined;
      this.controller = undefined;
    });
    return this.running;
  }

  /** Submission joins an existing scan without taking ownership of its cancellation. */
  async refreshForSubmission(signal: AbortSignal): Promise<void> {
    const pending = operation(signal);
    try {
      pending.check();
      const status = await pending.wait(this.running ?? this.sync({ signal }));
      pending.check();
      if (!status.targetReached) {
        throw failure('SYNC_REQUIRED', 'submission', 'sync', 'Wallet scan did not reach its submission target.', true);
      }
    } finally {
      pending.close();
    }
  }

  private async run(target: ChainPoint | undefined, signal: AbortSignal | undefined): Promise<SyncStatus> {
    this.settledRevision = undefined;
    this.activity = 'running';
    this.reached = false;
    this.lastError = null;
    this.target = target ?? null;
    try {
      // Host admission validates the caller's native signal before composing dependencies.
      await this.session.scan.state(signal === undefined ? {} : { signal });
      if (!this.light) throw unavailable();
      const dependent = signal === undefined
        ? this.controller!.signal
        : AbortSignal.any([signal, this.controller!.signal]);
      if (this.subscribers.size) this.publish(await this.getSyncStatus());
      for (let attempt = 0; ; attempt++) {
        const point = target ?? await this.light.getTip({ signal: dependent });
        this.target = Object.freeze({ height: point.height, hash: point.hash });
        try {
          await syncWallet(this.session, this.light, this.target, dependent, this.scanBatchSize, this.polled);
          break;
        } catch (error) {
          // Only our chain-view checks permit re-pinning; arbitrary protocol errors do not.
          if (!(error instanceof Error) || !changedSource.has(error) || attempt === 2 || dependent.aborted) throw error;
        }
      }
      this.reached = true; // Native completion validates coverage, including an empty wallet.
      this.activity = 'idle';
      const status = await this.getSyncStatus();
      this.settledRevision = status.scan.revision;
      this.publish(status);
      return status;
    } catch (caught) {
      const error = isZcashError(caught)
        ? caught
        : failure('RUNTIME_UNAVAILABLE', 'sync', 'reopen', 'Wallet sync failed.');
      this.activity = error.code === 'ABORTED' ? 'stopped' : 'failed';
      if (error.code !== 'ABORTED') {
        this.lastError = Object.freeze({
          code: error.code,
          stage: error.stage,
          recovery: error.recovery,
          retryable: error.retryable,
          message: error.message,
        });
      }
      let status: SyncStatus;
      try {
        status = await this.getSyncStatus();
      } catch {
        throw error;
      }
      this.publish(status);
      if (error.code === 'ABORTED') return status;
      throw failure(error.code, error.stage, error.recovery, error.message, error.retryable, status);
    }
  }

  async stop(): Promise<void> {
    for (const subscriber of this.subscribers) subscriber.finish();
    this.watchController?.abort();
    this.controller?.abort();
    await this.running?.catch(() => { });
    await this.watching;
  }
}

/**
 * Open-ended unspent-address requests (`txStatus: 'all'`, `outputStatus: 'unspent'`,
 * no end height, no `requestAt`) are standing polls: native keeps reissuing them
 * after a successful answer. Answering each one again against the same tip repeats
 * a network inventory and decode per transparent address on every watch poll,
 * so a request is revisited only once the target block changes. Keys are the
 * serialized request; values are the `height:hash` it was answered at.
 */
export type PolledAddresses = Map<string, string>;
const POLLED_LIMIT = 4096;

function standingPoll(request: EnhancementRequest) {
  return request.kind === 'address' && request.requestAt === null && request.endExclusive === null
    && request.txStatus === 'all' && request.outputStatus === 'unspent';
}

/** Internal finite run used by the wallet owner; all scan decisions and writes remain native. */
export async function syncWallet(
  session: Session,
  light: LightClient,
  target: ChainPoint,
  signal?: AbortSignal,
  scanBatchSize = 16,
  polled?: PolledAddresses,
) {
  if (!Number.isSafeInteger(scanBatchSize) || scanBatchSize < 1) throw invalidArgument();
  for (let attempt = 0; ; attempt++) {
    try {
      return await syncPass(session, light, target, signal, scanBatchSize, polled);
    } catch (error) {
      // A rejected revision must be replanned, never reused. Bound contention per finite run.
      if (!isZcashError(error) || error.code !== 'CURSOR_STALE' || attempt === 2 || signal?.aborted
        || session.completion?.(error)?.completion === 'unknown') throw error;
    }
  }
}

async function syncPass(session: Session, light: LightClient, target: ChainPoint,
  signal: AbortSignal | undefined, scanBatchSize: number, polled: PolledAddresses | undefined) {
  const batchSize = Math.min(scanBatchSize, 16); // Native/control-message ceiling remains authoritative.
  const op = signal === undefined ? {} : { signal };
  const pin = async () => {
    try {
      const tree = await light.getTreeState({ height: target.height, ...op });
      if (tree.point.hash !== target.hash) throw sourceChanged('target pin');
      return tree;
    } catch (error) {
      if (isZcashError(error) && error.code === 'METHOD_NOT_SUPPORTED') {
        throw failure(
          'TARGET_PINNING_UNSUPPORTED',
          'sync',
          'configure',
          'Source cannot pin the sync target.',
        );
      }
      throw error;
    }
  };
  await pin();
  const state = await session.scan.state(op);
  let height = Math.min(state.maxScannedHeight ?? 0, target.height);
  let fork = false;
  for (; height > 0; height--) {
    const local = await session.scan.block({ height, ...op });
    if (local.point === null) {
      if (fork) throw recovery();
      break;
    }
    const remote = await light.getTreeState({ height, ...op });
    if (remote.point.hash === reverse(local.point.hash)) {
      if (fork) await session.scan.rewind({ revision: local.revision, requestedPoint: local.point, ...op });
      break;
    }
    fork = true;
  }
  if (fork && height === 0) throw recovery();
  const nativeTarget = { height: target.height, hash: reverse(target.hash) };
  for (; ;) {
    const plan = await session.scan.plan({ target: nativeTarget, ...op });
    const range = plan.ranges.find(range => range.start <= target.height);
    if (!range) break;
    const end = Math.min(range.endExclusive - 1, target.height, range.start + batchSize - 1);
    const prior = await light.getTreeState({ height: range.start - 1, ...op });
    if (range.priorState.hash !== null && prior.point.hash !== reverse(range.priorState.hash)) {
      throw sourceChanged('batch predecessor');
    }
    const blocks: Uint8Array[] = [];
    let bytes = 0;
    for await (const block of light.streamCompactBlocks({ fromHeight: range.start, toHeight: end, ...op })) {
      if (block.point.height !== range.start + blocks.length) throw mismatch();
      if (block.encoded.length > 2 * 1024 * 1024) {
        throw failure(
          'RESOURCE_LIMIT',
          'sync',
          'configure',
          'Compact block exceeds native scan batch limit.',
        );
      }
      if (bytes + block.encoded.length > 2 * 1024 * 1024) break;
      blocks.push(block.encoded);
      bytes += block.encoded.length;
    }
    if (!blocks.length) throw mismatch();
    try {
      await session.scan.ingest({
        revision: plan.revision,
        target: nativeTarget,
        priorTreeState: prior.encoded,
        blocks,
        ...op,
      });
    } catch (error) {
      if (isZcashError(error) && error.code === 'PROTOCOL_MISMATCH'
        && session.completion?.(error)?.completion !== 'unknown' && !signal?.aborted) {
        // Native continuity rejection alone is not proof of a reorg. Retry only
        // when fresh source evidence demonstrates that a pinned point changed.
        try {
          await pin();
          const currentPrior = await light.getTreeState({ height: range.start - 1, ...op });
          if (currentPrior.point.hash !== prior.point.hash) throw sourceChanged('native batch predecessor');
        } catch (checkError) {
          if (checkError instanceof Error && changedSource.has(checkError)) throw checkError;
        }
      }
      throw error;
    }
  }
  // Upstream polling requests may remain after a successful status update. Visit each once per run.
  const visited = new Set<string>();
  for (; ;) {
    const pending = await session.enhancement.requests(op);
    const request = pending.requests.find(value => !visited.has(JSON.stringify(value))
      && !(value.kind === 'address' && value.requestAt !== null && value.requestAt > Date.now())
      && !(standingPoll(value) && polled?.get(JSON.stringify(value)) === `${target.height}:${target.hash}`));
    if (!request) break;
    if (visited.size >= 1024) {
      throw failure(
        'RESOURCE_LIMIT',
        'sync',
        'sync',
        'Sync enhancement pass exceeded its request limit.',
      );
    }
    const key = JSON.stringify(request);
    if (standingPoll(request) && request.kind === 'address') {
      // Answer every due standing poll from this snapshot against one source view.
      const due = pending.requests.filter((value): value is typeof request => standingPoll(value)
        && value.kind === 'address' && !visited.has(JSON.stringify(value))
        && polled?.get(JSON.stringify(value)) !== `${target.height}:${target.hash}`).slice(0, 100);
      if (due.length > 1) {
        const committed = await applyUnspentBatch(session, light, pending.revision, due, signal);
        if (committed !== null) {
          if (visited.size + due.length > 1024) {
            throw failure('RESOURCE_LIMIT', 'sync', 'sync', 'Sync enhancement pass exceeded its request limit.');
          }
          for (const value of due) visited.add(JSON.stringify(value));
          if (polled) {
            if (polled.size + committed.length > POLLED_LIMIT) polled.clear();
            for (const value of committed) polled.set(JSON.stringify(value), `${target.height}:${target.hash}`);
          }
          continue;
        }
        // Inventory too large for one response: fall through to one request at a time.
      }
    }
    visited.add(key);
    const answered = await applyEnhancement(session, light, pending.revision, request, signal);
    // A deferred inventory (the source moved) stays due on the next pass.
    if (polled && answered === true && standingPoll(request)) {
      if (polled.size >= POLLED_LIMIT) polled.clear();
      polled.set(key, `${target.height}:${target.hash}`);
    }
  }
  const tree = await pin();
  const current = await session.scan.state(op);
  await session.scan.complete({ revision: current.revision, target: nativeTarget, treeState: tree.encoded, ...op });
  return session.scan.state(op);
}
