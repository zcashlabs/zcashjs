import { initSync, lightwire_encode, lightwire_decode, lightwire_encode_tree_state } from './wasm/zakura_lightwire.js';

const MAX_MESSAGE = 4 * 1024 * 1024, MAX_JSON = 2 * MAX_MESSAGE;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const typedLength = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const typedOffset = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
const typedTag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const typedValues = typed.values;
const charCodeAt = String.prototype.charCodeAt;
const parse = JSON.parse;
const unary = new Set(['GetLatestBlock','GetLightdInfo','GetTransaction','GetAddressUtxos','GetTaddressBalance','GetTreeState','SendTransaction']);
const stream = new Set(['GetSubtreeRoots','GetBlockRange','GetTaddressTransactions','GetMempoolStream']);
let initialized = false;
function bytes(value, max) {
  // Intrinsic getters reject proxies and disguised shared backing stores before generated glue.
  if (typedTag.call(value) !== 'Uint8Array') throw new TypeError('expected Uint8Array');
  const buffer = typedBuffer.call(value), size = typedLength.call(value), offset = typedOffset.call(value);
  bufferLength.call(buffer);
  // Validate the ORIGINAL view: OOB getters alone collapse its state to zero.
  typedValues.call(value);
  if (size > max) throw new RangeError('byte limit');
  return new Uint8Array(new Uint8Array(buffer, offset, size));
}
function method(name, kind) {
  if (typeof name !== 'string' || !(kind === 'item' ? stream.has(name) : kind === 'response' ? unary.has(name) : unary.has(name) || stream.has(name))) throw new TypeError('unknown or wrong-kind method');
  return name;
}
function requestText(text) {
  if (typeof text !== 'string') throw new TypeError('expected primitive JSON string');
  if (text.length > MAX_JSON) throw new RangeError('JSON byte limit');
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const c = charCodeAt.call(text, i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = charCodeAt.call(text, ++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('invalid Unicode');
      size += 4;
    } else {
      if (c >= 0xdc00 && c <= 0xdfff) throw new TypeError('invalid Unicode');
      size += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    }
    if (size > MAX_JSON) throw new RangeError('JSON byte limit');
  }
  return text;
}
/** One synchronous, module-owned stateless codec. All operation bytes/results are owned copies. */
export function createLightwire(wasmBytes) {
  if (initialized) throw new Error('lightwire module already initialized');
  const owned = bytes(wasmBytes, 16 * 1024 * 1024);
  initSync({ module: owned });
  initialized = true;
  return Object.freeze({
    encodeRequest(name, request) {
      method(name, 'request');
      return lightwire_encode(name, requestText(request));
    },
    encodeTreeState(response) {
      return lightwire_encode_tree_state(requestText(response));
    },
    decodeResponse(name, payload) {
      method(name, 'response');
      return parse(lightwire_decode(name, bytes(payload, MAX_MESSAGE), false));
    },
    decodeItem(name, payload) {
      method(name, 'item');
      return parse(lightwire_decode(name, bytes(payload, MAX_MESSAGE), true));
    },
  });
}
