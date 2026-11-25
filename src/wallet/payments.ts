import { admitSignal, delay, schedule as timeout } from '../abort.js';
import { observationOptions, recoveryPolicy } from '../options.js';
import { ObserverBuffer } from '../observer-buffer.js';
import type { PaymentState, AccountId } from '../types.js';
import type {
  NativePaymentState,
  NativePayment,
  PaymentInventoryInput,
  PaymentInventory,
  PaymentAttemptInput,
  PaymentAttempt,
  PaymentAttemptFinish,
} from './payment-journal-types.js';

import type {
  ErrorInfo,
  ObservationOptions,
  OperationsApi,
  PendingPayment,
  PaymentConfirmation,
  Op,
  RecoveryPolicy,
  RecoveryReport,
  WalletOptions,
  WalletClient,
  NonEmpty,
  ConfirmedTransaction,
} from '../types.js';
import type { openWalletRuntime } from '../runtime/wallet.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';
import { snapshot } from '../clients/owned-plumbing.js';
import { operation } from '../clients/light-chain-reads.js';
import { networkBinding } from '../network.js';
import { PaymentSource, isPendingObservation } from './payment-source.js';
import { WalletProposals } from './proposals.js';
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw invalidArgument();
  return value;
};
const sequence = (value: string) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw invalidArgument();
  return BigInt(value);
};
const positive = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidArgument();
  return value;
};
const protocol = () => failure('PROTOCOL_MISMATCH', 'observation', 'reopen', 'Payment journal reply is inconsistent.');
const unavailable = () => failure(
  'OBSERVATION_UNAVAILABLE',
  'observation',
  'configure',
  'No payment observation route is configured.',
);
const missing = () => failure(
  'OPERATION_NOT_FOUND',
  'observation',
  'correct-input',
  'Payment operation does not exist.',
);
const resource = () => failure(
  'RESOURCE_LIMIT',
  'observation',
  'configure',
  'Payment observation exceeds the configured budget.',
);
const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
};
const partial = (code: ErrorInfo['code'], state: PaymentState) => failure(
  code,
  'observation',
  code === 'TIMEOUT' || code === 'ABORTED' ? 'none' : 'resume-operation',
  'Payment observation did not complete.',
  false,
  undefined,
  state,
);
const observationAborted = () => failure('ABORTED', 'observation', 'none', 'Payment observation aborted.');

/** Single-step payment lifecycle on the existing native journal and caller-owned clients. */
export class WalletPayments {
  private readonly light: PaymentSource | undefined;
  private readonly broadcaster: PaymentSource | undefined;
  private readonly observation: ObservationOptions;
  private readonly policy: RecoveryPolicy;
  private readonly stopped = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private readonly starts = new Map<string, { at: number; release: () => void }>();
  private readonly opened = performance.now();
  private closing: Promise<void> | undefined;
  private recoveryRun: Promise<RecoveryReport> | undefined;
  private ready = false;
  private readonly maxJobs: number;
  readonly operations: OperationsApi;
  constructor(
    private readonly wallet: Awaited<ReturnType<typeof openWalletRuntime>>,
    private readonly proposals: WalletProposals,
    options: Pick<
      WalletOptions,
      'network' | 'light' | 'broadcaster' | 'storage' | 'observation' | 'recovery'
    > & { runtime: import('../types.js').RuntimeOptions },
    private readonly refreshForSubmission?: (signal: AbortSignal) => Promise<void>,
  ) {
    networkBinding(options.network);
    this.durability = options.storage.kind === 'memory' ? 'ephemeral' : 'durable';
    this.observation = observationOptions(options.observation);
    this.maxJobs = positive(options.runtime.maxQueuedJobs);
    this.light = options.light === undefined ? undefined : new PaymentSource(options.light, options.network);
    this.broadcaster = options.broadcaster === undefined
      ? undefined
      : options.broadcaster === options.light
        ? this.light
        : new PaymentSource(options.broadcaster, options.network);
    this.policy = recoveryPolicy(options.recovery, Boolean(this.light), Boolean(this.broadcaster));
    this.operations = Object.freeze(
      {
        abandon: args => this.abandon(args),
        get: args => this.get(args),
        list: args => this.list(args),
        resume: args => this.resume(args),
      } satisfies OperationsApi,
    );
  }

