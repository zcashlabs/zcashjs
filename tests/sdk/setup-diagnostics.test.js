import assert from 'node:assert/strict';
import test from 'node:test';
import { defineNetwork, grpc, httpTransport, isZcashError } from '@zcashlabs/zcash.js';

const safe = pattern => error => {
  assert.ok(isZcashError(error));
  assert.equal(error.code, 'INVALID_ARGUMENT');
  assert.equal(error.recovery, 'correct-input');
  assert.match(error.message, pattern);
  assert.doesNotMatch(JSON.stringify(error) + error.message, /SECRET/);
  return true;
};

test('setup diagnostics identify bad configuration without reflecting values or thrown errors', async () => {
  assert.throws(() => httpTransport('https://user:SECRET@example.invalid'), safe(/HTTP endpoint/));
  assert.throws(() => httpTransport('https://example.invalid', { timeoutMs: 'SECRET' }), safe(/timeoutMs/));
  assert.throws(() => httpTransport('https://example.invalid', { readRetry: { attempts: 0, delayMs: 0 } }), safe(/readRetry.attempts/));
  assert.throws(() => httpTransport('https://example.invalid', { headers: 'SECRET' }), safe(/headers/));
  const hostile = { get timeoutMs() { throw Error('SECRET'); } };
  assert.throws(() => httpTransport('https://example.invalid', hostile), safe(/transport options/));
  assert.throws(() => grpc('https://example.invalid/SECRET', {}), safe(/gRPC endpoint/));
  assert.throws(() => grpc('https://example.invalid', {}), safe(/gRPC options/));
  await assert.rejects(defineNetwork('SECRET'), safe(/Network preset/));
  await assert.rejects(defineNetwork({ identity: 'fixture', genesisHash: '00'.repeat(32),
    parametersFormat: 'zcash-js-network/1', parameters: new TextEncoder().encode('SECRET') }), safe(/Network parameters/));
});
