import type { LightClient, PublicTransaction, TxId } from '../types.js';
import { failure } from '../errors.js';
import { snapshot, ownBytes } from '../clients/owned-plumbing.js';
import { operation } from '../clients/light-chain-reads.js';
import { blockHash, txId } from '../primitives.js';
import type { attachWalletWorker } from './host.js';
import type { EnhancementRequest, EnhancementResult } from './session.js';

type Session = ReturnType<typeof attachWalletWorker>;
const unsupported = () => failure(
  'METHOD_NOT_SUPPORTED',
  'sync',
  'configure',
  'Enhancement request needs unsupported source evidence.',
);
const protocol = () => failure(
  'PROTOCOL_MISMATCH',
  'sync',
  'sync',
  'Enhancement response does not match the requested range.',
);
const limit = () => failure('RESOURCE_LIMIT', 'sync', 'configure', 'Enhancement transaction exceeds batch limit.');

/**
 * One backend request. Only successful stream exhaustion completes address coverage.
 * Resolves true when an unspent-address inventory was committed for the current tip,
 * false when it was deferred; other request kinds resolve undefined.
 */
export async function applyEnhancement(session: Session, light: LightClient, revision: string,
  request: EnhancementRequest, signal?: AbortSignal): Promise<boolean | undefined> {
  const op = signal === undefined ? {} : { signal };
  const apply = async (result: EnhancementResult) => {
    revision = (await session.enhancement.apply({ revision, request, result, ...op })).revision;
  };
  if (request.kind !== 'address') {
    const transaction = await light.getTransaction({ txid: request.txid as TxId, ...op });
    if (transaction === null) {
      await apply({ status: 'notRecognized' });
      return;
    }
    if (transaction.txid !== request.txid) throw protocol();
    const mined = transaction.observation.state === 'mined' ? transaction.observation.inclusion?.height : null;
    if (transaction.observation.state === 'mined' && mined === undefined) throw protocol();
    if (request.kind === 'enhancement') {
      if (transaction.raw.length > 2 * 1024 * 1024) throw limit();
      await apply({ transactions: [{ bytes: transaction.raw, minedHeight: mined ?? null }] });
    } else if (mined !== null && mined !== undefined) await apply({ status: 'mined', height: mined });
    else if (['mempool', 'offMainChain'].includes(transaction.observation.state)) {
      await apply({ status: 'notInMainChain' });
    } else throw protocol();
    return;
  }
  if (request.txStatus === 'all' && request.outputStatus === 'unspent' && request.endExclusive === null) {
    return unspent(session, light, revision, request, signal);
  }
  if (request.txStatus !== 'mined' || request.outputStatus !== 'all'
    || request.endExclusive === null) throw unsupported();
  const asOfHeight = request.endExclusive - 1;
  let batch: { bytes: Uint8Array; minedHeight: number }[] = [],
    bytes = 0;
  const flush = async (complete: boolean) => {
    await apply({ transactions: batch, asOfHeight, complete });
    batch = [];
    bytes = 0;
    if (!complete) {
      const pending = await session.enhancement.requests(op);
      revision = pending.revision;
      return pending.requests.some(value => JSON.stringify(value) === JSON.stringify(request));
    }
    return false;
  };
  for await (const transaction of light.streamAddressTransactions({
    address: request.address,
    fromHeight: request.start,
    toHeight: asOfHeight,
    ...op,
  })) {
    const height = minedHeight(transaction);
    if (height < request.start || height >= request.endExclusive) throw protocol();
    if (transaction.raw.length > 2 * 1024 * 1024) throw limit();
    if (batch.length === 16 || bytes + transaction.raw.length > 2 * 1024 * 1024) {
      if (!await flush(false)) return; // Rust may have resolved the request by discovering its spend.
    }
    batch.push({ bytes: transaction.raw, minedHeight: height });
    bytes += transaction.raw.length;
  }
  await flush(true);
}

function minedHeight(transaction: PublicTransaction): number {
  const height = transaction.observation.inclusion?.height;
  if (transaction.observation.state !== 'mined' || height === undefined
    || !Number.isInteger(height)
    || height < 0) throw protocol();
  return height;
}

function evidence(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    return snapshot(value, keys);
  } catch {
    throw protocol();
  }
}
function sourcePoint(value: unknown) {
  const point = evidence(value, ['height', 'hash', 'sourceId', 'observedAt']);
  if (typeof point.height !== 'number' || !Number.isInteger(point.height) || point.height < 0
    || point.height > 0xffffffff || typeof point.hash !== 'string'
    || typeof point.sourceId !== 'string' || !point.sourceId.length || point.sourceId.length > 256) throw protocol();
  try {
    return { height: point.height, hash: blockHash(point.hash), sourceId: point.sourceId };
  } catch {
    throw protocol();
  }
}
type SourcePoint = ReturnType<typeof sourcePoint>;
type UnspentOutput = { outputIndex: number; script: Uint8Array; value: bigint };
type UnspentGroup = { height: number | null; outputs: UnspentOutput[] };

function unspentItem(value: unknown, address: string, tipHeight: number) {
  const item = evidence(value, ['txid', 'outputIndex', 'address', 'value', 'script', 'minedHeight']);
  if (typeof item.txid !== 'string') throw protocol();
  let id: TxId;
  try {
    id = txId(item.txid);
  } catch {
    throw protocol();
  }
  if (item.address !== address || typeof item.outputIndex !== 'number' || !Number.isInteger(item.outputIndex)

    || item.outputIndex < 0
    || item.outputIndex > 0xffffffff
    || typeof item.value !== 'bigint'
    || item.value < 0n) throw protocol();
  if (item.minedHeight !== null && (typeof item.minedHeight !== 'number' || !Number.isInteger(item.minedHeight)
    || item.minedHeight < 0 || item.minedHeight > tipHeight)) throw protocol();
  return { id, outputIndex: item.outputIndex, value: item.value, minedHeight: item.minedHeight, script: item.script };
}

