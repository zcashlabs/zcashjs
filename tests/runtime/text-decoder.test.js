import assert from 'node:assert/strict';
import test from 'node:test';

const { FallbackTextDecoder } = await import('../../dist/src/runtime/text-decoder.js');

// Deterministic generator biased toward multi-byte and boundary bytes.
function* samples(count) {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const interesting = [0x00, 0x7f, 0x80, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0xef, 0xbb, 0xbf, 0xa0, 0x9f, 0x90, 0x8f];
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(Math.floor(next() * 24));
    for (let j = 0; j < bytes.length; j++) bytes[j] = next() < 0.6 ? interesting[Math.floor(next() * interesting.length)] : Math.floor(next() * 256);
    yield [bytes, next];
  }
}
const decode = (Decoder, bytes, options, chunks) => {
  const decoder = new Decoder('utf-8', options);
  if (!chunks) return decoder.decode(bytes);
  let out = '';
  for (const chunk of chunks) out += decoder.decode(chunk, { stream: true });
  return out + decoder.decode();
};
const settle = fn => { try { return { ok: fn() }; } catch (error) { return { error: error.name }; } };

test('fallback UTF-8 decoding matches the platform decoder in every mode', () => {
  for (const [bytes, next] of samples(20000)) {
    const cut = [];
    for (let at = 0; at < bytes.length;) { const n = 1 + Math.floor(next() * 4); cut.push(bytes.subarray(at, at + n)); at += n; }
    for (const options of [{}, { fatal: true }, { ignoreBOM: true }, { fatal: true, ignoreBOM: true }]) {
      for (const chunks of [undefined, cut]) {
        assert.deepEqual(settle(() => decode(FallbackTextDecoder, bytes, options, chunks)),
          settle(() => decode(TextDecoder, bytes, options, chunks)), `${JSON.stringify(options)} ${Buffer.from(bytes).toString('hex')}`);
      }
    }
  }
});

test('fallback decoder handles large inputs, ASCII labels and invalid labels', () => {
  const text = 'é€𝄞a'.repeat(50000);
  assert.equal(new FallbackTextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(text)), text);
  assert.equal(new FallbackTextDecoder('ascii', { fatal: true }).decode(Uint8Array.of(104, 105)), 'hi');
  assert.equal(new FallbackTextDecoder().decode(), '');
  assert.equal(new FallbackTextDecoder().decode(new TextEncoder().encode('ok').buffer), 'ok');
  assert.throws(() => new FallbackTextDecoder('utf-16le'), RangeError);
});
