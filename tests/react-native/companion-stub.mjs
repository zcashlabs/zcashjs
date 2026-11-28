// Test stand-in for @zcashlabs/zcash.js-native: installs the same transport shape the
// JSI module installs, backed by the native library through zakura-native-bridge.
const { createFifoTransport } = await import(process.env.ZAKURA_FIFO_TRANSPORT);
// The stand-in transport is not part of the React Native bundle; lend it Node's encoder.
const missing = typeof globalThis.TextEncoder !== 'function';
if (missing) globalThis.TextEncoder = globalThis[Symbol.for('zcash.test.TextEncoder')];
const transport = createFifoTransport(process.env.ZAKURA_NATIVE_BRIDGE);
if (missing) delete globalThis.TextEncoder;
globalThis.__zakuraNative = Object.freeze({
  call: transport.call, start: transport.start,
  createRuntime: transport.createRuntime, destroyRuntime: transport.destroyRuntime,
});
globalThis.__zakuraNativeClose = () => transport.close();