function unspentInventory(value: unknown, before: SourcePoint, address: string, start: number) {
  const response = evidence(value, ['items', 'tip', 'sourceId', 'observedAt']);
  if (response.sourceId !== before.sourceId || !Array.isArray(response.items)) throw protocol();
  const count: unknown = Object.getOwnPropertyDescriptor(response.items, 'length')?.value;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1000) throw limit();
  if (response.tip !== null) {
    const tip = evidence(response.tip, ['height', 'hash']);
    if (tip.height !== before.height || tip.hash !== before.hash) throw protocol();
  }
  const seen = new Set<string>(),
    groups = new Map<TxId, UnspentGroup>();
  let scripts = 0;
  for (let i = 0; i < count; i++) {
    const field = Object.getOwnPropertyDescriptor(response.items, String(i));
    if (!field || !('value' in field)) throw protocol();
    const item = unspentItem(field.value, address, before.height);
    const id = item.id;
    const key = id + ':' + item.outputIndex;
    if (seen.has(key)) throw protocol();
    seen.add(key);
    const script = ownBytes(item.script, protocol, limit, Math.min(10000, 2 * 1024 * 1024 - scripts));
    scripts += script.length;
    if (item.minedHeight !== null && item.minedHeight < start) continue;
    const group = groups.get(id) ?? { height: item.minedHeight, outputs: [] };
    if (group.height !== item.minedHeight) throw protocol();
    group.outputs.push({ outputIndex: item.outputIndex, script, value: item.value });
    groups.set(id, group);
  }
  return groups;
}

function unspentTransaction(value: unknown, id: TxId, sourceId: string, height: number | null, maximum: number) {
  const transaction = evidence(value, ['txid', 'raw', 'observation', 'sourceId', 'observedAt']);
  const observed = evidence(
    transaction.observation,
    ['txid', 'state', 'inclusion', 'tip', 'priorInclusion', 'sourceId', 'observedAt'],
  );
  if (transaction.txid !== id || transaction.sourceId !== sourceId
    || observed.txid !== id
    || observed.sourceId !== sourceId) throw protocol();
  if (observed.state === 'mined') {
    const inclusion = evidence(observed.inclusion, ['height', 'blockHash', 'confirmations']);
    if (typeof inclusion.height !== 'number' || !Number.isInteger(inclusion.height)
      || inclusion.height !== height) throw protocol();
  } else if (observed.state !== 'mempool' || observed.inclusion !== null || height !== null) throw protocol();
  return ownBytes(transaction.raw, protocol, limit, maximum);
}

/** A positive UTXO inventory does not prove absence or complete address history. */
async function unspent(session: Session, light: LightClient, revision: string,
  request: Extract<EnhancementRequest, { kind: 'address' }>, signal?: AbortSignal): Promise<boolean> {
  const pending = operation(signal),
    op = { signal: pending.signal };
  try {
    pending.check();
    const before = sourcePoint(await pending.wait(light.getTip(op)));
    const local = await session.scan.state(op),
      block = await session.scan.block({ height: before.height, ...op });
    const nativeHash = before.hash.match(/../g)!.reverse().join('');
    if (local.revision !== revision || block.revision !== revision) {
      throw failure('CURSOR_STALE', 'sync', 'sync', 'Wallet changed before unspent enhancement.');
    }
    // A finite scan owns its captured target, not the latest tip. Leave this native
    // request pending for a later scan; never advance an explicit historical target.
    if (local.tipHeight !== null && before.height > local.tipHeight) return false;
    if (block.point?.height !== before.height
      || block.point.hash !== nativeHash) {
      throw failure(
        'RECOVERY_REQUIRED',
        'sync',
        'sync',
        'Source tip is not the retained native chain point.',
      );
    }
    if (local.tipHeight !== before.height) return false;
    const response = await pending.wait(light.getAddressUtxos({ addresses: [request.address], ...op }));
    const groups = unspentInventory(response, before, request.address, request.start);
    const batch: { txid: TxId; bytes: Uint8Array; minedHeight: number | null; unspentOutputs: UnspentOutput[] }[] = [];
    let bytes = 0;
    for (const [id, group] of groups) {
      pending.check();
      const supplied = await pending.wait(light.getTransaction({ txid: id, ...op }));
      const scriptBytes = group.outputs.reduce((n, output) => n + output.script.length, 0);
      const raw = unspentTransaction(
        supplied,
        id,
        before.sourceId,
        group.height,
        2 * 1024 * 1024 - bytes - scriptBytes,
      );
      batch.push({ txid: id, bytes: raw, minedHeight: group.height, unspentOutputs: group.outputs });
      bytes += raw.length + scriptBytes;
    }
    pending.check();
    const after = sourcePoint(await pending.wait(light.getTip(op)));
    if (after.sourceId !== before.sourceId) throw protocol();
    // The inventory was gathered across a moving view. Discard it, keeping the
    // native request outstanding; sync's final target pin still checks chain identity.
    if (after.height !== before.height || after.hash !== before.hash) return false;
    pending.check();
    await session.enhancement.apply({
      revision,
      request,
      result: {
        transactions: batch, asOfHeight: before.height, asOfHash: nativeHash, complete: true,
      },
      ...op,
    });
    return true;
  } finally {
    pending.close();
  }
}
