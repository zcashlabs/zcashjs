import { signalAborted, admitSignal, waitFor, anySignal } from '../abort.js';
import type {
  BlockSelector,
  Network,
  TreeState,
  ChainTip,
  CompactBlock,
  HeightRange,
  CustomLightTransport,
  Op,
} from '../types.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';
import { blockHash } from '../primitives.js';
import { ownBytes } from './owned-plumbing.js';
import { matchesLightNetwork } from './light-server-observation.js';

// Structural view of the accepted initialized codec instance; no acquisition or initialization.
interface Lightwire {
  encodeTreeState(json: string): Uint8Array;
  encodeRequest(method: 'GetLatestBlock' | 'GetBlockRange' | 'GetTreeState', json: string): Uint8Array;
  decodeResponse(method: 'GetLatestBlock' | 'GetTreeState', bytes: Uint8Array): unknown;
  decodeItem(method: 'GetBlockRange', bytes: Uint8Array): unknown;
}

// Exact service.proto and compact_formats.proto SHA256 pair; not LightdInfo's wire version.
const revision = 'lightwire:80575dbe59a9bf2e6b79e2391eb78679c453f1a0477292eb97ea3b58bb6c8b10:d8d0c8aaa5ceec7d5dcc188ef25b04011df2ec0254901620fce982fc13aeb32d';
const protocol = () => failure(
  'PROTOCOL_MISMATCH',
  'query',
  'configure',
  'Invalid light-chain response or schema revision.',
);
const transportFailure = () => failure('TRANSPORT_ERROR', 'transport', 'configure', 'Light-chain request failed.');

export function admit(transport: CustomLightTransport, args: Op, keys: readonly string[]): string {
  try {
    if (transport.protocolRevision !== revision) throw protocol();
    const sourceId = transport.sourceId;
    if (transport.kind !== 'custom-lightwallet' || typeof sourceId !== 'string'
      || !sourceId.length || sourceId.length > 256) throw invalidArgument();
    if (!args || typeof args !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(args))
      || Reflect.ownKeys(args).some(key => typeof key !== 'string' || !keys.includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(args, key)!, 'value'))) throw invalidArgument();
    admitSignal(args.signal);
    return sourceId;
  } catch (error) {
    throw isZcashError(error) ? error : invalidArgument();
  }
}
function point(dto: unknown) {
  if (!dto || typeof dto !== 'object') throw protocol();
  const { height, hash } = dto as { height: unknown; hash: unknown };
  if (typeof height !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(height)
    || BigInt(height) > 0xffff_ffffn) throw protocol();
  return { height: Number(height), hash: wireBlockHash(hash) };
}
// These two methods carry protocol-order block hashes. This is NOT a TreeState hash adapter.
function wireBlockHash(hash: unknown) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw protocol();
  return blockHash(hash.match(/../g)!.reverse().join(''));
}

const aborted = () => failure('ABORTED', 'query', 'none', 'Light-chain read aborted.');

// Native dependent signals propagate cancellation independently of caller event listeners.
// Keep the dependent signal private: synthetic events on the caller/transport signal cannot cancel us.
export function operation(signal: AbortSignal | undefined, release: () => void = () => { }) {
  admitSignal(signal);
  const controller = new AbortController();
  const dependent = signal === undefined ? undefined : anySignal([signal]);
  let cancelled = false,
    closed = false;
  const interruption = new AbortController();
  function close() {
    if (closed) return;
    closed = true;
    dependent?.removeEventListener('abort', cancel);
    controller.abort();
    release();
  }
  function cancel() {
    if (cancelled || closed) return;
    cancelled = true;
    interruption.abort();
    close();
  }
  function check() {
    if (signal !== undefined && signalAborted.call(signal)) {
      cancel();
      throw aborted();
    }
    if (cancelled) throw aborted();
  }
  dependent?.addEventListener('abort', cancel, { once: true });
  return {
    signal: controller.signal,
    cancel,
    check,
    close,
    wait<T>(value: PromiseLike<T> | T): Promise<T> {
      return waitFor(value, interruption.signal, aborted);
    },
  };
}

