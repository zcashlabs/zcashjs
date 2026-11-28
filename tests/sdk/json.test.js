import assert from 'node:assert/strict';
import test from 'node:test';

const { parseJson, JsonNumber } = await import('../../dist/src/json.js');

// Normalize parse results into comparable plain data, keeping prototypes visible.
function shape(value) {
  if (value instanceof JsonNumber) return { number: value.text };
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return { proto: Object.getPrototypeOf(value), entries: Object.keys(value).map(key => [key, shape(value[key])]) };
  }
  return value;
}
const both = input => [parseJson(input), parseJson(input, { fallback: true })];
const nest = (depth, open = '[', close = ']') => open.repeat(depth) + close.repeat(depth);

const valid = [
  '0', '-0', '1', '-1', '12345678901234567890123', '1.5', '-0.25', '1e10', '1E+400', '1e-400', '2.5E-3',
  'true', 'false', 'null', '""', '"plain"', '"esc \\" \\\\ \\/ \\b \\f \\n \\r \\t"', '"\\u00e9\\ud83d\\ude00"',
  '"\\ud800"', '"\\\\"', '"a\\\\"', '[]', '{}', ' \t\r\n[ 1 , "x" , null ] \n',
  '{"a":1,"b":{"c":[true,false,null]},"d":"e"}', '{"a":1,"a":2}', '{"__proto__":{"x":1}}',
  '{"jsonrpc":"2.0","id":1,"result":{"blocks":3000000,"value":0.00000001}}',
  nest(64), '[{"k":'.repeat(32) + '1' + '}]'.repeat(32),
];
const invalid = [
  '', ' ', '01', '-', '1.', '.5', '+1', '1e', '0x10', 'NaN', 'Infinity', 'tru', 'nul', '"', '"\\x"', '"\\u12"',
  '"tab\tinside"', '"line\nbreak"', '[1,]', '[,1]', '{"a":1,}', '{a:1}', "{'a':1}", '{"a" 1}', '[1 2]',
  '1 2', '﻿1', '[1]x', nest(65), '{"a":' + nest(64) + '}',
];

test('parseJson keeps exact numbers and identical shapes on both paths', () => {
  for (const input of valid) {
    const [native, fallback] = both(input);
    assert.deepEqual(shape(fallback), shape(native), input);
  }
  const [value] = both('{"n":12345678901234567890123,"f":1E+400}');
  assert.equal(value.n.text, '12345678901234567890123');
  assert.equal(value.f.text, '1E+400');
});

test('parseJson rejects invalid input with PROTOCOL_MISMATCH on both paths', () => {
  for (const input of invalid) {
    for (const fallback of [false, true]) {
      assert.throws(() => parseJson(input, { fallback }), error => error.code === 'PROTOCOL_MISMATCH', `${fallback} ${JSON.stringify(input)}`);
    }
  }
});

test('parseJson uses null prototypes and last-key-wins', () => {
  for (const fallback of [false, true]) {
    const value = parseJson('{"__proto__":{"polluted":true},"k":1,"k":2}', { fallback });
    assert.equal(Object.getPrototypeOf(value), null);
    assert.equal(value.k.text, '2');
    assert.equal(Object.getPrototypeOf(value.__proto__), null);
    assert.equal({}.polluted, undefined);
  }
});

test('fallback parser handles large string payloads', () => {
  const hex = 'ab'.repeat(4 * 1024 * 1024);
  const input = JSON.stringify({ result: hex, escaped: 'x\\"'.repeat(1000) });
  const [native, fallback] = both(input);
  assert.equal(fallback.result, hex);
  assert.equal(fallback.escaped, native.escaped);
});
