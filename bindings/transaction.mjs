// Internal byte codec, after explicit verified initialization through network.mjs.
import { transaction_id } from './bindings.js';
import { copyBytes } from './bytes.mjs';

export function decodeTransaction(raw, branch) {
  if (typeof branch !== 'number' || !Number.isInteger(branch) || branch < 0 || branch > 0xffffffff) {
    throw new TypeError('invalid branch');
  }
  const bytes = copyBytes(raw, 2097152, 'invalid transaction bytes');
  // Rust writes the parsed transaction and requires exact equality to this snapshot.
  // wasm-bindgen returns an owned copy of the identity, never a view into WASM memory.
  const txid = transaction_id(bytes, branch);
  const display = Array.from(txid).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
  return Object.freeze({ bytes, txid, display });
}
