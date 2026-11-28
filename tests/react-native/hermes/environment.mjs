// What React Native sets up around Hermes before app code runs (the host adds
// timers and performance): console, navigator.product, queueMicrotask, and the
// abort-controller polyfill React Native installs as AbortController/AbortSignal.
// React Native: polyfillGlobal('AbortController', () => require('abort-controller/dist/abort-controller').AbortController).
import { AbortController, AbortSignal } from 'abort-controller/dist/abort-controller.mjs';

const print = (...args) => globalThis.__hostPrint(args.map(String).join(' '));
globalThis.console = {
  log: print, info: print, warn: print, error: print, debug: () => {}, trace: () => {}, group: () => {}, groupEnd: () => {},
  assert: (condition, ...args) => { if (!condition) print('Assertion failed:', ...args); },
};
globalThis.navigator = { product: 'ReactNative' };
if (typeof globalThis.queueMicrotask !== 'function') globalThis.queueMicrotask = callback => Promise.resolve().then(callback);
globalThis.AbortController = AbortController;
globalThis.AbortSignal = AbortSignal;

// React Native's built-in URL (Libraries/Blob/URL.js): href and toString work, most
// components throw "not implemented". The companion package replaces it.
class ReactNativeURL {
  constructor(url, base) {
    this._url = base === undefined ? String(url) : `${String(base).replace(/\/$/, '')}/${String(url).replace(/^\//, '')}`;
  }
  get href() { return this._url; }
  toString() { return this._url; }
  static createObjectURL() { throw new Error('Cannot create URL for blob!'); }
  static revokeObjectURL() {}
}
for (const name of ['hostname', 'pathname', 'port', 'protocol', 'username', 'password', 'search', 'hash', 'host', 'origin']) {
  Object.defineProperty(ReactNativeURL.prototype, name, {
    get() { throw new Error(`URL.${name} is not implemented`); },
    set() { throw new Error(`URL.${name} is not implemented`); },
  });
}
globalThis.URL = ReactNativeURL;
globalThis.URLSearchParams = class URLSearchParams {};

// Test-only: the shared signer checks dispatch a synthetic `new Event('abort')`.
// React Native has no global Event; event-target-shim accepts any { type } object.
if (typeof globalThis.Event !== 'function') {
  globalThis.Event = class Event {
    constructor(type) { this.type = String(type); }
  };
}