/** Internal composition only. Caller supplies the accepted initialized lightwire instance. */
export async function getTip(codec: Lightwire, transport: CustomLightTransport, args: Op = {}): Promise<ChainTip> {
  const sourceId = admit(transport, args, ['signal']);
  const pending = operation(args.signal);
  try {
    pending.check();
    let request: Uint8Array;
    try {
      request = codec.encodeRequest('GetLatestBlock', '{}');
    } catch {
      throw protocol();
    }
    pending.check();
    const unary = transport.unary;
    pending.check();
    const bytes = await pending.wait(
      Reflect.apply(unary, transport, [{ method: 'GetLatestBlock', request, signal: pending.signal }]),
    );
    pending.check();
    let checked;
    try {
      checked = point(codec.decodeResponse('GetLatestBlock', ownBytes(bytes, protocol, resourceLimit)));
    } catch (error) {
      throw isZcashError(error) ? error : protocol();
    }
    pending.check();
    return { ...checked, sourceId, observedAt: new Date().toISOString() };
  } catch (error) {
    pending.check();
    throw isZcashError(error) ? error : transportFailure();
  } finally {
    pending.close();
    pending.check();
  }
}
const resourceLimit = () => failure('RESOURCE_LIMIT', 'query', 'configure', 'Light-chain byte limit exceeded.');

/** Internal finite range; successful exhaustion is required for complete coverage. */
export function streamCompactBlocks(codec: Lightwire, transport: CustomLightTransport,
  args: HeightRange & Op): AsyncIterableIterator<CompactBlock> {
  const sourceId = admit(transport, args, ['fromHeight', 'toHeight', 'signal']);
  const { fromHeight, toHeight, signal } = args;
  if (!Number.isInteger(fromHeight) || !Number.isInteger(toHeight) || fromHeight < 0
    || toHeight > 0xffff_ffff || toHeight < fromHeight || toHeight - fromHeight >= 1024) throw invalidArgument();
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let iterable: (AsyncIterable<Uint8Array> & Partial<AsyncIterator<Uint8Array>>) | undefined;
  let pending: ReturnType<typeof operation> | undefined;
  let height = fromHeight,
    previous: string | undefined,
    total = 0;
  let finished = false,
    busy = false,
    released = false;
  function release(acquired: Partial<AsyncIterator<Uint8Array>> | undefined = iterator) {
    if (!acquired || released) return;
    released = true;
    try {
      void Promise.resolve(acquired.return?.()).catch(() => { });
    } catch { /* Release is best effort for an uncooperative custom transport; never replace the outcome. */ }
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
          let request: Uint8Array;
          try {
            request = codec.encodeRequest('GetBlockRange', JSON.stringify({
              start: { height: String(fromHeight) }, end: { height: String(toHeight) },
            }));
          } catch {
            throw protocol();
          }
          pending.check();
          const stream = transport.stream;
          pending.check();
          iterable = Reflect.apply(stream, transport, [{ method: 'GetBlockRange', request, signal: pending.signal }]);
          pending.check();
          const acquire = iterable[Symbol.asyncIterator];
          pending.check();
          iterator = Reflect.apply(acquire, iterable, []);
        }
        pending.check();
        const next = iterator!.next;
        pending.check();
        const item = await pending.wait(Reflect.apply(next, iterator, []));
        pending.check();
        if (item.done) {
          if (height !== toHeight + 1) throw protocol();
          finished = true;
          pending.close();
          pending.check();
          return { done: true, value: undefined };
        }
        if (height > toHeight) throw protocol();
        const encoded = ownBytes(item.value, protocol, resourceLimit);
        total += encoded.length;
        if (total > 64 * 1024 * 1024) throw resourceLimit();
        let checked,
          previousHash;
        try {
          const dto = codec.decodeItem('GetBlockRange', encoded) as { prev_hash: string };
          checked = point(dto);
          previousHash = wireBlockHash(dto.prev_hash);
        } catch {
          throw protocol();
        }
        if (checked.height !== height || (previous !== undefined && previousHash !== previous)) throw protocol();
        pending.check();
        height++;
        previous = checked.hash;
        return {
          done: false,
          value: { point: checked, previousHash, encoded, sourceId, observedAt: new Date().toISOString() },
        };
      } catch (error) {
        finished = true;
        try {
          pending?.check();
        } finally {
          pending?.close();
          release(iterator ?? iterable);
        }
        throw isZcashError(error) ? error : transportFailure();
      } finally {
        busy = false;
      }
    },
    async return() {
      if (!finished) {
        pending?.cancel();
        finished = true;
      }
      return { done: true, value: undefined };
    },
  };
}