  private readonly durability: PaymentState['durability'];
  private check(recovery = false) {
    this.wallet.session.check();
    if (this.closing) throw failure('CLOSED', 'observation', 'none', 'Wallet payments are closed.');
    if (!recovery && !this.ready) {
      throw failure(
        'RECOVERY_REQUIRED',
        'observation',
        'reopen',
        'Payment recovery has not completed.',
      );
    }
  }

  private run<T>(
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
    recovery = false,
  ): Promise<T> {
    admitSignal(signal);
    this.check(recovery);
    const pending = operation(AbortSignal.any(signal ? [signal, this.stopped.signal] : [this.stopped.signal]));
    let release: () => void;
    try {
      pending.check();
      if (this.active.size >= this.maxJobs) throw resource();
      release = this.wallet.session.reserveWorking(16384, async () => { });
    } catch (error) {
      pending.close();
      throw error;
    }
    const result = Promise.resolve().then(() => {
      pending.check();
      return work(pending.signal);
    });
    this.active.add(result);
    void result.finally(() => {
      this.active.delete(result);
      release();
      pending.close();
    }).catch(() => { });
    return result;
  }

  private project(value: NativePayment): PaymentState {
    const state = value.state;
    if (!state || typeof state.revision !== 'string'
      || !Array.isArray(state.accountIds)
      || !state.accountIds.length
      || !Array.isArray(state.steps)
      || state.steps.length > 16
      || !Number.isSafeInteger(state.lockExpiryHeight)
      || state.lockExpiryHeight < 0
      || state.lockExpiryHeight > 0xffffffff) throw protocol();
    id(state.operationId);
    sequence(value.observationSequence);
    if (!Array.isArray(value.observationSequences)
      || value.observationSequences.length !== state.steps.length) throw protocol();
    value.observationSequences.forEach(sequence);
    if (state.steps.some(
      (step, index) => step.index !== index
        || step.dependsOn.some(
          (parent: number) => !Number.isInteger(parent) || parent < 0 || parent >= index,
        ),
    )) throw protocol();
    const iso = (n: number) => {
      if (!Number.isSafeInteger(n) || n < 0 || n > 8640000000000000) throw protocol();
      return new Date(n).toISOString();
    };
    return frozen({
      ...state,
      durability: this.durability,
      accountIds: [...state.accountIds] as unknown as NonEmpty<AccountId>,
      missing: [...state.missing],
      steps: state.steps.map((step: NativePaymentState['steps'][number]) => ({
        ...step,
        dependsOn: [...step.dependsOn],
        blockedBy: [...step.blockedBy],
        expiry: { ...step.expiry },
        inclusion: step.inclusion ? { ...step.inclusion } : null,
        observation: step.observation ? structuredClone(step.observation) : null,
        attempts: step.attempts.map(
          attempt => ({
            ...attempt,
            startedAt: iso(attempt.startedAt),
            completedAt: attempt.completedAt === null ? null : iso(attempt.completedAt),
          }),
        ),
      })),
    });
  }

  private async read(operationId: string, signal?: AbortSignal) {
    const value = await this.wallet.session.payments.get({ operationId, ...(signal ? { signal } : {}) });
    if (value && value.state.operationId !== operationId) throw protocol();
    return value;
  }

  private async page(args: PaymentInventoryInput & Op) {
    const page = await this.wallet.session.payments.list(args);
    let previous = sequence(args.afterSequence);
    const high = sequence(page.highWater);
    sequence(page.observationPosition);
    if ((args.highWater !== undefined && page.highWater !== args.highWater)
      || typeof page.revision !== 'string'
      || !page.revision.length
      || page.revision.length > 64
      || !Array.isArray(page.items)
      || page.items.length > args.limit) throw protocol();
    for (const row of page.items) {
      const next = sequence(row.sequence);
      id(row.operationId);
      if (next <= previous || next > high) throw protocol();
      previous = next;
    }
    return page;
  }

