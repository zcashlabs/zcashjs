import type {
  BroadcastReport,
  ChainPoint,
  LightClient,
  Network,
  PublicClient,
  TransactionObservation,
  TxId,
} from '../types.js';
import { networkBinding } from '../network.js';
import { lightClientBinding } from '../light.js';
import { publicClientBinding } from '../public.js';
import { snapshot, ownBytes, dataField } from '../clients/owned-plumbing.js';
import { operation } from '../clients/light-chain-reads.js';
import { failure, invalidArgument } from '../errors.js';
import { delay } from '../abort.js';
import { blockHash, txId } from '../primitives.js';
import { initialize } from '../runtime/lightwire-capsule.mjs';
import { sha256Hex } from '../hash.js';
const protocol = () => failure(
  'PROTOCOL_MISMATCH',
  'observation',
  'configure',
  'Payment source returned inconsistent evidence.',
);
const changedObservations = new WeakSet<object>();
export const isPendingObservation = (error: unknown): boolean =>
  error instanceof Error && changedObservations.has(error);
const changedObservation = () => {
  const error = failure('OBSERVATION_UNAVAILABLE', 'observation', 'resume-operation',
    'Source has not provided a coherent payment observation yet.', true);
  changedObservations.add(error);
  return error;
};
const mismatch = () => failure(
  'NETWORK_MISMATCH',
  'observation',
  'configure',
  'Payment source network does not match the wallet.',
);
function evidenceFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    return snapshot(value, keys);
  } catch {
    throw protocol();
  }
}
function point(value: unknown): ChainPoint {
  const p = evidenceFields(value, ['height', 'hash']);
  if (typeof p.height !== 'number' || typeof p.hash !== 'string'
    || !Number.isInteger(p.height)
    || p.height < 0
    || p.height > 0xffffffff) throw protocol();
  try {
    return { height: p.height, hash: blockHash(p.hash) };
  } catch {
    throw protocol();
  }
}
function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw protocol();
  return value;
}
function checkedHash(value: unknown) {
  if (typeof value !== 'string') throw protocol();
  return blockHash(value);
}
function observationState(value: unknown): TransactionObservation['state'] {
  if (value === 'notSeen' || value === 'mempool' || value === 'mined'
    || value === 'offMainChain'
    || value === 'unknown') return value;
  throw protocol();
}
function observationEvidence(evidence: unknown, id: TxId, source: string) {
  const value = evidenceFields(
    evidence,
    ['txid', 'state', 'inclusion', 'tip', 'priorInclusion', 'sourceId', 'observedAt'],
  );
  if (value.txid !== id || sourceId(value.sourceId) !== source) throw protocol();
  const state = observationState(value.state);
  let priorInclusion: TransactionObservation['priorInclusion'] = null;
  if (value.priorInclusion !== null) {
    const prior = evidenceFields(value.priorInclusion, ['height', 'blockHash', 'confirmations']);
    if (typeof prior.height !== 'number' || !Number.isInteger(prior.height)
      || prior.height < 0
      || prior.height > 0xffffffff) throw protocol();
    if (prior.confirmations !== null && (typeof prior.confirmations !== 'number'
      || !Number.isSafeInteger(prior.confirmations) || prior.confirmations < 0)) throw protocol();
    try {
      priorInclusion = {
        height: prior.height,
        blockHash: prior.blockHash === null ? null : checkedHash(prior.blockHash),
        confirmations: null,
      };
    } catch {
      throw protocol();
    }
  }
  let claimed: { height: number; blockHash: ReturnType<typeof blockHash> | null } | null = null;
  if (state === 'mined') {
    const inclusion = evidenceFields(value.inclusion, ['height', 'blockHash', 'confirmations']);
    if (typeof inclusion.height !== 'number' || !Number.isInteger(inclusion.height)
      || inclusion.height < 0 || inclusion.height > 0xffffffff) throw protocol();
    try {
      claimed = {
        height: inclusion.height,
        blockHash: inclusion.blockHash === null ? null : checkedHash(inclusion.blockHash),
      };
    } catch {
      throw protocol();
    }
  } else if (value.inclusion !== null) throw protocol();
  return { state, priorInclusion, claimed };
}
const same = (a: ChainPoint, b: ChainPoint) => a.height === b.height && a.hash === b.hash;

