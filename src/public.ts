import { delay } from './abort.js';
import { addressInput, broadcastInput } from './clients/request-inputs.js';
import { observationOptions } from './options.js';
import { ObserverBuffer } from './observer-buffer.js';
import type {
  PublicClient,
  PublicClientOptions,
  NetworkDefinition,
  Network,
  HttpTransport,
  ObservationOptions,
  Op,
  BlockSelector,
  TxId,
  TransactionObservation,
  Inclusion,
  ConfirmedTransaction,
} from './types.js';
import { defineNetwork, networkBinding } from './network.js';
import { httpTransport, httpSourceId, httpEndpoint, readRpc, sendRawTransaction, rpcErrorCode } from './http.js';
import { snapshot } from './clients/owned-plumbing.js';
import { operation } from './clients/light-chain-reads.js';
import * as chain from './clients/public-chain-reads.js';
import * as blocks from './clients/public-block-reads.js';
import * as transactions from './clients/public-transaction-reads.js';
import { blockHash, txId } from './primitives.js';
import { JsonNumber, protocolError } from './json.js';
import { failure, invalidArgument } from './errors.js';

const clients = new WeakMap<PublicClient, Readonly<{ network: Network; endpoint: string }>>();
export const publicClientBinding = (client: PublicClient) => clients.get(client);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) throw protocolError();
  return value as Record<string, unknown>;
}
function number(value: unknown, max = 0xffffffff): number {
  if (!(value instanceof JsonNumber) || !/^(0|[1-9][0-9]*)$/.test(value.text)) throw protocolError();
  const n = Number(value.text);
  if (!Number.isSafeInteger(n) || n > max) throw protocolError();
  return n;
}
function bytes(value: unknown, max = 1024 * 1024): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length % 2 || value.length > max * 2
    || !/^[0-9a-f]*$/.test(value)) throw protocolError();
  const result = new Uint8Array(value.length / 2);
  for (let i = 0; i < result.length; i++) result[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return result;
}
const hex = (value: Uint8Array) => {
  let text = '';
  for (const byte of value) text += byte.toString(16).padStart(2, '0');
  return text;
};
const responseHash = (value: unknown) => {
  try {
    return blockHash(value as string);
  } catch {
    throw protocolError();
  }
};
function selector(args: BlockSelector): string {
  if (Object.hasOwn(args, 'height') === Object.hasOwn(args, 'hash')) throw invalidArgument();
  if (Object.hasOwn(args, 'hash')) return blockHash(args.hash!);
  if (!Number.isInteger(args.height) || args.height! < 0 || args.height! > 0xffffffff) throw invalidArgument();
  return String(args.height);
}
function positive(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidArgument();
}

