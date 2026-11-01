import type { NetworkDefinition, NetworkParameters } from './types.js';
import { snapshot } from './clients/owned-plumbing.js';
import { failure, invalidArgument } from './errors.js';
import { blockHash } from './primitives.js';

const invalidParameters = () => failure('INVALID_ARGUMENT', 'validation', 'correct-input',
  'Network parameters must be canonical zcash-js-network/1 or zcash-js-network/2 JSON '
  + 'with encoding and every upgrade in order, '
  + 'using nondecreasing heights followed by null.');

const upgrades = [
  'Overwinter',
  'Sapling',
  'Blossom',
  'Heartwood',
  'Canopy',
  'Nu5',
  'Nu6',
  'Nu6_1',
  'Nu6_2',
  'Nu6_3',
  'Nu7',
] as const;

/** Encode a complete typed schedule for defineNetwork without exposing canonical JSON details. */
export function encodeNetworkParameters(
  parameters: NetworkParameters,
): Pick<NetworkDefinition, 'parametersFormat' | 'parameters'> {
  const input = snapshot(parameters, ['encoding', ...upgrades]);
  const hasNu7 = Object.hasOwn(input, 'Nu7');
  const keys = hasNu7 ? upgrades : upgrades.slice(0, -1);
  const format = hasNu7 ? 'zcash-js-network/2' : 'zcash-js-network/1';
  // Validate primitive values before JSON serialization can coerce NaN/Infinity to null.
  if (typeof input.encoding !== 'string' || keys.some(key => input[key] !== null
    && (typeof input[key] !== 'number' || !Number.isFinite(input[key])))) throw invalidArgument();
  const bytes = new TextEncoder().encode(JSON.stringify({
    encoding: input.encoding,
    ...Object.fromEntries(keys.map(key => [key, input[key]])),
  }));
  parseNetworkParameters(bytes, format);
  return { parametersFormat: format, parameters: bytes };
}

/** Internal document validation only; does not create or register a Network. */
export function parseNetworkParameters(input: Uint8Array, parametersFormat: string) {
  if (!['zcash-js-network/1', 'zcash-js-network/2'].includes(parametersFormat)
    || !(input instanceof Uint8Array)) throw invalidParameters();
  const keys = parametersFormat === 'zcash-js-network/2' ? upgrades : upgrades.slice(0, -1);
  // Uint8Array construction copies Buffer too; Buffer.slice() would alias its input.
  let bytes: Uint8Array;
  let text: string;
  let value: Record<string, unknown>;
  try {
    bytes = new Uint8Array(input);
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw invalidParameters();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidParameters();
  const encoding = value.encoding;
  if (encoding !== 'main' && encoding !== 'test' && encoding !== 'regtest') throw invalidParameters();
  let previous: number | null = 0;
  const heights = keys.map((key) => {
    const height = value[key];
    if (height !== null
      && (typeof height !== 'number' || !Number.isInteger(height) || height < 0
        || height > 0xffff_ffff
        || previous === null
        || height < previous)) throw invalidParameters();
    previous = height;
    return height;
  });
  const canonical = JSON.stringify({ encoding, ...Object.fromEntries(keys.map((key, i) => [key, heights[i]])) });
  // Also rejects duplicate/unknown/missing keys, order, whitespace, escapes and -0.
  if (text !== canonical) throw invalidParameters();
  return Object.freeze({
    encoding,
    heights: Object.freeze(heights),
    get bytes() {
      return new Uint8Array(bytes);
    },
  });
}

/** Owned registration input and exact equality key, not a host token or digest. */
export function bindNetworkDefinition(definition: unknown) {
  if (!definition || typeof definition !== 'object'
    || Reflect.ownKeys(definition).some(
      key => !['identity', 'genesisHash', 'parameters', 'parametersFormat'].includes(String(key)),
    )) throw invalidArgument();
  const { identity, genesisHash, parametersFormat, parameters: input } = definition as Record<string, unknown>;
  if (typeof identity !== 'string' || identity.length === 0 || typeof genesisHash !== 'string'
    || typeof parametersFormat !== 'string' || !(input instanceof Uint8Array)) throw invalidArgument();
  const checkedGenesis = blockHash(genesisHash);
  const parameters = parseNetworkParameters(input, parametersFormat);
  const binding = JSON.stringify(
    [identity, checkedGenesis, parametersFormat, new TextDecoder().decode(parameters.bytes)],
  );
  return Object.freeze({ identity, genesisHash: checkedGenesis, parametersFormat, parameters, binding });
}
