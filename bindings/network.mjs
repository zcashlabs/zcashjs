// Internal generated glue is only called after admission. Initialization must
// receive already-verified WASM bytes; it is not host/runtime negotiation.
import { initSync, consensus_branch, viewing_open, viewing_decode_address, viewing_select_receiver, validate_birthday, parse_standalone_pczt } from './bindings.js';
import { copyBytes } from './bytes.mjs';

export function initialize(wasmBytes) {
  // This bounded binding accepts verified bytes only, never a URL/default fetch.
  initSync({ module: copyBytes(wasmBytes, 3 * 1048576, 'invalid wasm bytes') });
}

export function consensusContext(parametersFormat, parameters, height) {
  if (!['zcash-js-network/1', 'zcash-js-network/2'].includes(parametersFormat)) throw new TypeError('unsupported network format');
  if (!Number.isInteger(height) || height < 0 || height > 0xffffffff) throw new TypeError('invalid height');
  const owned = copyBytes(parameters, 256, 'invalid parameters');
  const branchId = consensus_branch(parametersFormat, owned, height);
  return Object.freeze({ height, branchId });
}

// Authority stays in the native allocation. All aliases share this closure's lifetime.
function viewingAuthority(native) {
  let active = native;
  const use = () => { if (!active) throw new Error('CLOSED'); return active; };
  return Object.freeze({
    describe: () => JSON.parse(use().describe()),
    export(format, acknowledge) {
      if (typeof format !== 'string' || typeof acknowledge !== 'string') throw new TypeError('INVALID_ARGUMENT');
      return use().export(format, acknowledge);
    },
    toIncoming: () => viewingAuthority(use().to_incoming()),
    derive(index, request) {
      if (typeof index !== 'string' || index.length > 27 || typeof request !== 'string' || request.length > 1024) throw new TypeError('INVALID_ARGUMENT');
      return JSON.parse(use().derive(index, request));
    },
    find(index, request, maxAttempts) {
      if (typeof index !== 'string' || index.length > 27 || typeof request !== 'string' || request.length > 1024 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 0xffffffff) throw new TypeError('INVALID_ARGUMENT');
      return JSON.parse(use().find(index, request, maxAttempts));
    },
    dispose() { const value = active; active = undefined; value?.free(); },
  });
}
export function openViewingAuthority(parameters, format, encoded, pools) {
  if (typeof format !== 'string' || typeof encoded !== 'string' || encoded.length > 16384 || typeof pools !== 'string' || pools.length > 1024) throw new TypeError('INVALID_ARGUMENT');
  return viewingAuthority(viewing_open(copyBytes(parameters, 256, 'invalid parameters'), format, encoded, pools));
}
export function decodeViewingAddress(parameters, encoded) {
  if (typeof encoded !== 'string' || encoded.length > 16384) throw new TypeError('INVALID_ARGUMENT');
  return JSON.parse(viewing_decode_address(copyBytes(parameters, 256, 'invalid parameters'), encoded));
}
export function selectViewingReceiver(parameters, encoded, pool, height, branch) {
  if (typeof encoded !== 'string' || encoded.length > 16384 || typeof pool !== 'string' || !Number.isInteger(height) || height < 0 || height > 0xffffffff || !Number.isInteger(branch) || branch < 0 || branch > 0xffffffff) throw new TypeError('INVALID_ARGUMENT');
  const result = JSON.parse(viewing_select_receiver(copyBytes(parameters, 256, 'invalid parameters'), encoded, pool, height, branch));
  return { ...result, bytes: Uint8Array.from(result.bytes.match(/../g), byte => parseInt(byte, 16)) };
}

// One checked native birthday operation; no account allocation or storage owner.
export function validateBirthday(parameters, genesis, firstScanHeight, priorTreeState, recoverUntilExclusive) {
  if (!Number.isInteger(firstScanHeight) || firstScanHeight < 1 || firstScanHeight > 0xffffffff
    || (recoverUntilExclusive !== undefined && (!Number.isInteger(recoverUntilExclusive) || recoverUntilExclusive < firstScanHeight || recoverUntilExclusive > 0xffffffff))) throw new TypeError('INVALID_BIRTHDAY');
  const chain = copyBytes(genesis, 32, 'NETWORK_MISMATCH');
  if (chain.length !== 32) throw new TypeError('NETWORK_MISMATCH');
  validate_birthday(copyBytes(parameters, 256, 'INVALID_ARGUMENT'), chain, firstScanHeight,
    copyBytes(priorTreeState, 65536, 'INVALID_BIRTHDAY'), recoverUntilExclusive);
}

// Native PCZT values remain opaque; combine/redact return independently owned values.
const pcztOwners = new WeakMap();
function pcztHandle(native) {
  const state = { native };
  const use = () => { if (!state.native) throw new Error('CLOSED'); return state.native; };
  const handle = Object.freeze({
    serialize: () => use().serialize(),
    inspect: () => JSON.parse(use().inspect()),
    combine(other) {
      const left = use(), right = pcztOwners.get(other);
      if (!right) throw new TypeError('INVALID_ARGUMENT');
      if (!right.native) throw new Error('CLOSED');
      return pcztHandle(left.combine(right.native));
    },
    redact(profile) {
      if (typeof profile !== 'string' || profile.length > 256) throw new TypeError('INVALID_ARGUMENT');
      return pcztHandle(use().redact(profile));
    },
    dispose() { const value = state.native; state.native = undefined; value?.free(); },
  });
  pcztOwners.set(handle, state);
  return handle;
}
export function parseStandalonePczt(parameters, genesis, height, branch, bytes, maximum) {
  if (!Number.isInteger(height) || height < 0 || height > 0xffffffff
    || !Number.isInteger(branch) || branch < 0 || branch > 0xffffffff
    || !Number.isInteger(maximum) || maximum < 1 || maximum > 0xffffffff) throw new TypeError('INVALID_ARGUMENT');
  const chain = copyBytes(genesis, 32, 'NETWORK_MISMATCH');
  if (chain.length !== 32) throw new TypeError('NETWORK_MISMATCH');
  return pcztHandle(parse_standalone_pczt(copyBytes(parameters, 256, 'INVALID_ARGUMENT'), chain,
    height, branch, copyBytes(bytes, maximum, 'INVALID_PCZT'), maximum));
}