/** Endpoint shorthand initializes codecs; requests remain lazy. */
export function createPublicClient(endpoint: string, options?: PublicClientOptions): Promise<PublicClient>;
/** Explicit composition retains synchronous construction and explicit policies. */
export function createPublicClient(
  args: { network: Network; transport: HttpTransport; observation: ObservationOptions },
): PublicClient;
export function createPublicClient(
  args: string | { network: Network; transport: HttpTransport; observation: ObservationOptions },
  options?: PublicClientOptions,
): PublicClient | Promise<PublicClient> {
  if (typeof args === 'string') return publicFromEndpoint(args, options);
  if (options !== undefined) throw invalidArgument();
  const input = snapshot(args, ['network', 'transport', 'observation']);
  const { network, transport } = input,
    sourceId = httpSourceId(transport),
    source = { transport, sourceId };
  const { definition, codec } = networkBinding(network),
    family = definition.parameters.encoding;
  const observation = observationOptions(input.observation);
  const stamp = () => ({ sourceId, observedAt: new Date().toISOString() });
  let verified = false;
  let native: Promise<
    {
      wire: ReturnType<typeof import('./runtime/lightwire-capsule.mjs')['initialize']>;
      address: ReturnType<typeof import('./runtime/transparent-address-capsule.mjs')['initialize']>;
    }
  >
  | undefined;
  async function codecs() {
    native ??= Promise.all(
      [import('./runtime/lightwire-capsule.mjs'), import('./runtime/transparent-address-capsule.mjs')],
    )
      .then(([wire, address]) => ({ wire: wire.initialize(), address: address.initialize() }));
    try {
      return await native;
    } catch {
      throw failure('RUNTIME_UNAVAILABLE', 'runtime', 'configure', 'Public codecs unavailable.');
    }
  }
  async function ready(signal: AbortSignal) {
    if (!verified) {
      const genesis = await chain.getBlockHeader(source, { height: 0, signal });
      if (!genesis || genesis.point.hash !== network.genesisHash) {
        throw failure(
          'NETWORK_MISMATCH',
          'query',
          'configure',
          'Public server genesis hash does not match the configured network.',
        );
      }
      verified = true;
    }
  }
  function decode(raw: Uint8Array, minedHeight: number | null = null) {
    const heights = minedHeight === null
      ? [0, ...definition.parameters.heights.filter(h => h !== null)]
      : [minedHeight];
    const branches = new Set(heights
      .map(
        height => codec.consensusContext(definition.parametersFormat, definition.parameters.bytes, height).branchId,
      ));
    for (const branch of branches) {
      try {
        return codec.decodeTransaction(raw, branch);
      } catch { /* Registered native contexts only. */ }
    }
    throw invalidArgument();
  }
  async function unary<A extends Op, T>(
    args: A,
    keys: readonly string[],
    call: (args: A & { signal: AbortSignal }) => Promise<T>,
    write = false,
  ): Promise<T> {
    const owned = snapshot(args, [...keys, 'signal']);
    checkSignal(owned.signal);
    const pending = operation(owned.signal);
    try {
      pending.check();
      await pending.wait(ready(pending.signal));
      pending.check();
      const result = call({ ...owned, signal: pending.signal });
      if (write) return await result;
      const value = await pending.wait(result);
      pending.check();
      return value;
    } finally {
      pending.close();
    }
  }
  async function transaction(id: TxId, signal: AbortSignal) {
    return transactions.getTransaction(source, { txid: id, decodeTransaction: decode }, { txid: id, signal });
  }
  async function status(id: TxId, signal: AbortSignal): Promise<TransactionObservation> {
    const before = await chain.getTip(source, { signal });
    const found = await transaction(id, signal);
    const after = await chain.getTip(source, { signal });
    if (before.height !== after.height || before.hash !== after.hash) {
      return {
        txid: id,
        state: 'unknown',
        inclusion: null,
        tip: null,
        priorInclusion: null,
        ...stamp(),
      };
    }
    if (!found) return { txid: id, state: 'notSeen', inclusion: null, tip: after, priorInclusion: null, ...stamp() };
    const value = found.observation,
      inclusion = value.inclusion;
    if (inclusion
      && (inclusion.height > after.height
        || (inclusion.height === after.height && inclusion.blockHash !== after.hash))) {
      return {
        ...value,
        state: 'unknown',
        inclusion: null,
        tip: after,
        ...stamp(),
      };
    }
    if (inclusion && inclusion.height <= after.height) {
      return {
        ...value,
        inclusion: { ...inclusion, confirmations: after.height - inclusion.height + 1 },
        tip: after,
        ...stamp(),
      };
    }
    return { ...value, tip: after, ...stamp() };
  }
  const client: PublicClient = {
    network,
    getTip: (args = {}) => unary(args, [], a => chain.getTip(source, a)),
    getBlock: args => unary(args, ['height', 'hash'], a => blocks.getBlock(source, a)),
    getBlockHeader: args => unary(args, ['height', 'hash'], a => chain.getBlockHeader(source, a)),
    getTransaction: args => unary(args, ['txid'], a => transaction(txId(a.txid), a.signal)),
    getTransactionStatus: args => unary(args, ['txid'], a => status(txId(a.txid), a.signal)),
    getUtxos: async args => unary(addressInput(args), ['addresses'], async (a) => {
      const { address } = await codecs();
      let addresses: string[];
      const scripts = new Map<string, string>();
      try {
        addresses = a.addresses.map((value) => {
          const decoded = address.decode(value, family);
          if (!scripts.has(decoded.canonical)) {
            scripts.set(decoded.canonical, decoded.kind === 'p2pkh'
              ? `76a914${hex(decoded.payload)}88ac`
              : `a914${hex(decoded.payload)}87`);
          }
          return decoded.canonical;
        });
      } catch {
        throw invalidArgument();
      }
      const dto = object(await readRpc(transport, 'getaddressutxos', [{ addresses, chainInfo: true }], a.signal));
      const tip = { height: number(dto.height), hash: responseHash(dto.hash) };
      if (!Array.isArray(dto.utxos) || dto.utxos.length > 10000) throw protocolError();
      const seen = new Set<string>();
      const items = dto.utxos.map((item) => {
        const row = object(item),
          id = responseHash(row.txid) as unknown as TxId,
          outputIndex = number(row.outputIndex),
          minedHeight = number(row.height);
        if (minedHeight > tip.height || !(row.satoshis instanceof JsonNumber)
          || !/^(0|[1-9][0-9]*)$/.test(row.satoshis.text)) throw protocolError();
        const value = BigInt(row.satoshis.text);
        if (value > 2100000000000000n) throw protocolError();
        if (typeof row.address !== 'string') throw protocolError();
        const expected = scripts.get(row.address);
        if (expected === undefined
          || seen.has(`${id}:${outputIndex}`)) throw protocolError();
        seen.add(`${id}:${outputIndex}`);
        const script = bytes(row.script);
        if (hex(script) !== expected) throw protocolError();
        return { txid: id, outputIndex, address: row.address, value, script, minedHeight };
      });
      return { items, tip, ...stamp() };
    }),
    getTreeState: args => unary(args, ['height', 'hash'], async (a) => {
      const selected = selector(a);
      const dto = object(await readRpc(transport, 'z_gettreestate', [selected], a.signal));
      const point = { height: number(dto.height), hash: responseHash(dto.hash) },
        time = number(dto.time);
      if ((a.height !== undefined && a.height !== point.height)
        || (a.hash !== undefined && a.hash !== point.hash)) throw protocolError();
      function tree(name: string) {
        const state = object(object(dto[name]).commitments).finalState;
        return state === undefined ? null : bytes(state);
      }
      const sapling = tree('sapling'),
        orchard = tree('orchard'),
        ironwood = tree('ironwood');
      const header = await chain.getBlockHeader(source, { hash: point.hash, signal: a.signal });
      if (!header || header.point.height !== point.height || header.time !== time) throw protocolError();
      const { wire } = await codecs();
      let encoded;
      try {
        encoded = wire.encodeTreeState(JSON.stringify({
          network: family,
          height: String(point.height),
          hash: point.hash,
          time,
          sapling_tree: sapling === null ? '' : hex(sapling),
          orchard_tree: orchard === null ? '' : hex(orchard),
          ironwood_tree: ironwood === null ? '' : hex(ironwood),
        }));
      } catch {
        throw protocolError();
      }
      return { network, point, sapling, ironwood, encoded, ...stamp() };
    }),
    getSubtreeRoots(args) {
      const owned = snapshot(args, ['pool', 'startIndex', 'limit', 'signal']);
      if (!['sapling', 'ironwood'].includes(owned.pool)
        || typeof owned.startIndex !== 'bigint'
        || owned.startIndex < 0n
        || owned.startIndex > 65535n
        || !Number.isInteger(owned.limit)
        || owned.limit < 1
        || owned.limit > 1024
        || owned.startIndex + BigInt(owned.limit) > 65536n) throw invalidArgument();
      return iterate(owned.signal, async function* (signal) {
        await ready(signal);
        const before = await chain.getTip(source, { signal });
        const dto = object(
          await readRpc(transport, 'z_getsubtreesbyindex', [owned.pool, Number(owned.startIndex), owned.limit], signal),
        );
        if (dto.pool !== owned.pool
          || number(dto.start_index, 65535) !== Number(owned.startIndex)
          || !Array.isArray(dto.subtrees)
          || dto.subtrees.length > owned.limit) throw protocolError();
        let previous = -1;
        const roots = [];
        for (let index = 0; index < dto.subtrees.length; index++) {
          const row = object(dto.subtrees[index]),
            height = number(row.end_height),
            root = bytes(row.root, 32);
          if (root.length !== 32 || height < previous) throw protocolError();
          previous = height;
          const header = await chain.getBlockHeader(source, { height, signal });
          if (!header || height > before.height
            || (height === before.height && header.point.hash !== before.hash)) throw protocolError();
          roots.push({
            pool: owned.pool,
            index: owned.startIndex + BigInt(index),
            root,
            completingBlock: header.point,
            ...stamp(),
          });
        }
        const after = await chain.getTip(source, { signal });
        if (before.hash !== after.hash || before.height !== after.height) throw protocolError();
        yield* roots;
      });
    },
    broadcastTransaction: async args => unary(broadcastInput(args), ['bytes'], async (a) => {
      const raw = a.bytes;
      if (!raw.length || raw.length > 2 * 1024 * 1024) throw invalidArgument();
      const decoded = decode(raw);
      if (decoded.bytes.length !== raw.length || decoded.bytes.some((v, i) => v !== raw[i])) throw invalidArgument();
      const id = txId(decoded.display);
      const reply = await sendRawTransaction(transport, hex(raw), a.signal);
      let outcome: 'acknowledged' | 'rejected' | 'unknown' = 'unknown',
        diagnosticCode: string | null = null;
      if ('result' in reply && reply.result === id) outcome = 'acknowledged';
      if ('error' in reply) {
        const code = rpcErrorCode(reply.error);
        if (code === -22 || code === -25) {
          outcome = 'rejected';
          diagnosticCode = `rpc-send:${code}`;
        }
      }
      return { txid: id, outcome, diagnosticCode, ...stamp() };
    }, true),
    watchTransaction(args) {
      const owned = snapshot(args, ['txid', 'signal']),
        id = txId(owned.txid);
      return watch(owned.signal, signal => status(id, signal));
    },
    async waitForTransaction(args) {
      const owned = snapshot(args, ['txid', 'signal', 'confirmations', 'timeoutMs']);
      const confirmations = owned.confirmations ?? 1;
      positive(confirmations);
      if (owned.timeoutMs !== undefined) positive(owned.timeoutMs);
      const id = txId(owned.txid);
      checkSignal(owned.signal);
      const pending = operation(owned.signal);
      let iterator: AsyncIterator<TransactionObservation> | undefined;
      try {
        pending.check();
        iterator = client.watchTransaction({ txid: id, signal: pending.signal })[Symbol.asyncIterator]();
        const deadline = owned.timeoutMs === undefined
          ? undefined
          : delay(owned.timeoutMs, pending.signal, observationAborted).then(() => {
              throw failure('TIMEOUT', 'query', 'none', 'Transaction wait timed out.');
            });
        for (; ;) {
          const next = iterator.next();
          const item = await (deadline ? Promise.race([next, deadline]) : next);
          const value = item.value,
            inclusion = value?.inclusion;
          if (inclusion?.blockHash && inclusion.confirmations !== null
            && inclusion.confirmations >= confirmations) {
            return {
              txid: owned.txid,
              height: inclusion.height,
              blockHash: inclusion.blockHash,
              confirmations: inclusion.confirmations,
              sourceId: value.sourceId,
              observedAt: value.observedAt,
            } satisfies ConfirmedTransaction;
          }
        }
      } finally {
        pending.cancel();
        await iterator?.return?.();
      }
    },
  };
  function iterate<T>(
    signal: AbortSignal | undefined,
    produce: (signal: AbortSignal) => AsyncGenerator<T>,
  ): AsyncIterableIterator<T> {
    checkSignal(signal);
    let pending: ReturnType<typeof operation> | undefined;
    let iterator: AsyncGenerator<T> | undefined,
      finished = false,
      reading = false;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (finished) return { done: true, value: undefined };
        if (reading) throw invalidArgument();
        reading = true;
        try {
          pending ??= operation(signal);
          pending.check();
          iterator ??= produce(pending.signal);
          const result = await pending.wait(iterator.next());
          if (result.done) {
            finished = true;
            pending.close();
          }
          return result;
        } catch (error) {
          finished = true;
          pending?.cancel();
          throw error;
        } finally {
          reading = false;
        }
      },
      async return() {
        finished = true;
        pending?.cancel();
        await iterator?.return(undefined);
        return { done: true, value: undefined };
      },
    };
  }
  function watch(
    signal: AbortSignal | undefined,
    read: (signal: AbortSignal) => Promise<TransactionObservation>,
  ): AsyncIterableIterator<TransactionObservation> {
    checkSignal(signal);
    const buffer = new ObserverBuffer<TransactionObservation>(observation.maxBufferedUpdates,
      () => failure('RESOURCE_LIMIT', 'query', 'configure', 'Observation buffer exceeded.'));
    let pending: ReturnType<typeof operation> | undefined;
    let running: Promise<void> | undefined;
    let prior: Inclusion | null = null;
    async function run() {
      const owned = pending = operation(signal);
      try {
        owned.check();
        await owned.wait(ready(owned.signal));
        while (!buffer.finished) {
          let value = await owned.wait(read(owned.signal));
          owned.check();
          if (prior
            && (value.inclusion?.blockHash !== prior.blockHash
              || value.inclusion?.height !== prior.height)) value = { ...value, priorInclusion: prior };
          if (value.inclusion) prior = { ...value.inclusion };
          buffer.push(structuredClone(value));
          await delay(observation.pollIntervalMs, owned.signal, observationAborted);
        }
      } catch (caught) {
        buffer.close(caught);
      } finally {
        buffer.end();
        owned.close();
      }
    }
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => buffer.next(() => {
        running ??= run();
      }),
      async return() {
        buffer.close();
        pending?.cancel();
        await running;
        return { done: true, value: undefined };
      },
    };
  }
  clients.set(client, Object.freeze({ network, endpoint: httpEndpoint(transport) }));
  return Object.freeze(client);
}
const observationAborted = () => failure('ABORTED', 'query', 'none', 'Observation aborted.');