/** Captured client methods; private route identity is never inferred from display sourceId. */
export class PaymentSource {
  private readonly methods: Record<string, (...args: never[]) => unknown> = {};
  private readonly bound: ReturnType<typeof networkBinding>;
  private readonly endpoint: string | null;
  private readonly protocolName: string;
  private readonly registered: boolean;
  constructor(private readonly client: PublicClient | LightClient, private readonly network: Network) {
    if (!client || typeof client !== 'object') throw invalidArgument();
    this.bound = networkBinding(network);
    const registered = publicClientBinding(client as PublicClient),
      light = lightClientBinding(client as LightClient);
    this.registered = Boolean(registered ?? light);
    const other = networkBinding((registered ?? light)?.network ?? dataField(client, 'network') as Network);
    if (other.definition.binding !== this.bound.definition.binding) throw mismatch();
    this.endpoint = (registered ?? light)?.endpoint ?? null;
    this.protocolName = registered ? 'zcash-json-rpc/1' : 'lightwalletd-v0.5.0';
    for (const name of ['getTip', 'getTreeState', 'getTransaction', 'broadcastTransaction', 'getTransactionStatus']) {
      const method = dataField(client, name);
      if (method === undefined && name === 'getTransactionStatus') continue;
      if (typeof method !== 'function') throw invalidArgument();
      this.methods[name] = method as (...args: never[]) => unknown;
    }
  }

  private call(method: string, args: object): Promise<unknown> {
    return Promise.resolve().then(() => Reflect.apply(this.methods[method]!, this.client, [args]));
  }

  async route(): Promise<string | null> {
    if (this.endpoint === null) return null;
    const bytes = new TextEncoder().encode(
      JSON.stringify([this.protocolName, this.endpoint, this.bound.definition.binding]),
    );
    return sha256Hex(bytes);
  }

  private async tree(height: number, signal: AbortSignal): Promise<ChainPoint & { sourceId: string }> {
    if (!Number.isInteger(height) || height < 0 || height > 0xffffffff) throw protocol();
    const value = evidenceFields(
      await this.call('getTreeState', { height, signal }),
      ['network', 'point', 'sapling', 'ironwood', 'encoded', 'sourceId', 'observedAt'],
    );
    if (networkBinding(value.network).definition.binding !== this.bound.definition.binding) throw mismatch();
    const p = point(value.point);
    if (p.height !== height) throw protocol();
    const bytes = ownBytes(value.encoded, protocol, protocol, 65536);
    let decoded: unknown;
    try {
      decoded = initialize().decodeResponse('GetTreeState', bytes);
    } catch {
      throw protocol();
    }
    if (!decoded || typeof decoded !== 'object' || !('height' in decoded) || !('hash' in decoded)) throw protocol();
    if (decoded.height !== String(p.height) || decoded.hash !== p.hash) throw protocol();
    return { ...p, sourceId: sourceId(value.sourceId) };
  }

  async verify(signal: AbortSignal): Promise<string> {
    const pending = operation(signal);
    try {
      pending.check();
      if (this.registered) {
        const tip = evidenceFields(
          await pending.wait(this.call('getTip', { signal: pending.signal })),
          ['height', 'hash', 'sourceId', 'observedAt'],
        );
        point({ height: tip.height, hash: tip.hash });
        return sourceId(tip.sourceId);
      }
      const tree = await pending.wait(this.tree(0, pending.signal));
      if (tree.hash !== this.network.genesisHash) throw mismatch();
      return tree.sourceId;
    } finally {
      pending.close();
    }
  }

  private decodeEvidence(result: unknown, id: TxId, source: string) {
    if (result === null) return { state: 'notSeen' as const, priorInclusion: null, claimed: null };
    const transaction = evidenceFields(result, ['txid', 'raw', 'observation', 'sourceId', 'observedAt']);
    if (transaction.txid !== id || transaction.sourceId !== source) throw protocol();
    const evidence = observationEvidence(transaction.observation, id, source);
    const raw = ownBytes(transaction.raw, protocol, protocol, 2 * 1024 * 1024);
    const heights = evidence.claimed === null
      ? [0, ...this.bound.definition.parameters.heights.filter(h => h !== null)]
      : [evidence.claimed.height];
    const branches = new Set(heights.map(height => this.bound.codec.consensusContext(
      this.bound.definition.parametersFormat, this.bound.definition.parameters.bytes, height,
    ).branchId));
    for (const branch of branches) {
      try {
        if (this.bound.codec.decodeTransaction(raw, branch).display === id) return evidence;
      } catch { /* Existing native decoder tries registered branch contexts. */ }
    }
    throw protocol();
  }

