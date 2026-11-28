import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const out = process.argv[2];
const { initialize, consensusContext } = await import(pathToFileURL(`${out}/network.mjs`));
for (const value of [undefined, './bindings_bg.wasm', {}, new Uint8Array(0), new Uint8Array(3 * 1048576 + 1)]) {
  assert.throws(() => initialize(value), /invalid wasm bytes/);
}
const wasm = new Uint8Array(await readFile(`${out}/bindings_bg.wasm`));
const bytes = new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}');
for (const [name, input, invoke, message] of [
  ['initialize', wasm, value => initialize(value), 'invalid wasm bytes'],
  ['consensusContext', bytes, value => consensusContext('zcash-js-network/1', value, 20), 'invalid parameters'],
]) {
  await test(`${name} rejects prototype-spoofed shared bytes before initialization`, () => {
    const backing = new SharedArrayBuffer(input.length);
    const shared = new Uint8Array(backing);
    shared.set(input);
    Object.setPrototypeOf(backing, ArrayBuffer.prototype);
    assert.equal(Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get.call(backing), input.length);
    assert.throws(() => invoke(shared), { name: 'TypeError', message });
  });
}
await initialize(wasm);
assert.deepEqual(consensusContext('zcash-js-network/1', bytes, 20), { height: 20, branchId: 0x76b809bb });
const nu7 = new TextEncoder().encode(new TextDecoder().decode(bytes).replace('}', ',"Nu7":110}'));
assert.deepEqual(consensusContext('zcash-js-network/2', nu7, 109), { height: 109, branchId: 0x37a5165b });
assert.deepEqual(consensusContext('zcash-js-network/2', nu7, 110), { height: 110, branchId: 0x77190ad9 });
assert.throws(() => consensusContext('zcash-js-network/1', nu7, 110));
assert.throws(() => consensusContext('zcash-js-network/2', bytes, 110));
for (const height of [-1, 4294967296, 1.1, NaN, Infinity, '20', 20n, null, {}, -Infinity]) {
  assert.throws(() => consensusContext('zcash-js-network/1', bytes, height), /invalid height/);
}
for (const input of [[], {}, new Uint16Array(10), new DataView(bytes.buffer), null, new Uint8Array(257)]) {
  assert.throws(() => consensusContext('zcash-js-network/1', input, 20), /invalid parameters/);
}
assert.throws(() => consensusContext('unknown', bytes, 20), /unsupported network format/);
const detached = bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
assert.throws(() => consensusContext('zcash-js-network/1', detached, 20), /invalid parameters/);
assert.throws(() => consensusContext('zcash-js-network/1', new Uint8Array(new SharedArrayBuffer(10)), 20), /invalid parameters/);
console.log('Node generated binding: 25 existing checks passed; 2 shared admission tests reported separately');
