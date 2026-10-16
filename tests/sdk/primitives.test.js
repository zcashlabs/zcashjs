import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '@zcashlabs/zcash.js';

function invalid(action) {
  assert.throws(action, (error) => {
    assert.equal(sdk.isZcashError(error), true);
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.equal(error.stage, 'validation');
    assert.equal(error.recovery, 'correct-input');
    assert.equal(error.retryable, false);
    return true;
  });
}

test('decimal ZEC is exact across the safe-number boundary and supports signed deltas', () => {
  for (const [text, amount, formatted] of [
    ['0', 0n, '0'], ['1', 100_000_000n, '1'],
    ['0.00000001', 1n, '0.00000001'], ['0.00125', 125_000n, '0.00125'],
    ['001.23000000', 123_000_000n, '1.23'], ['-0.00000001', -1n, '-0.00000001'],
    ['-0.00000000', 0n, '0'],
    ['9007199254740993.12345678', 900719925474099312345678n, '9007199254740993.12345678'],
  ]) {
    assert.equal(sdk.parseZec(text), amount);
    assert.equal(sdk.formatZec(amount), formatted);
  }
  for (let i = -1000n; i <= 1000n; i++) {
    const value = i ** 7n + i;
    assert.equal(sdk.parseZec(sdk.formatZec(value)), value);
  }
});

test('amount conversion rejects coercion, whitespace, exponents and fractional precision loss', () => {
  for (const value of ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\u2028', '1\u2029', '.1', '1.', '+1', '1e2', '1E-8',
    '0.000000001', '1.000000000', '1_000', '0x10', 'Infinity', 'NaN', '１',
    1, 1n, null, undefined, {}, new String('1')]) invalid(() => sdk.parseZec(value));
  for (const value of [1, '1', null, undefined, {}]) invalid(() => sdk.formatZec(value));
});

test('checked indices preserve exact boundaries without coercion or wrapping', () => {
  for (const n of [0, 1, 2 ** 31 - 1]) assert.equal(sdk.accountIndex(n), n);
  for (const n of [-1, 2 ** 31, 0.5, NaN, Infinity, '1', 1n, null]) invalid(() => sdk.accountIndex(n));
  for (const n of [0n, 1n, (1n << 88n) - 1n]) assert.equal(sdk.diversifierIndex(n), n);
  for (const n of [-1n, 1n << 88n, 1, '1', null]) invalid(() => sdk.diversifierIndex(n));
});

test('display hashes are exactly lowercase 64-hex, with no normalization or byte reversal', () => {
  const hash = '0123456789abcdef'.repeat(4);
  for (const check of [sdk.txId, sdk.blockHash]) {
    assert.equal(check(hash), hash);
    for (const value of [hash.toUpperCase(), `0x${hash}`, `${hash}\n`, hash.slice(1),
      `${hash}0`, 'g'.repeat(64), new Uint8Array(32), null, 1]) invalid(() => check(value));
  }
});

test('SDK errors contain only sanitized diagnostics and guard rejects foreign lookalikes', () => {
  let caught;
  try { sdk.parseZec('private-value-https://credential.example'); } catch (error) { caught = error; }
  assert.ok(caught instanceof Error);
  assert.equal(sdk.isZcashError(caught), true);
  assert.doesNotMatch(`${caught.stack} ${JSON.stringify(caught)}`, /private-value|credential/);
  assert.equal(caught.cause, undefined);
  for (const value of [null, undefined, 0, {}, new Error('foreign'),
    { code: 'INVALID_ARGUMENT', stage: 'validation', retryable: false, recovery: 'correct-input', message: 'fake' },
    new Proxy({}, { get() { throw Error('getter'); } })]) {
    assert.equal(sdk.isZcashError(value), false);
  }
});