  get(args: { operationId: string } & Op): Promise<PaymentState | null> {
    const input = snapshot(args, ['operationId', 'signal']),
      operationId = id(input.operationId);
    return this.run(input.signal, async (signal) => {
      const value = await this.read(operationId, signal);
      return value ? this.project(value) : null;
    });
  }

  private abandon(args: { operationId: string } & Op): Promise<PaymentState> {
    const input = snapshot(args, ['operationId', 'signal']),
      operationId = id(input.operationId);
    return this.run(input.signal, async (signal) => {
      const value = await this.wallet.session.payments.abandon({ operationId, signal });
      if (value.state.operationId !== operationId || value.state.phase !== 'abandoned') throw protocol();
      return this.project(value);
    });
  }

  private async requirePayment(operationId: string, signal?: AbortSignal) {
    const value = await this.read(operationId, signal);
    if (!value) throw missing();
    return value;
  }

  list(args: Parameters<OperationsApi['list']>[0] = {}): ReturnType<OperationsApi['list']> {
    const input = snapshot(args, ['cursor', 'limit', 'accountId', 'signal']),
      limit = positive(input.limit ?? 50);
    if (limit > 200) throw invalidArgument();
    if (input.accountId !== undefined
      && (typeof input.accountId !== 'string' || !input.accountId.length
        || input.accountId.length > 128)) throw invalidArgument();
    let cursor: { revision: string; afterSequence: string; highWater: string; accountId: string | null } | undefined;
    if (input.cursor !== undefined) {
      try {
        if (typeof input.cursor !== 'string' || input.cursor.length > 1024) throw 0;
        cursor = snapshot(
          JSON.parse(input.cursor),
          ['revision', 'afterSequence', 'highWater', 'accountId'],
        );
        if (cursor!.accountId !== (input.accountId ?? null)
          || typeof cursor!.revision !== 'string') throw 0;
        sequence(cursor!.afterSequence);
        sequence(cursor!.highWater);
      } catch {
        throw invalidArgument();
      }
    }
    return this.run(input.signal, async (signal) => {
      const page = await this.page({
        afterSequence: cursor?.afterSequence ?? '0',
        ...(cursor ? { highWater: cursor.highWater } : {}),
        limit,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        signal,
      });
      if (cursor && cursor.revision !== page.revision) {
        throw failure(
          'CURSOR_STALE',
          'observation',
          'correct-input',
          'Payment cursor is stale.',
        );
      }
      const items: PaymentState[] = [],
        releases: (() => void)[] = [];
      try {
        for (const row of page.items) {
          const value = await this.requirePayment(row.operationId, signal);
          if (value.state.revision !== page.revision) {
            throw failure(
              'CURSOR_STALE',
              'observation',
              'correct-input',
              'Payment cursor is stale.',
            );
          }
          releases.push(
            this.wallet.session.reserveWorking(8 * JSON.stringify(value.state).length, async () => { }),
          );
          items.push(this.project(value));
        }
        const last = page.items.at(-1);
        return {
          items,
          revision: page.revision,
          nextCursor: last && page.items.length === limit && last.sequence !== page.highWater
            ? JSON.stringify({
                revision: page.revision,
                afterSequence: last.sequence,
                highWater: page.highWater,
                accountId: input.accountId ?? null,
              })
            : null,
        };
      } finally {
        for (const release of releases) release();
      }
    });
  }

  async resume(args: { operationId: string } & Op): Promise<PendingPayment> {
    const input = snapshot(args, ['operationId', 'signal']),
      operationId = id(input.operationId);
    await this.get(input).then((value) => {
      if (!value) throw missing();
    });
    return this.handle(operationId);
  }

