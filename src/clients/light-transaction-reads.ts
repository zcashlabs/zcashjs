import type {
  CustomLightTransport, LightUnaryMethod, LightStreamMethod, Op, TxId,
  PublicTransaction, BroadcastReport, SubtreeRoot, SubtreeRequest, HeightRange,
} from '../types.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';
import { txId, blockHash } from '../primitives.js';
import { ownBytes } from './owned-plumbing.js';
import { admit, operation } from './light-chain-reads.js';
import { isGrpcNotFound } from './grpc-status.js';

export interface LightTransactionSource {
  readonly wire: {
    encodeRequest(method: LightUnaryMethod | LightStreamMethod, json: string): Uint8Array;
    decodeResponse(method: LightUnaryMethod, bytes: Uint8Array): unknown;
    decodeItem(method: LightStreamMethod, bytes: Uint8Array): unknown;
  };
  readonly transport: CustomLightTransport;
  // null denotes absent mined context, including mempool, off-chain and submission.
  decodeTransaction(raw: Uint8Array, height: number | null): PromiseLike<{
    bytes: Uint8Array; txid: Uint8Array; display: string;
  }> | { bytes: Uint8Array; txid: Uint8Array; display: string };
  validateAddress(address: string): string;
}
const protocol = () => failure('PROTOCOL_MISMATCH', 'query', 'configure', 'Invalid light transaction response.');
const resource = () => failure('RESOURCE_LIMIT', 'query', 'configure', 'Light transaction limit exceeded.');
const transportError = () => failure('TRANSPORT_ERROR', 'transport', 'configure', 'Light request failed.');
const hex = (bytes: Uint8Array) => {
  const text = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    const high = bytes[i]! >>> 4,
      low = bytes[i]! & 15;
    text[2 * i] = high + (high < 10 ? 48 : 87);
    text[2 * i + 1] = low + (low < 10 ? 48 : 87);
  }
  return new TextDecoder().decode(text);
};
function bytes(value: unknown, size?: number): Uint8Array {
  if (typeof value !== 'string' || value.length > 8 * 1024 * 1024 || !/^(?:[0-9a-f]{2})*$/.test(value)
    || (size !== undefined && value.length !== size * 2)) throw protocol();
  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i++) output[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return output;
}
function height(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(value)
    || BigInt(value) > 0xffffffffn) throw protocol();
  return Number(value);
}
function encode(source: LightTransactionSource, method: LightUnaryMethod | LightStreamMethod, input: object) {
  try {
    return ownBytes(source.wire.encodeRequest(method, JSON.stringify(input)), protocol, resource);
  } catch (error) {
    throw isZcashError(error) ? error : protocol();
  }
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
async function decoded(source: LightTransactionSource, raw: Uint8Array, minedHeight: number | null) {
  let result;
  try {
    result = await source.decodeTransaction(new Uint8Array(raw), minedHeight);
  } catch (error) {
    throw isZcashError(error) ? error : protocol();
  }
  const owned = ownBytes(result.bytes, protocol, resource),
    id = ownBytes(result.txid, protocol, resource);
  if (!equalBytes(owned, raw) || id.length !== 32 || hex(id.reverse()) !== result.display) throw protocol();
  return { raw: owned, txid: txId(result.display) };
}
async function transaction(
  source: LightTransactionSource,
  dto: unknown,
  sourceId: string,
  mempool = false,
): Promise<PublicTransaction> {
  if (!dto || typeof dto !== 'object') throw protocol();
  const value = dto as { data: unknown; height: unknown };
  // GetMempoolStream uses height as a tip marker, not transaction inclusion.
  if (mempool) height(value.height);
  const state = mempool || value.height === '0'
    ? 'mempool'
    : value.height === '18446744073709551615' ? 'offMainChain' : 'mined';
  const minedHeight = state === 'mined' ? height(value.height) : null;
  const raw = bytes(value.data);
  if (!raw.length) throw protocol();
  let result;
  try {
    result = await decoded(source, raw, minedHeight);
  } catch (error) {
    // These bytes came from the endpoint; caller input errors remain distinct on submission.
    if (isZcashError(error) && error.code === 'INVALID_ARGUMENT') throw protocol();
    throw error;
  }
  const observation = { sourceId, observedAt: new Date().toISOString() };
  return {
    ...result,
    ...observation,
    observation: {
      ...observation,
      txid: result.txid,
      state,
      inclusion: minedHeight === null ? null : { height: minedHeight, blockHash: null, confirmations: null },
      tip: null,
      priorInclusion: null,
    },
  };
}

/** Successful absence is only a qualified adapter's NOT_FOUND wire status. */
export async function getTransaction(
  source: LightTransactionSource,
  args: { txid: TxId } & Op,
): Promise<PublicTransaction | null> {
  const sourceId = admit(source.transport, args, ['txid', 'signal']),
    requested = txId(args.txid);
  const pending = operation(args.signal);
  try {
    pending.check();
    const request = encode(source, 'GetTransaction', { hash: hex(bytes(requested, 32).reverse()) });
    pending.check();
    let response;
    const unary = source.transport.unary;
    pending.check();
    try {
      response = await pending.wait(
        Reflect.apply(unary, source.transport, [{ method: 'GetTransaction', request, signal: pending.signal }]),
      );
    } catch (error) {
      pending.check();
      if (isGrpcNotFound(error)) return null;
      throw error;
    }
    pending.check();
    let dto;
    try {
      dto = source.wire.decodeResponse('GetTransaction', ownBytes(response, protocol, resource));
    } catch {
      throw protocol();
    }
    const result = await pending.wait(transaction(source, dto, sourceId));
    pending.check();
    if (result.txid !== requested) throw protocol();
    return result;
  } catch (error) {
    pending.check();
    throw isZcashError(error) ? error : transportError();
  } finally {
    pending.close();
    pending.check();
  }
}

// Three wire streams share the same pull/return/cancellation boundary. No background prefetch.
function stream<T>(
  source: LightTransactionSource,
  method: LightStreamMethod,
  input: object,
  signal: AbortSignal | undefined,
  project: (dto: unknown, index: number) => T | PromiseLike<T>,
  maxItems = 65536,
): AsyncIterableIterator<T> {
  let iterator: AsyncIterator<Uint8Array> | undefined,
    iterable: AsyncIterable<Uint8Array> | undefined;
  let pending: ReturnType<typeof operation> | undefined,
    finished = false,
    busy = false,
    released = false,
    count = 0,
    total = 0;
  function release() {
    if (released) return;
    const acquired = iterator ?? iterable as Partial<AsyncIterator<Uint8Array>> | undefined;
    if (!acquired) return;
    released = true;
    try {
      void Promise.resolve(acquired.return?.()).catch(() => { });
    } catch { /* Best effort custom transport release. */ }
  }
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (finished) return { done: true, value: undefined };
      if (busy) throw invalidArgument();
      busy = true;
      try {
        if (!pending) {
          pending = operation(signal, release);
          pending.check();
          const request = encode(source, method, input);
          pending.check();
          const start = source.transport.stream;
          pending.check();
          iterable = Reflect.apply(start, source.transport, [{ method, request, signal: pending.signal }]);
          pending.check();
          const acquire = iterable![Symbol.asyncIterator];
          pending.check();
          iterator = Reflect.apply(acquire, iterable, []);
          pending.check();
        }
        const next = iterator!.next;
        pending.check();
        const item = await pending.wait(Reflect.apply(next, iterator, []));
        pending.check();
        if (item.done) {
          finished = true;
          pending.close();
          pending.check();
          return { done: true, value: undefined };
        }
        const raw = ownBytes(item.value, protocol, resource);
        total += raw.length;
        if (count >= maxItems || total > 64 * 1024 * 1024) throw resource();
        let dto;
        try {
          dto = source.wire.decodeItem(method, raw);
        } catch {
          throw protocol();
        }
        const value = await pending.wait(project(dto, count++));
        pending.check();
        return { done: false, value };
      } catch (error) {
        finished = true;
        try {
          pending?.check();
        } finally {
          pending?.close();
          release();
        }
        throw isZcashError(error) ? error : transportError();
      } finally {
        busy = false;
      }
    },
    async return() {
      if (!finished) {
        finished = true;
        pending?.cancel();
      }
      return { done: true, value: undefined };
    },
  };
}