function checkSignal(signal?: AbortSignal): void {
  if (signal === undefined) return;
  try {
    const host = globalThis as typeof globalThis
      & {
        process?: { getBuiltinModule(name: string): { types: { isProxy(value: unknown): boolean } } };
      };
    if (host.process?.getBuiltinModule('util').types.isProxy(signal)

      || Object.getPrototypeOf(signal) !== AbortSignal.prototype
      || Object.hasOwn(signal, 'aborted')
      || Object.hasOwn(signal, 'reason')) throw 0;
    Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(signal);
  } catch {
    throw invalidArgument();
  }
}

async function publicFromEndpoint(endpoint: string, options: PublicClientOptions = {}): Promise<PublicClient> {
  const input = snapshot(options, ['network', 'transportOptions', 'observation']);
  const transport = httpTransport(endpoint, input.transportOptions);
  const observation = observationOptions({
    pollIntervalMs: 1000,
    maxBufferedUpdates: 16,
    ...(input.observation === undefined ? {} : snapshot(input.observation, ['pollIntervalMs', 'maxBufferedUpdates'])),
  });
  let network: Network;
  if (input.network === undefined || typeof input.network === 'string') {
    network = await defineNetwork(input.network);
  } else {
    try {
      networkBinding(input.network);
      network = input.network as Network;
    } catch {
      network = await defineNetwork(input.network as NetworkDefinition);
    }
  }
  return createPublicClient({ network, transport, observation });
}