  private handle(operationId: string): PendingPayment {
    return Object.freeze({
      operationId,
      snapshot: async () => {
        const value = await this.get({ operationId });
        if (!value) throw missing();
        return value;
      },
      events: (args = {}) => this.events(operationId, args),
      broadcast: (args = {}) => this.broadcast({ operationId, ...snapshot(args, ['signal']) }),
      wait: (args = {}) => this.wait(operationId, args),
    });
  }

  async finalize(args: Parameters<WalletClient['finalize']>[0]): Promise<PendingPayment> {
    const input = snapshot(args, ['pczt', 'signal']);
    return this.run(input.signal, async (signal) => {
      const value = await this.proposals.finalize({ ...input, signal });
      try {
        return this.handle(value.operationId);
      } catch (error) {
        if (error && typeof error === 'object') this.wallet.session.committed(error, value);
        throw error;
      }
    });
  }

  private async observe(value: NativePayment, source: PaymentSource, signal: AbortSignal): Promise<NativePayment> {
    const steps = value.state.steps.filter(step => step.txid !== null);
    if (!steps.length) return value;
    for (const step of steps) value = await this.observeStep(value, step.index, source, signal);
    return value;
  }

  private async observeStep(
    value: NativePayment,
    index: number,
    source: PaymentSource,
    signal: AbortSignal,
  ): Promise<NativePayment> {
    const step = value.state.steps[index];
    if (!step?.txid) throw protocol();
    const release = this.wallet.session.reserveWorking(16 * 1024 * 1024, async () => { });
    try {
      const observation = await source.observe(step.txid, signal);
      if (signal.aborted) throw failure('ABORTED', 'observation', 'none', 'Observation aborted.');
      // Persist completed source evidence even if the network deadline expires during this commit.
      return await this.wallet.session.payments.observe({
        operationId: value.state.operationId,
        stepIndex: index,
        observation,
        wallTimeMs: Date.now(),
      });
    } finally {
      release();
    }
  }

  broadcast(args: { operationId: string } & Op): Promise<PaymentState> {
    const input = snapshot(args, ['operationId', 'signal']),
      operationId = id(input.operationId);
    return this.run(
      input.signal,
      async signal => this.project(await this.submit(operationId, signal, false)),
    );
  }

  dispatch(args: { operationId: string; origin: 'send' | 'shield' } & Op): Promise<PendingPayment> {
    const input = snapshot(args, ['operationId', 'origin', 'signal']),
      operationId = id(input.operationId);
    if (!['send', 'shield'].includes(input.origin)) throw invalidArgument();
    return this.run(
      input.signal,
      async (signal) => {
        await this.submit(operationId, signal, false, undefined, input.origin);
        return this.handle(operationId);
      },
    );
  }

  private async submit(
    operationId: string,
    signal: AbortSignal,
    automatic: boolean,
    observed?: NativePayment,
    origin: 'broadcast' | 'send' | 'shield' = 'broadcast',
  ): Promise<NativePayment> {
    const release = this.wallet.session.payments.start(operationId);
    let working: (() => void) | undefined;
    try {
      working = this.wallet.session.reserveWorking(
        16 * Math.min(this.wallet.session.pczt.maximum, 2 * 1024 * 1024),
        async () => { },
      );
      return await this.submitLocked(operationId, signal, automatic, observed, origin);
    } finally {
      working?.();
      release();
    }
  }

