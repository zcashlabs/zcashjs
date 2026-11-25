import assert from 'node:assert/strict';
import test from 'node:test';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { createLightClient, defineNetwork, grpc } from '../../dist/src/index.js';
import { networkBinding } from '../../dist/src/network.js';
import { networkDefinition } from './light-client-fixture.js';
import { scalar, bytesField, concat, blockBytes, tipBytes } from '../clients/light-chain-reads-fixtures.js';

const text = (field, value) => bytesField(field, new TextEncoder().encode(value));
const endpoint = 'http://127.0.0.1:1';

test('built-in schedules match zcash_protocol 0.10.6 plus deployed NU7 at every upgrade boundary', async () => {
  const schedules = {
    mainnet: [347500,419200,653600,903000,1046400,1687104,2726400,3146400,3364600,3428143,3543405],
    testnet: [207500,280000,584000,903800,1028500,1842420,2976000,3536500,4052000,4134000,4465026],
  };
  for (const [name, heights] of Object.entries(schedules)) {
    const network = await defineNetwork(name);
    const { definition, codec } = networkBinding(network);
    assert.equal(network.identity, `zcash-${name}`);
    assert.equal(definition.parametersFormat, 'zcash-js-network/2');
    assert.deepEqual(definition.parameters.heights, heights);
    for (const height of heights) {
      const context = at => codec.consensusContext(definition.parametersFormat, definition.parameters.bytes, at);
      assert.notEqual(context(height - 1).branchId, context(height).branchId);
    }
    assert.equal(codec.consensusContext(definition.parametersFormat, definition.parameters.bytes, heights.at(-2)).branchId, 0x37a5165b);
    assert.equal(codec.consensusContext(definition.parametersFormat, definition.parameters.bytes, heights.at(-1)).branchId, 0x77190ad9);
  }
  assert.equal((await defineNetwork()).genesisHash, '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08');
  assert.equal((await defineNetwork('testnet')).genesisHash, '05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38');
  await assert.rejects(defineNetwork('regtest'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(defineNetwork('https://example.com'), { code: 'INVALID_ARGUMENT' });
});

test('endpoint shorthand defaults to mainnet and accepts full definitions or registered networks', async () => {
  assert.equal((await createLightClient(endpoint)).network.identity, 'zcash-mainnet');
  assert.equal((await createLightClient(endpoint, { network: 'testnet' })).network.identity, 'zcash-testnet');
  const definition = networkDefinition();
  const pending = createLightClient(endpoint, { network: definition });
  definition.parameters.fill(0);
  const light = await pending;
  assert.equal(light.network.identity, 'synthetic');
  assert.equal(networkBinding(light.network).definition.parameters.heights[1], 20);
  const reused = await createLightClient(endpoint, { network: light.network });
  assert.equal(reused.network, light.network);
  const explicit = createLightClient({ network: light.network, transport: grpc(endpoint, {
    sourceId: 'explicit', timeoutMs: 1000, readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 1024,
  }) });
  assert.equal(typeof explicit.getTip, 'function', 'old object form stays synchronous');
});

test('endpoint options reject invalid fields and accessors without evaluating them', async () => {
  for (const options of [null, { extra: true }, { network: 'typo' }, { network: null },
    { transportOptions: { timeoutMs: 0 } }, { transportOptions: { extra: 1 } },
    { transportOptions: { readRetry: { attempts: 0, delayMs: 0 } } }]) {
    await assert.rejects(createLightClient(endpoint, options), { code: 'INVALID_ARGUMENT' });
  }
  let getters = 0;
  for (const options of [
    { get network() { getters++; throw Error('secret'); } },
    { transportOptions: { get timeoutMs() { getters++; throw Error('secret'); } } },
  ]) await assert.rejects(createLightClient(endpoint, options), { code: 'INVALID_ARGUMENT' });
  assert.equal(getters, 0);
  await assert.rejects(createLightClient('https://user:secret@example.com'), { code: 'INVALID_ARGUMENT' });
});

test('endpoint defaults retain lazy handshake, transport overrides and chain mismatch checks', async t => {
  const network = await defineNetwork('testnet');
  const server = new Server();
  const service = {}, handlers = {};
  let calls = 0, mode = 'good', header;
  for (const method of ['GetLightdInfo', 'GetBlockRange', 'GetLatestBlock']) {
    service[method] = {
      path: '/cash.z.wallet.sdk.rpc.CompactTxStreamer/' + method,
      requestStream: false, responseStream: method === 'GetBlockRange',
      requestSerialize: Buffer.from, requestDeserialize: Buffer.from,
      responseSerialize: Buffer.from, responseDeserialize: Buffer.from,
    };
    handlers[method] = (call, callback) => {
      calls++;
      header = call.metadata.get('x-test')[0];
      if (method === 'GetLightdInfo') callback(null, concat(
        text(4, 'test'), scalar(5, 280000), text(6, mode === 'branch' ? '00000000' : '37a5165b'),
        scalar(7, 4134000), text(18, 'v0.5.0'),
      ));
      else if (method === 'GetLatestBlock') callback(null, tipBytes(4134000));
      else {
        call.write(blockBytes(1, undefined, mode === 'genesis' ? new Uint8Array(32) : Buffer.from(network.genesisHash, 'hex').reverse()));
        call.end();
      }
    };
  }
  server.addService(service, handlers);
  t.after(() => server.forceShutdown());
  const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
  const url = `http://127.0.0.1:${port}`;
  const options = { network: 'testnet', transportOptions: { sourceId: 'override', headers: async () => ({ 'x-test': 'yes' }) } };
  const pending = createLightClient(url, options);
  options.transportOptions.sourceId = 'mutated';
  const light = await pending;
  assert.equal(calls, 0, 'construction does not contact server');
  assert.equal((await light.getTip()).sourceId, 'override');
  assert.equal(header, 'yes');
  const mainnet = await createLightClient(url);
  await assert.rejects(mainnet.getTip(), { code: 'NETWORK_MISMATCH' });
  for (mode of ['branch', 'genesis']) {
    const bad = await createLightClient(url, { network: 'testnet' });
    await assert.rejects(bad.getTip(), { code: 'NETWORK_MISMATCH' });
  }
});
