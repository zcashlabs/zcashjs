import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeNetworkParameters, parseNetworkParameters } from '../../dist/src/network-parameters.js';

const legacy = {
  encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1, Heartwood: 1,
  Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1,
};

test('NU7 schedules use version 2 without changing legacy network identity', () => {
  const original = encodeNetworkParameters(legacy);
  assert.equal(original.parametersFormat, 'zcash-js-network/1');
  assert.equal(new TextDecoder().decode(original.parameters), JSON.stringify(legacy));
  for (const Nu7 of [null, 1, 0xffff_ffff]) {
    const extended = encodeNetworkParameters({ ...legacy, Nu7 });
    assert.equal(extended.parametersFormat, 'zcash-js-network/2');
    assert.equal(new TextDecoder().decode(extended.parameters), JSON.stringify({ ...legacy, Nu7 }));
    assert.deepEqual(parseNetworkParameters(extended.parameters, extended.parametersFormat).heights,
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, Nu7]);
    assert.throws(() => parseNetworkParameters(extended.parameters, original.parametersFormat), { code: 'INVALID_ARGUMENT' });
  }
  assert.throws(() => parseNetworkParameters(original.parameters, 'zcash-js-network/2'), { code: 'INVALID_ARGUMENT' });
});

test('NU7 rejects incomplete, noncanonical or out-of-order schedules without invoking getters', () => {
  for (const Nu7 of [undefined, -1, 0, 1.5, 2 ** 32, NaN, Infinity, '1']) {
    assert.throws(() => encodeNetworkParameters({ ...legacy, Nu7 }), { code: 'INVALID_ARGUMENT' });
  }
  assert.throws(() => encodeNetworkParameters({ ...legacy, Nu6_3: null, Nu7: 1 }), { code: 'INVALID_ARGUMENT' });
  const input = { ...legacy };
  let reads = 0;
  Object.defineProperty(input, 'Nu7', { get() { reads++; return 1; } });
  assert.throws(() => encodeNetworkParameters(input), { code: 'INVALID_ARGUMENT' });
  assert.equal(reads, 0);
  const valid = JSON.stringify({ ...legacy, Nu7: 1 });
  for (const text of [valid + '\n', valid.replace('}', ',"Nu7":1}'), valid.replace('"Nu7":1', '"Nu7":1.0')]) {
    assert.throws(() => parseNetworkParameters(new TextEncoder().encode(text), 'zcash-js-network/2'), { code: 'INVALID_ARGUMENT' });
  }
});
