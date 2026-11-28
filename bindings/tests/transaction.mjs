import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const out = process.argv[2];
const network = await import(pathToFileURL(`${out}/network.mjs`));
const entry = await import(pathToFileURL(`${out}/transaction.mjs`)).catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return {};
});
assert.equal(typeof entry.decodeTransaction, 'function', 'private codec export required');
const { decodeTransaction } = entry;
const vectors = JSON.parse(await readFile(new URL('./transaction-vectors.json', import.meta.url)));
const raw = Uint8Array.from(Buffer.from(vectors[0].hex, 'hex'));
const branch = vectors[0].branch;
let admission = 0;
for (const value of [-1, 2 ** 32, branch + 2 ** 32, branch - 2 ** 32, branch + .5,
  String(branch), new Number(branch), NaN, Infinity, null, undefined, 1n,
  { valueOf() { throw Error('must not coerce'); } }]) {
  assert.throws(() => decodeTransaction(raw, value), { name: 'TypeError', message: 'invalid branch' }); admission++;
}
const detached = raw.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
const spoofedType = new Uint16Array(10); Object.setPrototypeOf(spoofedType, Uint8Array.prototype);
const oversized = new Uint8Array(2097153); Object.defineProperty(oversized, 'byteLength', { value: 1 });
const shared = new SharedArrayBuffer(raw.length); const spoofedShared = new Uint8Array(shared); spoofedShared.set(raw);
Object.setPrototypeOf(shared, ArrayBuffer.prototype);
for (const value of [[], Array.from(raw), Array.from(raw, n => n + 256), {}, null,
  new Uint16Array(10), new DataView(raw.buffer), Object.create(Uint8Array.prototype),
  new Proxy(raw, {}), detached, spoofedType, oversized, new Uint8Array(0),
  new Uint8Array(new SharedArrayBuffer(10)), spoofedShared]) {
  assert.throws(() => decodeTransaction(value, branch), { name: 'TypeError', message: 'invalid transaction bytes' }); admission++;
}
// Correct JS admission reaches genuine uninitialized glue; no mock or patched glue.
assert.throws(() => decodeTransaction(raw, branch), error => !String(error).includes('invalid transaction bytes'));
network.initialize(new Uint8Array(await readFile(`${out}/bindings_bg.wasm`)));
let accepted = 0;
for (const v of vectors) {
  const padded = Uint8Array.from([0, ...Buffer.from(v.hex, 'hex'), 0]);
  const input = padded.subarray(1, -1);
  const result = decodeTransaction(input, v.branch);
  assert.equal(Buffer.from(result.bytes).toString('hex'), v.hex);
  assert.equal(Buffer.from(result.txid).toString('hex'), v.txid);
  assert.equal(result.display, v.display);
  assert.ok(Object.isFrozen(result));
  assert.notEqual(result.bytes.buffer, input.buffer);
  assert.notEqual(result.bytes.buffer, result.txid.buffer);
  input.fill(0); assert.equal(Buffer.from(result.bytes).toString('hex'), v.hex);
  result.bytes.fill(0); result.txid.fill(0);
  assert.equal(decodeTransaction(Buffer.from(v.hex, 'hex'), v.branch).display, v.display);
  accepted++;
}
assert.throws(() => decodeTransaction(Buffer.from('0400008085202f89000000000000000000000100000000000000000000', 'hex'), 0x76b809bb), /serialization differs/);
console.log(JSON.stringify({ transactionVectors: accepted, beforeInitAdmission: admission, ownedResults: true }));