  private async submitLocked(
    operationId: string,
    signal: AbortSignal,
    automatic: boolean,
    observed: NativePayment | undefined,
    origin: 'broadcast' | 'send' | 'shield',
  ): Promise<NativePayment> {
    const current = observed
      ?? await this.wallet.session.payments.reconcile({ operationId, wallTimeMs: Date.now(), signal });
    if (current.state.phase === 'abandoned') throw partial('ROLE_PRECONDITION', this.project(current));
    if (!this.broadcaster) {
      throw failure(
        'OBSERVATION_UNAVAILABLE',
        'submission',
        'configure',
        'No submission route is configured.',
      );
    }
    let value = observed ?? await this.observe(current, this.light ?? this.broadcaster, signal);
    const sourceId = await this.broadcaster.verify(signal),
      routeBinding = await this.broadcaster.route();
    if (signal.aborted) throw failure('ABORTED', 'submission', 'none', 'Submission aborted.');
    this.project(value);
    if (!value.state.steps.length
      || value.state.steps.some(step => step.txid === null)) throw partial('NOT_FINALIZED', this.project(value));
    for (const step of value.state.steps) {
      if (step.inclusion?.confirmations && step.observation?.state === 'mined') continue;
      value = await this.submitStep(value, step.index, sourceId, routeBinding, signal, automatic, origin);
      if (value.state.steps.some(
        child => child.dependsOn.includes(step.index),
      )) {
        value = await this.observeStep(
          value,
          step.index,
          this.light ?? this.broadcaster,
          signal,
        );
      }
    }
    return value;
  }

  /** Refresh only before native attempt admission; never retry a network submission here. */
  private async prepareSubmission(value: NativePayment, index: number, signal: AbortSignal): Promise<NativePayment> {
    for (let refreshes = 0; ; refreshes++) {
      const tip = value.state.steps[index]!.observation?.tip;
      if (!tip) return value; // Native admission remains authoritative for missing evidence.
      const scan = await this.wallet.session.scan.state({ signal });
      const block = await this.wallet.session.scan.block({ height: tip.height, signal });
      if (scan.tipHeight === tip.height && block.point?.height === tip.height
        && block.point.hash === tip.hash.match(/../g)!.reverse().join('')) return value;
      if (refreshes === 3) {
        throw failure('SYNC_REQUIRED', 'submission', 'sync',
          'Source kept changing before submission; resume the retained operation after syncing.', true,
          undefined, this.project(value), value.state.operationId);
      }
      try {
        await this.refreshForSubmission!(signal);
      } catch (error) {
        // The operation is finalized and retained with no attempt: say so, so callers
        // recover this same operation instead of treating the payment as never created.
        if (!isZcashError(error)) throw error;
        throw failure(error.code, error.stage, error.recovery, error.message, error.retryable,
          error.syncStatus, error.paymentState ?? this.project(value), value.state.operationId);
      }
      value = await this.observeStep(value, index, this.light ?? this.broadcaster!, signal);
    }
  }

