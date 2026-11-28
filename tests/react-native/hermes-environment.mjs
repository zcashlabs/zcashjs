// Make Node present the platform surface React Native (Hermes) gives the SDK:
// no WebAssembly, workers, MessageChannel, WebCrypto, structuredClone, TextDecoder,
// AbortSignal.any/timeout or JSON.parse source text; navigator.product is ReactNative.
// Test infrastructure (the FIFO stand-in for the JSI module) keeps Node's encoder.
globalThis[Symbol.for('zcash.test.TextEncoder')] = TextEncoder;
Object.defineProperty(process, 'versions', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { product: 'ReactNative' }, configurable: true });
for (const name of ['WebAssembly', 'structuredClone', 'MessageChannel', 'MessagePort', 'Worker', 'TextDecoder',
  'SharedArrayBuffer', 'FinalizationRegistry']) delete globalThis[name];
Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
delete AbortSignal.any;
delete AbortSignal.timeout;
// React Native's abort-controller polyfill has no reason or throwIfAborted.
delete AbortSignal.prototype.throwIfAborted;
delete AbortSignal.prototype.reason;
delete globalThis.TextEncoder;
const parse = JSON.parse;
JSON.parse = function (text, reviver) {
  return typeof reviver === 'function' ? parse(text, function (key, value) { return reviver.call(this, key, value); }) : parse(text);
};
