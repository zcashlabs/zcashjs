import { bridgeSignal, signalAborted } from '../abort.js';
import { copyRecord } from './owned-plumbing.js';
import type { NetworkParameters, Op } from '../types.js';
import type { createGrpcWebByteTransport } from './grpc-web.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';

// Structural view of the accepted, already initialized lightwire instance.
type Codec = {
  encodeRequest(method: 'GetLightdInfo', json: string): Uint8Array;
  decodeResponse(method: 'GetLightdInfo', bytes: Uint8Array): unknown;
};
type Source = {
  readonly codec: Codec;
  readonly transport: Pick<ReturnType<typeof createGrpcWebByteTransport>, 'unary'>;
  readonly sourceId: string;
};
// Revisions this client speaks. v0.6.0 (lightwallet-protocol 2026-10-19) only
// adds GetStandardFee; every message this client exchanges is unchanged.
export const supportedProtocolRevisions = ['v0.5.0', 'v0.6.0'] as const;
export type SupportedProtocolRevision = (typeof supportedProtocolRevisions)[number];
function supportedRevision(value: string): value is SupportedProtocolRevision {
  return (supportedProtocolRevisions as readonly string[]).includes(value);
}

export type LightdObservation = {
  readonly version: string;
  readonly vendor: string;
  readonly protocolRevision: SupportedProtocolRevision;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly chainName: string;
  readonly saplingActivationHeight: number;
  readonly branchId: string;
  readonly blockHeight: number;
  readonly taddrSupport: boolean;
};
const apply = Reflect.apply;

/** Regtest servers may use the BIP70 test label; this never establishes chain identity. */
export function matchesLightNetwork(name: string, encoding: NetworkParameters['encoding']): boolean {
  return name === encoding || encoding === 'regtest' && name === 'test';
}

// Only data methods of the trusted actual instances are captured; this does not
// admit arbitrary transports/codecs as an alternative initialization boundary.
function method<T extends object, K extends keyof T>(owner: T, key: K): T[K] {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') throw invalidArgument();
    return descriptor.value;
  } catch {
    throw invalidArgument();
  }
}
const protocol = () => failure('PROTOCOL_MISMATCH', 'transport', 'configure', 'Invalid light server metadata.');
function height(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,9})$/.test(value)
    || (value.length === 10 && value > '4294967295')) throw protocol();
  return Number(value);
}
function check(signal?: AbortSignal): void {
  if (signal && apply(signalAborted, signal, [])) throw failure('ABORTED', 'transport', 'none', 'Request aborted.');
}

/** Internal, unbound endpoint observations. The composition owner supplies initialized inputs. */
export async function readLightdInfo(source: Source, args: Op = {}): Promise<LightdObservation> {
  const { codec, transport, sourceId } = copyRecord(source, ['codec', 'transport', 'sourceId']);
  const original = copyRecord(args, ['signal']).signal;
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw invalidArgument();
  const encode = method(codec, 'encodeRequest'),
    decode = method(codec, 'decodeResponse');
  const unary = method(transport, 'unary');
  const owned = await bridgeSignal(original);
  const { signal } = owned;
  let stage: 'codec' | 'transport' = 'codec';
  try {
    check(signal);
    const request: Uint8Array = apply(encode, codec, ['GetLightdInfo', '{}']);
    check(signal);
    stage = 'transport';
    const bytes: Uint8Array = await apply(
      unary,
      transport,
      [{ method: 'GetLightdInfo', request, ...(signal ? { signal } : {}) }],
    );
    check(signal);
    stage = 'codec';
    const dto = apply(decode, codec, ['GetLightdInfo', bytes]) as Record<string, unknown>;
    check(signal);
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)
      || typeof dto.version !== 'string' || typeof dto.vendor !== 'string'
      || typeof dto.lightwallet_protocol_version !== 'string'
      || typeof dto.chain_name !== 'string' || !dto.chain_name
      || typeof dto.consensus_branch_id !== 'string' || !/^[0-9a-f]{8}$/.test(dto.consensus_branch_id)
      || typeof dto.taddr_support !== 'boolean') throw protocol();
    const revision = dto.lightwallet_protocol_version;
    if (!supportedRevision(revision)) {
      throw failure(
        'PROTOCOL_MISMATCH', 'transport', 'configure',
        'Light server protocol revision is unsupported; this client supports '
        + `${supportedProtocolRevisions.join(' and ')}.`,
      );
    }
    const saplingActivationHeight = height(dto.sapling_activation_height),
      blockHeight = height(dto.block_height);
    check(signal);
    return {
      version: dto.version,
      vendor: dto.vendor,
      protocolRevision: revision,
      sourceId,
      chainName: dto.chain_name,
      saplingActivationHeight,
      branchId: dto.consensus_branch_id,
      blockHeight,
      taddrSupport: dto.taddr_support,
      observedAt: new Date().toISOString(),
    };
  } catch (error) {
    check(signal);
    if (isZcashError(error)) throw error;
    throw stage === 'codec'
      ? protocol()
      : failure(
          'TRANSPORT_ERROR',
          'transport',
          'configure',
          'Light server request failed.',
        );
  } finally {
    owned.close();
  }
}