  private async submitStep(
    value: NativePayment,
    index: number,
    sourceId: string,
    routeBinding: string | null,
    signal: AbortSignal,
    automatic: boolean,
    origin: 'broadcast' | 'send' | 'shield',
  ): Promise<NativePayment> {
    if (!automatic && this.refreshForSubmission) {
      value = await this.prepareSubmission(value, index, signal);
      const step = value.state.steps[index]!;
      if (step.inclusion?.confirmations && step.observation?.state === 'mined') return value;
    }
    const operationId = value.state.operationId,
      key = operationId + ':' + index;
    const policy = this.policy.mode === 'online' ? this.policy.rebroadcast : undefined;
    const args: PaymentAttemptInput = {
      operationId,
      stepIndex: index,
      sourceId,
      routeBinding,
      mode: automatic ? 'automatic' : 'explicit',
      ...(automatic ? {} : { origin }),
      wallTimeMs: Date.now(),
      monotonicElapsedMs: Math.floor(performance.now() - (this.starts.get(key)?.at ?? this.opened)),
      observationSequence: value.observationSequences[index]!,
      ...(automatic && policy
        ? {
            policy: { maxAttempts: policy.maxAttempts, minIntervalMs: policy.minIntervalMs },
          }
        : {}),
    };
    let attempt: PaymentAttempt | null,
      remember: (() => void) | undefined;
    try {
      if (!this.starts.has(key)) remember = this.wallet.session.reserveWorking(512, async () => { });
      try {
        attempt = await this.wallet.session.payments.begin({ ...args, signal });
      } catch (error) {
        const receipt = error && typeof error === 'object' ? this.wallet.session.completion(error) : undefined;
        if (receipt?.completion === 'committed' && receipt.value !== undefined) {
          attempt = receipt.value as PaymentAttempt | null;
        } else {
          if (isZcashError(error)
            && [
              'PAYMENT_BLOCKED',
              'TRANSACTION_EXPIRED',
              'NOT_FINALIZED',
            ].includes(error.code)) {
            throw partial(error.code, this.project(value));
          }
          throw error;
        }
      }
      if (!attempt) {
        if (signal.aborted) throw partial('ABORTED', this.project(value));
        return value;
      }
      this.starts.set(
        key,
        { at: performance.now(), release: this.starts.get(key)?.release ?? remember! },
      );
      remember = undefined;
      let result: PaymentAttemptFinish = {
        operationId,
        attemptId: attempt.attemptId,
        outcome: 'unknown',
        wallTimeMs: Date.now(),
      };
      try {
        if (!signal.aborted) {
          const pending = operation(signal);
          try {
            const reply = await pending.wait(
              this.broadcaster!.broadcast(attempt.bytes, attempt.txid, sourceId, pending.signal),
            );
            result = {
              ...result,
              outcome: reply.outcome,
              ...(reply.outcome === 'acknowledged' ? { txid: reply.txid } : {}),
              ...(reply.diagnosticCode === null ? {} : { diagnosticCode: reply.diagnosticCode }),
            };
          } finally {
            pending.close();
          }
        }
      } catch { /* A durable attempt-start without a valid completion remains unknown. */ }
      const finished = await this.wallet.session.payments.finish({ ...result, wallTimeMs: Date.now() });
      if (signal.aborted) {
        const error = partial('ABORTED', this.project(finished));
        this.wallet.session.committed(error, finished);
        throw error;
      }
      return finished;
    } finally {
      remember?.();
    }
  }