  async observe(id: TxId, signal: AbortSignal): Promise<TransactionObservation> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.observeOnce(id, signal);
      } catch (error) {
        if (!(error instanceof Error) || !changedObservations.has(error)
          || attempt === 2 || signal.aborted) throw error;
        await delay(250, signal, () => failure('ABORTED', 'observation', 'none', 'Observation aborted.'));
      }
    }
  }

  private async observeOnce(id: TxId, signal: AbortSignal): Promise<TransactionObservation> {
    const pending = operation(signal);
    try {
      pending.check();
      const verifiedSource = await pending.wait(this.verify(pending.signal));
      const before = evidenceFields(
        await pending.wait(this.call('getTip', { signal: pending.signal })),
        ['height', 'hash', 'sourceId', 'observedAt'],
      );
      const tip = point({ height: before.height, hash: before.hash }),
        source = sourceId(before.sourceId);
      if (source !== verifiedSource) throw protocol();
      const method = this.methods.getTransactionStatus ? 'getTransactionStatus' : 'getTransaction';
      pending.check();
      const reply = await pending.wait(this.call(method, { txid: id, signal: pending.signal }));
      const evidence = method === 'getTransactionStatus'
        ? observationEvidence(reply, id, source)
        : this.decodeEvidence(reply, id, source);
      let inclusion: TransactionObservation['inclusion'] = null;
      if (evidence.claimed) {
        pending.check();
        const claimed = evidence.claimed,
          p = await pending.wait(this.tree(claimed.height, pending.signal));
        if (p.sourceId !== source) throw protocol();
        if (p.height > tip.height || (p.height === tip.height && p.hash !== tip.hash)
          || (claimed.blockHash !== null && claimed.blockHash !== p.hash)) {
          const latest = evidenceFields(await pending.wait(this.call('getTip', { signal: pending.signal })),
            ['height', 'hash', 'sourceId', 'observedAt']);
          if (latest.sourceId !== source) throw protocol();
          if (!same(tip, point({ height: latest.height, hash: latest.hash }))) throw changedObservation();
          // Independent server reads can publish inclusion before their latest-tip view.
          // Do not accept it or invent absence; wait for a coherent later observation.
          if (p.height > tip.height && (claimed.blockHash === null || claimed.blockHash === p.hash)) {
            throw changedObservation();
          }
          throw protocol();
        }
        inclusion = { height: p.height, blockHash: p.hash, confirmations: tip.height - p.height + 1 };
      }
      pending.check();
      const after = evidenceFields(
        await pending.wait(this.call('getTip', { signal: pending.signal })),
        ['height', 'hash', 'sourceId', 'observedAt'],
      );
      if (after.sourceId !== source) throw protocol();
      if (!same(tip, point({ height: after.height, hash: after.hash }))) throw changedObservation();
      pending.check();
      return {
        txid: txId(id),
        state: evidence.state,
        inclusion,
        tip,
        priorInclusion: evidence.priorInclusion,
        sourceId: source,
        observedAt: new Date().toISOString(),
      };
    } finally {
      pending.close();
    }
  }

  async broadcast(bytes: Uint8Array, id: TxId, expectedSource: string, signal: AbortSignal): Promise<BroadcastReport> {
    const reply = evidenceFields(
      await this.call('broadcastTransaction', { bytes, signal }),
      ['txid', 'outcome', 'diagnosticCode', 'sourceId', 'observedAt'],
    );
    if (reply.txid !== id) throw protocol();
    const outcome = reply.outcome;
    if (outcome !== 'acknowledged' && outcome !== 'rejected' && outcome !== 'unknown') throw protocol();
    if (sourceId(reply.sourceId) !== expectedSource) throw protocol();
    if (reply.diagnosticCode !== null
      && (typeof reply.diagnosticCode !== 'string'
        || !/^[-a-zA-Z0-9_:]{1,128}$/.test(reply.diagnosticCode))) throw protocol();
    const diagnostic = reply.diagnosticCode === null
      ? null
      : /^(grpc|rpc)-send:(-?[0-9]{1,10})$/.exec(reply.diagnosticCode);
    const diagnosticCode = diagnostic
      ? `${diagnostic[1]!.toUpperCase()}_SEND_${diagnostic[2]!.replace('-', 'NEG_')}`
      : null;
    return { txid: id, outcome, sourceId: expectedSource, diagnosticCode, observedAt: new Date().toISOString() };
  }
}