export function getSubtreeRoots(
  source: LightTransactionSource,
  args: SubtreeRequest & Op,
): AsyncIterableIterator<SubtreeRoot> {
  const sourceId = admit(source.transport, args, ['pool', 'startIndex', 'limit', 'signal']);
  const { pool, startIndex, limit, signal } = args;
  if (!['sapling', 'ironwood'].includes(pool) || typeof startIndex !== 'bigint'
    || startIndex < 0n
    || startIndex > 0xffffffffn

    || !Number.isInteger(limit)
    || limit < 1
    || limit > 1024
    || startIndex + BigInt(limit) > 0x100000000n) throw invalidArgument();
  let previous = -1;
  return stream(
    source,
    'GetSubtreeRoots',
    { start_index: Number(startIndex), shielded_protocol: pool === 'sapling' ? 0 : 2, max_entries: limit },
    signal,
    (dto, index) => {
      if (!dto || typeof dto !== 'object') throw protocol();
      const value = dto as { root_hash: unknown; completing_block_hash: unknown; completing_block_height: unknown };
      const completingHeight = height(value.completing_block_height);
      if (completingHeight < previous) throw protocol();
      previous = completingHeight;
      return {
        pool,
        index: startIndex + BigInt(index),
        root: bytes(value.root_hash, 32),
        completingBlock: {
          height: completingHeight,
          hash: blockHash(hex(bytes(value.completing_block_hash, 32).reverse())),
        },
        sourceId,
        observedAt: new Date().toISOString(),
      };
    },
    limit,
  );
}
export function streamAddressTransactions(
  source: LightTransactionSource,
  args: { address: string } & HeightRange & Op,
): AsyncIterableIterator<PublicTransaction> {
  const sourceId = admit(source.transport, args, ['address', 'fromHeight', 'toHeight', 'signal']);
  const { fromHeight, toHeight, signal } = args;
  if (!Number.isInteger(fromHeight) || !Number.isInteger(toHeight)
    || fromHeight < 0
    || toHeight > 0xffffffff
    || toHeight < fromHeight) throw invalidArgument();
  const address = source.validateAddress(args.address);
  return stream(
    source,
    'GetTaddressTransactions',
    { address, range: { start: { height: String(fromHeight) }, end: { height: String(toHeight) } } },
    signal,
    async (dto) => {
      const result = await transaction(source, dto, sourceId);
      if (result.observation.inclusion === null
        || result.observation.inclusion.height < fromHeight
        || result.observation.inclusion.height > toHeight) throw protocol();
      return result;
    },
  );
}
export function streamMempool(source: LightTransactionSource, args: Op = {}): AsyncIterableIterator<PublicTransaction> {
  const sourceId = admit(source.transport, args, ['signal']);
  return stream(source, 'GetMempoolStream', {}, args.signal, async (dto) => {
    const result = await transaction(source, dto, sourceId, true);
    return result;
  });
}

