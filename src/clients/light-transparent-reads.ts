import { admitSignal, signalAborted as nativeAborted, anySignal } from '../abort.js';
import type { CustomLightTransport, LightClient, Op, NonEmpty } from '../types.js';
import { txId } from '../primitives.js';
import { ownBytes, copyRecord } from './owned-plumbing.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';

type Family = 'main' | 'test' | 'regtest';
type Addresses = { addresses: NonEmpty<string> } & Op;
interface AddressCodec {
  decode(token: string, family: Family): { canonical: string; kind: 'p2pkh' | 'p2sh'; payload: Uint8Array };
}
type Method = 'GetTaddressBalance' | 'GetAddressUtxos';
interface Lightwire {
  encodeRequest(method: Method, json: string): Uint8Array;
  decodeResponse(method: Method, bytes: Uint8Array): unknown;
}
const apply = Reflect.apply;
const revision = 'lightwire:80575dbe59a9bf2e6b79e2391eb78679c453f1a0477292eb97ea3b58bb6c8b10:d8d0c8aaa5ceec7d5dcc188ef25b04011df2ec0254901620fce982fc13aeb32d';
const protocol = () => failure(
  'PROTOCOL_MISMATCH',
  'query',
  'configure',
  'Invalid light-transparent response or schema revision.',
);
const aborted = () => failure('ABORTED', 'query', 'none', 'Light-transparent read aborted.');
const resource = () => failure('RESOURCE_LIMIT', 'query', 'configure', 'Light-transparent response limit exceeded.');
function amount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw protocol();
  const result = BigInt(value);
  if (result > 9223372036854775807n) throw protocol();
  return result;
}
// Copy data fields once so validation and conversion use the same values.
function responseFields(value: unknown, keys: string[]): Record<string, unknown> {
  try {
    return copyRecord(value, keys);
  } catch {
    throw protocol();
  }
}
interface UtxoDto {
  address: string;
  txid: string;
  index: number;
  script: string;
  value: bigint;
  height: number;
}
function utxo(value: unknown): UtxoDto {
  const item = responseFields(value, ['address', 'txid', 'index', 'script', 'value_zat', 'height']);
  if (typeof item.address !== 'string'
    || typeof item.txid !== 'string' || !/^[0-9a-f]{64}$/.test(item.txid)
    || typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0 || item.index > 0x7fffffff

    || typeof item.height !== 'string'
    || !/^(0|[1-9][0-9]{0,9})$/.test(item.height)
    || BigInt(item.height) > 0xffffffffn
    || typeof item.script !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(item.script)) throw protocol();
  return {
    address: item.address,
    txid: item.txid,
    index: item.index,
    script: item.script,
    value: amount(item.value_zat),
    height: Number(item.height),
  };
}
async function read<T>(
  addressCodec: AddressCodec,
  codec: Lightwire,
  transport: CustomLightTransport,
  family: Family,
  args: Addresses,
  method: Method,
  adapt: (dto: unknown, addresses: string[], get: <V>(action: () => V) => V) => T,
) {
  const input = copyRecord(args, ['addresses', 'signal']),
    original = input.signal;
  admitSignal(original);
  const controller = new AbortController();
  const dependent = original === undefined ? undefined : anySignal([original]);
  let reject!: (error: unknown) => void;
  const interruption = new Promise<never>((_, fail) => {
    reject = fail;
  });
  void interruption.catch(() => { });
  const cancel = () => {
    reject(aborted());
    controller.abort();
  };
  dependent?.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (original !== undefined && apply(nativeAborted, original, [])) throw aborted();
  };
  const get = <T>(action: () => T): T => {
    check();
    const result = action();
    check();
    return result;
  };
  try {
    check();
    if (family !== 'main' && family !== 'test' && family !== 'regtest') throw invalidArgument();
    const tokens = input.addresses;
    if (!Array.isArray(tokens)) throw invalidArgument();
    const count = get(() => tokens.length);
    if (count < 1 || count > 100) throw invalidArgument();
    const addresses: string[] = [];
    for (let i = 0; i < count; i++) {
      const descriptor = get(() => Object.getOwnPropertyDescriptor(tokens, String(i)));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'string') throw invalidArgument();
      const token = descriptor.value;
      try {
        const decode = get(() => addressCodec.decode);
        get(() => apply(decode, addressCodec, [token, family]));
      } catch {
        check();
        throw invalidArgument();
      }
      addresses.push(token);
    }
    if (get(() => transport.protocolRevision) !== revision) throw protocol();
    const sourceId = get(() => transport.sourceId);
    if (get(() => transport.kind) !== 'custom-lightwallet' || typeof sourceId !== 'string'
      || !sourceId.length || sourceId.length > 256) throw invalidArgument();
    let request: Uint8Array;
    try {
      const encode = get(() => codec.encodeRequest);
      request = get(
        () => apply(
          encode,
          codec,
          [
            method,
            JSON.stringify(
              method === 'GetAddressUtxos' ? { addresses, start_height: '0', max_entries: 1001 } : { addresses },
            ),
          ],
        ),
      );
    } catch {
      check();
      throw protocol();
    }
    const unary = get(() => transport.unary);
    const active = Promise.resolve(apply(unary, transport, [{ method, request, signal: controller.signal }]));
    // Own rejection handling before checking a synchronous abort from the method body.
    void active.catch(() => { });
    check();
    const bytes = await Promise.race([active, interruption]);
    check();
    let dto: unknown;
    try {
      const decode = get(() => codec.decodeResponse);
      dto = get(() => apply(decode, codec, [method, ownBytes(bytes, protocol, resource)]));
      const value = adapt(dto, addresses, get);
      check();
      return { ...value, sourceId, observedAt: new Date().toISOString() };
    } catch (error) {
      check();
      throw isZcashError(error) ? error : protocol();
    }
  } catch (error) {
    check();
    throw isZcashError(error)
      ? error
      : failure(
          'TRANSPORT_ERROR',
          'transport',
          'configure',
          'Light-transparent request failed.',
        );
  } finally {
    dependent?.removeEventListener('abort', cancel);
    controller.abort();
    check();
  }
}
/** Internal composition with initialized codecs; caller must independently establish source failure fidelity.
 * Pinned lightwalletd 09593ed can erase backend errors and is not qualified (see planning doc).
 */