  events(operationId: string, args: Op = {}): AsyncIterableIterator<PaymentState> {
    id(operationId);
    const input = snapshot(args, ['signal']);
    const admission = operation(input.signal);
    admission.close();
    this.check();
    const buffer = new ObserverBuffer<PaymentState>(this.observation.maxBufferedUpdates, resource);
    const controller = new AbortController();
    let running: Promise<void> | undefined;
    const run = () => this.run(
      AbortSignal.any([input.signal ?? new AbortController().signal, controller.signal]),
      async (signal) => {
        let revision: string | undefined;
        try {
          for (; ;) {
            let value = await this.requirePayment(operationId, signal);
            const source = this.light ?? this.broadcaster;
            try {
              if (source) value = await this.observe(value, source, signal);
            } catch (error) {
              // Only our coherent-read retry marker permits another poll. No submission
              // is performed here, and no unverified observation reaches native state.
              if (!isPendingObservation(error)) throw error;
              await delay(this.observation.pollIntervalMs, signal, observationAborted);
              continue;
            }
            const state = this.project(value);
            if (state.revision !== revision) {
              buffer.push(state, () => this.wallet.session.reserveWorking(
                8 * JSON.stringify(state).length, async () => { },
              ));
              revision = state.revision;
            }
            if (state.phase === 'abandoned') break;
            await delay(this.observation.pollIntervalMs, signal, observationAborted);
          }
        } catch (caught) {
          buffer.close(caught);
        } finally {
          buffer.end();
        }
      },
    );
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => buffer.next(() => {
        if (running) return;
        try {
          running = run();
          void running.catch(error => buffer.close(error));
        } catch (error) {
          buffer.close(error);
        }
      }),
      async return() {
        buffer.close();
        controller.abort();
        await running?.catch(() => { });
        return { done: true, value: undefined };
      },
    };
  }

  private async wait(
    operationId: string,
    args: Parameters<PendingPayment['wait']>[0] = {},
  ): Promise<PaymentConfirmation> {
    const input = snapshot(args, ['signal', 'confirmations', 'timeoutMs']),
      confirmations = positive(input.confirmations ?? 1);
    if (input.timeoutMs !== undefined) positive(input.timeoutMs);
    const caller = operation(input.signal),
      timer = new AbortController(),
      dependent = operation(AbortSignal.any([caller.signal, timer.signal, this.stopped.signal]));
    const stop = input.timeoutMs === undefined ? () => { } : timeout(() => timer.abort(), input.timeoutMs);
    let iterator: AsyncIterableIterator<PaymentState> | undefined,
      last: PaymentState | undefined;
    try {
      caller.check();
      this.check();
      last = await this.run(
        dependent.signal,
        async signal => this.project(await this.requirePayment(operationId, signal)),
      );
      if (last.phase === 'abandoned') throw partial('ROLE_PRECONDITION', last);
      if (last.steps.some(step => step.txid === null)) throw partial('NOT_FINALIZED', last);
      if (!this.light && !this.broadcaster) throw unavailable();
      iterator = this.events(operationId, { signal: dependent.signal });
      for (; ;) {
        const item = await dependent.wait(iterator.next());
        if (item.done) throw partial('OBSERVATION_UNAVAILABLE', last);
        last = item.value;
        if (last.steps.length
          && last.steps.every(
            step => step.txid && step.inclusion?.blockHash
              && step.inclusion.confirmations !== null
              && step.inclusion.confirmations >= confirmations,
          )) {
          const transactions = last.steps.map(
            step => ({
              txid: step.txid!,
              height: step.inclusion!.height,
              blockHash: step.inclusion!.blockHash!,
              confirmations: step.inclusion!.confirmations!,
              sourceId: step.observation!.sourceId,
              observedAt: step.observation!.observedAt,
            }),
          ) as unknown as NonEmpty<ConfirmedTransaction>;
          return { operationId, transactions, snapshot: last };
        }
        if (last.steps.some(step => step.expiry.reached === true)) throw partial('TRANSACTION_EXPIRED', last);
        if (last.steps.some(step => step.blockedBy.length)) throw partial('PAYMENT_BLOCKED', last);
        if (last.steps.some(step => step.attempts.at(-1)?.outcome === 'rejected')) {
          throw partial('SUBMISSION_REJECTED', last);
        }
      }
    } catch (error) {
      if (last && (timer.signal.aborted || caller.signal.aborted)) {
        throw partial(caller.signal.aborted ? 'ABORTED' : 'TIMEOUT', last);
      }
      throw error;
    } finally {
      stop();
      dependent.cancel();
      caller.close();
      await iterator?.return?.();
    }
  }

  private async recoverLocal(captured: PaymentInventory, signal: AbortSignal) {
    const retry = this.policy.mode === 'online' ? this.policy.rebroadcast : undefined;
    let operations = 0,
      candidates = 0,
      page = captured;
    while (page.items.length) {
      for (const row of page.items) {
        const value = await this.wallet.session.payments.reconcile({
          operationId: row.operationId,
          wallTimeMs: Date.now(),
          ...(retry ? { policy: { maxAttempts: retry.maxAttempts, minIntervalMs: retry.minIntervalMs } } : {}),
          signal,
        });
        this.project(value);
        operations++;
        if (value.state.steps.some(step => step.txid !== null)) candidates++;
        if (!Number.isSafeInteger(operations)) throw resource();
      }
      await delay(1, signal, observationAborted);
      page = await this.page({
        afterSequence: page.items.at(-1)!.sequence, highWater: captured.highWater, limit: 200, signal,
      });
    }
    return { operations, candidates };
  }

  private async* recoveryRows(captured: PaymentInventory, signal: AbortSignal, networkSignal: AbortSignal) {
    const pivot = sequence(captured.observationPosition) > sequence(captured.highWater)
      ? '0'
      : captured.observationPosition;
    const ranges = [{ after: pivot, high: captured.highWater }, { after: '0', high: pivot }];
    for (const range of ranges) {
      let after = range.after;
      while (sequence(after) < sequence(range.high)) {
        if (networkSignal.aborted) return;
        // Local reads use the caller's lifetime, not the network deadline.
        const page = await this.page({ afterSequence: after, highWater: range.high, limit: 200, signal });
        if (!page.items.length) break;
        for (const row of page.items) {
          if (networkSignal.aborted) return;
          after = row.sequence;
          yield row;
        }
        await delay(1, signal, observationAborted);
      }
    }
  }

  private async recoverPayment(value: NativePayment, signal: AbortSignal) {
    let observed = false;
    try {
      const checked = await this.observe(value, this.light!, signal);
      observed = true;
      if (this.policy.mode === 'online' && this.policy.rebroadcast && !signal.aborted) {
        await this.submit(
          value.state.operationId,
          signal,
          true,
          checked,
        );
      }
      return { observed, error: null };
    } catch (error) {
      const receipt = error && typeof error === 'object' ? this.wallet.session.completion(error) : undefined;
      // A network report must never hide a durable write failure or an uncertain commit.
      if (receipt && receipt.completion !== 'none') throw error;
      if (isZcashError(error) && ['storage', 'runtime'].includes(error.stage)) throw error;
      const known = isZcashError(error)
        ? error
        : failure('TRANSPORT_ERROR', 'observation', 'configure', 'Payment endpoint is unavailable.');
      return {
        observed,
        error: {
          code: known.code,
          stage: known.stage,
          recovery: known.recovery,
          retryable: known.retryable,
          message: 'Payment recovery network pass did not complete.',
        },
      };
    }
  }

  private async recoverOnline(captured: PaymentInventory, signal: AbortSignal) {
    let observed = 0,
      lastError: ErrorInfo | null = null;
    if (this.policy.mode !== 'online') return { observed, lastError };
    const timer = new AbortController();
    const pending = operation(AbortSignal.any([signal, timer.signal]));
    const stop = timeout(() => timer.abort(), this.policy.timeoutMs);
    try {
      for await (const row of this.recoveryRows(captured, signal, pending.signal)) {
        const value = await this.requirePayment(row.operationId, signal);
        if (value.state.steps.some(step => step.txid !== null)) {
          const result = await this.recoverPayment(value, pending.signal);
          if (result.observed) observed++;
          lastError = result.error;
        }
        // Advance after attempted observation, including a network failure, for fair retries.
        // This durable write must finish even when the network deadline has expired.
        await this.wallet.session.payments.position({ afterSequence: row.sequence });
        if (lastError) {
          await delay(1, signal, observationAborted);
          break;
        }
      }
      if (timer.signal.aborted) {
        lastError = {
          code: 'TIMEOUT',
          stage: 'observation',
          recovery: 'none',
          retryable: false,
          message: 'Payment recovery network deadline expired.',
        };
      }
      if (signal.aborted) throw failure('ABORTED', 'observation', 'none', 'Wallet recovery aborted.');
      return { observed, lastError };
    } finally {
      stop();
      pending.cancel();
    }
  }

  recover(args: Op = {}): Promise<RecoveryReport> {
    const input = snapshot(args, ['signal']);
    if (this.recoveryRun) return this.recoveryRun;
    return this.recoveryRun = this.run(input.signal, async (signal) => {
      const captured = await this.page({ afterSequence: '0', limit: 200, signal });
      const { operations, candidates } = await this.recoverLocal(captured, signal);
      const { observed, lastError } = this.policy.mode === 'online' && candidates
        ? await this.recoverOnline(captured, signal)
        : { observed: 0, lastError: null };
      const deferred = candidates - observed;
      this.ready = true;
      return frozen({
        local: 'complete',
        operations,
        observedOperations: observed,
        deferredOperations: deferred,
        observation: this.policy.mode === 'offline' ? 'offline' : deferred ? 'incomplete' : 'complete',
        lastError,
      } satisfies RecoveryReport);
    }, true);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped.abort();
    return this.closing = (async () => {
      await Promise.allSettled([...this.active]);
      for (const value of this.starts.values()) value.release();
      this.starts.clear();
    })();
  }
}