export async function broadcastTransaction(
  source: LightTransactionSource,
  args: { bytes: Uint8Array } & Op,
): Promise<BroadcastReport> {
  const sourceId = admit(source.transport, args, ['bytes', 'signal']);
  const raw = ownBytes(args.bytes, invalidArgument, resource),
    pending = operation(args.signal);
  try {
    pending.check();
    if (!raw.length) throw invalidArgument();
    const result = await pending.wait(decoded(source, raw, null));
    pending.check();
    const request = encode(source, 'SendTransaction', { data: hex(raw), height: '0' });
    pending.check();
    const unary = source.transport.unary;
    pending.check();
    let outcome: BroadcastReport['outcome'] = 'unknown',
      diagnosticCode: string | null = null;
    // Once the transport is invoked, any missing/invalid response leaves submission unknown.
    try {
      const response = await pending.wait(
        Reflect.apply(unary, source.transport, [{ method: 'SendTransaction', request, signal: pending.signal }]),
      );
      pending.check();
      const dto = source.wire.decodeResponse('SendTransaction', ownBytes(response, protocol, resource)) as {
        error_code: unknown;
        error_message: unknown;
      };
      if (!dto || typeof dto.error_code !== 'number'
        || !Number.isInteger(dto.error_code)
        || dto.error_code < -2147483648
        || dto.error_code > 2147483647) throw protocol();
      // Zaino returns a plain display txid; lightwalletd returns the JSON-quoted result.
      // A successful status alone cannot acknowledge different or unidentified bytes.
      if (dto.error_code === 0 && (typeof dto.error_message !== 'string'
        || (dto.error_message !== result.txid && JSON.parse(dto.error_message) !== result.txid))) throw protocol();
      outcome = dto.error_code === 0 ? 'acknowledged' : 'rejected';
      diagnosticCode = dto.error_code === 0 ? null : `grpc-send:${dto.error_code}`;
    } catch { /* No retry, and no raw provider message or exception escapes into the report. */ }
    return { txid: result.txid, sourceId, observedAt: new Date().toISOString(), outcome, diagnosticCode };
  } finally {
    pending.close();
  }
}
