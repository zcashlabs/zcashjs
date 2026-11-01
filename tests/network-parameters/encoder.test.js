import assert from 'node:assert/strict';
import test from 'node:test';
import { defineNetwork, encodeNetworkParameters, getConsensusContext } from '@zcashlabs/zcash.js';

const schedule = {
  encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1, Heartwood: 1,
  Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: null, Nu6_2: null, Nu6_3: null,
};
const identity = { identity: 'local', genesisHash: 'ab'.repeat(32) };

test('NU7 reaches native consensus only at its explicit activation height', async () => {
  const network = await defineNetwork({ ...identity, ...encodeNetworkParameters({
    ...schedule, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1, Nu7: 10,
  }) });
  assert.equal(getConsensusContext({ network, targetHeight: 9 }).branchId, 0x37a5165b);
  assert.equal(getConsensusContext({ network, targetHeight: 10 }).branchId, 0x77190ad9);
});

test('typed schedules encode independently of key order and retain native admission', async () => {
  const input = Object.fromEntries(Object.entries(schedule).reverse());
  const encoded = encodeNetworkParameters(input);
  assert.equal(new TextDecoder().decode(encoded.parameters), JSON.stringify(schedule));
  input.Sapling = 0;
  const network = await defineNetwork({ ...identity, ...encoded });
  assert.equal(network.genesisHash, identity.genesisHash);
  assert.equal(encoded.parametersFormat, 'zcash-js-network/1');
  await assert.rejects(defineNetwork({ ...identity, ...encoded,
    parameters: new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(schedule).reverse()))),
  }), { code: 'INVALID_ARGUMENT' });
});

test('typed schedules reject missing, unknown, accessor, and invalid consensus values', () => {
  for (const change of [{ encoding: 'unknown' }, { Sapling: undefined }, { extra: 1 },
    { Sapling: -1 }, { Sapling: 0.5 }, { Sapling: NaN }, { Sapling: Infinity },
    { Sapling: 2 ** 32 }, { Sapling: '1' }, { Sapling: 0 }, { Sapling: null },
    { Sapling: { toJSON() { throw Error('must not run'); } } }]) {
    assert.throws(() => encodeNetworkParameters({ ...schedule, ...change }), { code: 'INVALID_ARGUMENT' });
  }
  let reads = 0;
  const input = { ...schedule };
  Object.defineProperty(input, 'Sapling', { get() { reads++; return 1; } });
  assert.throws(() => encodeNetworkParameters(input), { code: 'INVALID_ARGUMENT' });
  assert.equal(reads, 0);
});
