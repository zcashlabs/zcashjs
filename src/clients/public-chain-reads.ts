import { bridgeSignal } from '../abort.js';
import { copyRecord } from './owned-plumbing.js';
import type { BlockHeader, BlockSelector, ChainTip, HttpTransport, Op } from '../types.js';
import { readRpc, rpcErrorCode } from '../http.js';
import { failure, invalidArgument } from '../errors.js';
import { JsonNumber, protocolError } from '../json.js';
import { blockHash } from '../primitives.js';
import { sha256 } from '../hash.js';

type ChainReadSource = { readonly transport: HttpTransport; readonly sourceId: string };

function validateSource(source: ChainReadSource): ChainReadSource {
  const snapshot = copyRecord(source, ['transport', 'sourceId']);
  if (typeof snapshot.sourceId !== 'string' || snapshot.sourceId.trim().length === 0) throw invalidArgument();
  return snapshot;
}

function object(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || value instanceof JsonNumber) throw protocolError();
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!(value instanceof JsonNumber) || !/^(?:0|-?[1-9][0-9]*)$/.test(value.text)) throw protocolError();
  const number = Number(value.text);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw protocolError();
  return number;
}

function hash(value: unknown) {
  try {
    return blockHash(value as string);
  } catch {
    throw protocolError();
  }
}

/** Internal component; the composing client owns network handshake and source binding. */
export async function getTip(source: ChainReadSource, args: Op = {}): Promise<ChainTip> {
  const { transport, sourceId } = validateSource(source);
  const owned = await bridgeSignal(copyRecord(args, ['signal']).signal, true);
  const { signal } = owned;
  try {
    const value = await readRpc(transport, 'getblockchaininfo', [], signal);
    object(value);
    return {
      height: integer(value.blocks, 0, 0xffff_ffff),
      hash: hash(value.bestblockhash),
      sourceId,
      observedAt: new Date().toISOString(),
    };
  } finally {
    owned.close();
  }
}

/** Resolve once, then pin the raw request to that identity even if the height reorganizes. */
export async function getBlockHeader(source: ChainReadSource, args: BlockSelector & Op): Promise<BlockHeader | null> {
  const { transport, sourceId } = validateSource(source);
  args = copyRecord(args, ['height', 'hash', 'signal']);
  const { height, hash: requestedHash } = args;
  if (Object.hasOwn(args, 'height') === Object.hasOwn(args, 'hash')) throw invalidArgument();
  let selector: string;
  if (Object.hasOwn(args, 'height')) {
    if (typeof height !== 'number' || !Number.isInteger(height) || height < 0
      || height > 0xffff_ffff) throw invalidArgument();
    selector = String(height);
  } else selector = blockHash(requestedHash!);
  const owned = await bridgeSignal(args.signal, true);
  const { signal } = owned;
  try {
    let value;
    try {
      value = await readRpc(transport, 'getblockheader', [selector, true], signal);
    } catch (error) {
      if (rpcErrorCode(error) === (requestedHash === undefined ? -8 : -5)) return null;
      throw error;
    }
    object(value);
    const point = { height: integer(value.height, 0, 0xffff_ffff), hash: hash(value.hash) };
    if ((height !== undefined && point.height !== height)
      || (requestedHash !== undefined && point.hash !== requestedHash)) throw protocolError();
    const previousHash = hash(value.previousblockhash);
    const time = integer(value.time, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (point.height === 0 && previousHash !== '0'.repeat(64)) throw protocolError();
    const encoded = await readRpc(transport, 'getblockheader', [point.hash, false], signal);
    const raw = rawHeader(encoded);
    const view = new DataView(raw.buffer);
    if (display(raw.slice(4, 36)) !== previousHash || view.getUint32(100, true) !== time) throw protocolError();
    let digest: Uint8Array;
    try {
      checkAbort(signal);
      const first = await sha256(raw);
      checkAbort(signal);
      digest = await sha256(first);
    } catch {
      checkAbort(signal);
      throw failure('RUNTIME_UNAVAILABLE', 'runtime', 'configure', 'Native SHA-256 is unavailable.');
    }
    checkAbort(signal);
    if (display(digest) !== point.hash) throw protocolError();
    return { point, previousHash, time, raw, sourceId, observedAt: new Date().toISOString() };
  } finally {
    owned.close();
  }
}

// Zakura block/serialize.rs and work/equihash.rs at 1e36d1b: 140 fixed bytes,
// then canonical CompactSize + exactly 36 or 1344 solution bytes. No proof check.
function rawHeader(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || ![354, 2974].includes(value.length)
    || !/^[0-9a-f]+$/.test(value)) throw protocolError();
  const raw = Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
  const version = new DataView(raw.buffer).getUint32(0, true);
  if (version < 4 || version >= 0x8000_0000
    || (raw.length === 177
      ? raw[140] !== 36
      : raw[140] !== 253 || raw[141] !== 64 || raw[142] !== 5)) throw protocolError();
  return raw;
}

// Hashes are SHA256d(serialized header), reversed for display, including parents.
function display(bytes: Uint8Array): string {
  return bytes.reverse().reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '');
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw failure('ABORTED', 'transport', 'none', 'Request aborted.');
}