export function getAddressBalance(address: AddressCodec, wire: Lightwire, transport: CustomLightTransport,
  family: Family, args: Addresses): ReturnType<LightClient['getAddressBalance']> {
  return read(
    address,
    wire,
    transport,
    family,
    args,
    'GetTaddressBalance',
    dto => ({ value: amount(responseFields(dto, ['value_zat']).value_zat) }),
  );
}

/** Bounded reply adaptation; completeness requires an independently failure-faithful source.
 * Hitting the extra-entry sentinel never returns partial success. The pinned server is not qualified.
 */
export function getAddressUtxos(address: AddressCodec, wire: Lightwire, transport: CustomLightTransport,
  family: Family, args: Addresses): ReturnType<LightClient['getAddressUtxos']> {
  return read(address, wire, transport, family, args, 'GetAddressUtxos', (dto, addresses, get) => {
    const { address_utxos: rows } = responseFields(dto, ['address_utxos']);
    if (!Array.isArray(rows)) throw protocol();
    const count = Object.getOwnPropertyDescriptor(rows, 'length')?.value;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw protocol();
    if (count > 1000) throw resource();
    const seen = new Set<string>();
    const items = Array.from({ length: count }, (_, index) => {
      const field = Object.getOwnPropertyDescriptor(rows, String(index));
      if (!field || !Object.hasOwn(field, 'value')) throw protocol();
      const item = utxo(field.value);
      if (!addresses.includes(item.address)) throw protocol();
      const decode = get(() => address.decode);
      get(() => apply(decode, address, [item.address, family]));
      const key = item.txid + ':' + item.index;
      if (seen.has(key)) throw protocol();
      seen.add(key);
      return {
        // Selected GetAddressUtxos server reverses display txids into wire bytes.
        txid: txId(item.txid.match(/../g)!.reverse().join('')),
        outputIndex: item.index,
        address: item.address,
        value: item.value,
        script: Uint8Array.from(item.script.match(/../g) ?? [], byte => parseInt(byte, 16)),
        minedHeight: item.height,
      };
    });
    // ReplyList has no chain point; this is unavailable observation metadata, not absence of UTXOs.
    return { items, tip: null };
  });
}
