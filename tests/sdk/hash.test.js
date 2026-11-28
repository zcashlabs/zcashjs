import assert from 'node:assert/strict';
import test from 'node:test';

const { sha256, sha256Hex, installSha256 } = await import('../../dist/src/hash.js');
const utf8 = text => new TextEncoder().encode(text);

test('sha256 known answers through WebCrypto', async () => {
  assert.equal(await sha256Hex(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256Hex(utf8('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('an installed platform provider replaces WebCrypto', async (t) => {
  t.after(() => installSha256(undefined));
  const seen = [];
  installSha256(async bytes => {
    seen.push(bytes.length);
    return new Uint8Array(32).fill(7);
  });
  assert.equal(await sha256Hex(utf8('abc')), '07'.repeat(32));
  assert.deepEqual(seen, [3]);
});

test('sha256 reports RUNTIME_UNAVAILABLE without WebCrypto or a provider', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  await assert.rejects(sha256(utf8('abc')), error => error.code === 'RUNTIME_UNAVAILABLE');
});
