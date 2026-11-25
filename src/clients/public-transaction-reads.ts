import { bridgeSignal, signalAborted } from '../abort.js';
import { copyRecord } from './owned-plumbing.js';
import type { HttpTransport, Op, PublicTransaction, TxId, Inclusion, TransactionObservation } from '../types.js';
import { readRpc, rpcErrorCode } from '../http.js';
import { failure, invalidArgument } from '../errors.js';
import type { Json } from '../json.js';
import { JsonNumber, protocolError } from '../json.js';
import { txId, blockHash } from '../primitives.js';
import { getBlock } from './public-block-reads.js';

function checkAbort(signal?: AbortSignal): void {
  if (signal && signalAborted.call(signal)) throw failure('ABORTED', 'transport', 'none', 'Request aborted.');
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (!(value instanceof JsonNumber) || !/^(?:0|-?[1-9][0-9]*)$/.test(value.text)) throw protocolError();
  const number = Number(value.text);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw protocolError();
  return number;
}

interface TransactionDto {
  readonly raw: Uint8Array;
  readonly hash: ReturnType<typeof blockHash> | undefined;
  readonly height: number | undefined;
  readonly confirmations: number | undefined;
  readonly active: boolean;
}

function transactionDto(value: Json, requested: TxId): TransactionDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || value instanceof JsonNumber) throw protocolError();
  if (typeof value.txid !== 'string' || typeof value.in_active_chain !== 'boolean') throw protocolError();
  let hash: TransactionDto['hash'];
  try {
    if (txId(value.txid) !== requested) throw protocolError();
    if (Object.hasOwn(value, 'blockhash')) {
      if (typeof value.blockhash !== 'string') throw protocolError();
      hash = blockHash(value.blockhash);
    }
  } catch {
    throw protocolError();
  }
  const height = Object.hasOwn(value, 'height') ? integer(value.height, -1, 0x7fff_ffff) : undefined;
  const confirmations = Object.hasOwn(value, 'confirmations')
    ? integer(value.confirmations, 0, Number.MAX_SAFE_INTEGER)
    : undefined;
  if (typeof value.hex !== 'string' || !value.hex.length || value.hex.length > 4194304
    || value.hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value.hex)) throw protocolError();
  const raw = new Uint8Array(value.hex.length / 2);
  for (let i = 0; i < raw.length; i++) {
    const high = value.hex.charCodeAt(i * 2);
    const low = value.hex.charCodeAt(i * 2 + 1);
    raw[i] = ((high <= 57 ? high - 48 : high - 87) << 4) | (low <= 57 ? low - 48 : low - 87);
  }
  return {
    raw,
    hash,
    height,
    confirmations,
    active: value.in_active_chain,
  };
}

function matchesDecoded(value: unknown, raw: Uint8Array, requested: TxId): void {
  if (!value || typeof value !== 'object' || !('bytes' in value) || !('txid' in value)
    || !('display' in value)) throw protocolError();
  if (!(value.bytes instanceof Uint8Array) || !(value.txid instanceof Uint8Array)
    || value.bytes.length !== raw.length || value.bytes.some((byte, i) => byte !== raw[i])
    || value.txid.length !== 32 || value.display !== requested

    || Array.from(value.txid).reverse().map(
      byte => byte.toString(16).padStart(2, '0'),
    ).join('') !== requested) {
    throw protocolError();
  }
}

function transactionState(dto: TransactionDto): 'mempool' | 'offMainChain' | 'unknown' {
  const { active, hash, height, confirmations } = dto;
  if (!active && hash === undefined && height === undefined && confirmations === undefined) return 'mempool';
  if (!active && hash !== undefined && height === -1 && confirmations === 0) return 'offMainChain';
  if (active && height !== undefined && height >= 0
    && confirmations !== undefined
    && confirmations > 0) return 'unknown';
  throw protocolError();
}

/** Internal transaction read. Owner establishes source/network and historical context.
 * Only a qualified initial transaction lookup can return absence.
 */
export async function getTransaction(
  source: { readonly transport: HttpTransport; readonly sourceId: string },
  context: {
    readonly txid: TxId;
    readonly decodeTransaction: (raw: Uint8Array, height: number | null) => {
      readonly bytes: Uint8Array; readonly txid: Uint8Array; readonly display: string;
    };
  },
  args: { readonly txid: TxId } & Op,
): Promise<PublicTransaction | null> {
  source = copyRecord(source, ['transport', 'sourceId']);
  context = copyRecord(context, ['txid', 'decodeTransaction']);
  args = copyRecord(args, ['txid', 'signal']);
  const { transport, sourceId } = source;
  const { decodeTransaction } = context;
  const requested = txId(args.txid);
  if (typeof sourceId !== 'string' || !sourceId.trim() || context.txid !== requested
    || typeof decodeTransaction !== 'function') throw invalidArgument();
  const owned = await bridgeSignal(args.signal);
  const { signal } = owned;
  try {
    checkAbort(signal);
    let value;
    try {
      value = await readRpc(transport, 'getrawtransaction', [requested, 1], signal);
    } catch (error) {
      if (rpcErrorCode(error) === -5) return null;
      throw error;
    }
    checkAbort(signal);
    const dto = transactionDto(value, requested);
    const { raw, height, hash } = dto;
    try {
      checkAbort(signal);
      const decoded = decodeTransaction(raw.slice(), dto.active && height !== undefined && height >= 0 ? height : null);
      checkAbort(signal);
      matchesDecoded(decoded, raw, requested);
    } catch {
      checkAbort(signal);
      throw protocolError();
    }
    let state: TransactionObservation['state'] = transactionState(dto);
    let inclusion: Inclusion | null = null;
    if (state === 'unknown' && hash !== undefined) {
      const block = await getBlock(
        { transport, sourceId },
        { height: height!, ...(signal === undefined ? {} : { signal }) },
      );
      checkAbort(signal);
      // Only the initial transaction lookup can establish absence. A changed block retains uncertainty.
      if (block === null) throw protocolError();
      if (block.point.hash === hash) {
        if (block.point.height !== height || !block.txids.includes(requested)) throw protocolError();
        state = 'mined';
        inclusion = Object.freeze({ height: height!, blockHash: hash, confirmations: null });
      }
    }
    checkAbort(signal);
    const observedAt = new Date().toISOString();
    return Object.freeze({
      txid: requested,
      raw: raw.slice(),
      sourceId,
      observedAt,
      observation: Object.freeze({
        txid: requested,
        state,
        inclusion,
        tip: null,
        priorInclusion: null,
        sourceId,
        observedAt,
      }),
    });
  } catch (error) {
    checkAbort(signal);
    throw error;
  } finally {
    try {
      owned.close();
    } catch { /* Cleanup must not replace the outcome. */ }
  }
}