/** Endpoint tree bytes, not verified wallet chain state. Native ingestion validates frontiers. */
export async function getTreeState(codec: Lightwire, transport: CustomLightTransport,
  network: Network, encoding: 'main' | 'test' | 'regtest', args: BlockSelector & Op): Promise<TreeState> {
  const sourceId = admit(transport, args, ['height', 'hash', 'signal']);
  const { height, hash, signal } = args;
  if (!['main', 'test', 'regtest'].includes(encoding)
    || (height === undefined) === (hash === undefined)) throw invalidArgument();
  if (height !== undefined
    && (!Number.isInteger(height) || height < 0 || height > 0xffff_ffff)) throw invalidArgument();
  const requestedHash = hash === undefined ? undefined : blockHash(hash);
  const requestValue = height === undefined || height === 0
    ? { hash: requestedHash ?? network.genesisHash }
    : { height: String(height) };
  const pending = operation(signal);
  try {
    pending.check();
    let request: Uint8Array;
    try {
      request = codec.encodeRequest('GetTreeState', JSON.stringify(requestValue));
    } catch {
      throw protocol();
    }
    pending.check();
    const unary = transport.unary;
    pending.check();
    const response = await pending.wait(
      Reflect.apply(unary, transport, [{ method: 'GetTreeState', request, signal: pending.signal }]),
    );
    pending.check();
    let encoded = ownBytes(response, protocol, resourceLimit);
    let dto: { network: string; height: string; hash: string; sapling_tree: string; ironwood_tree: string };
    try {
      dto = codec.decodeResponse('GetTreeState', encoded) as typeof dto;
    } catch {
      throw protocol();
    }
    pending.check();
    if (!dto || typeof dto.height !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(dto.height)

      || BigInt(dto.height) > 0xffff_ffffn
      || typeof dto.hash !== 'string'
      || !/^[0-9a-f]{64}$/.test(dto.hash)) throw protocol();
    if (!matchesLightNetwork(dto.network, encoding)) {
      throw failure(
        'NETWORK_MISMATCH',
        'query',
        'configure',
        'Tree state network mismatch.',
      );
    }
    // Pinned lightwalletd GetTreeState uses display-order BlockID bytes as well as response text.
    const point = { height: Number(dto.height), hash: blockHash(dto.hash) };
    if ((height !== undefined && point.height !== height)
      || (requestedHash !== undefined && point.hash !== requestedHash)) throw protocol();
    if (point.height === 0 && point.hash !== network.genesisHash) {
      throw failure(
        'NETWORK_MISMATCH',
        'query',
        'configure',
        'Tree state genesis mismatch.',
      );
    }
    const tree = (value: string) => {
      if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(value)) throw protocol();
      return value.length ? Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16)) : null;
    };
    const sapling = tree(dto.sapling_tree),
      ironwood = tree(dto.ironwood_tree);
    // Native birthday/scan validation expects the configured encoding, not its wire alias.
    // Re-encode through the pinned codec; retain all decoded fields and all chain checks.
    if (dto.network !== encoding) {
      try {
        encoded = codec.encodeTreeState(JSON.stringify({ ...dto, network: encoding }));
      } catch {
        throw protocol();
      }
    }
    pending.check();
    return { network, point, sapling, ironwood, encoded, sourceId, observedAt: new Date().toISOString() };
  } catch (error) {
    pending.check();
    throw isZcashError(error) ? error : transportFailure();
  } finally {
    pending.close();
    pending.check();
  }
}
