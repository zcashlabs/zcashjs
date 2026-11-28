// React Native (Hermes) global fallbacks, evaluated before any other SDK module: it
// imports only dependency-free modules, so later modules see the patched globals
// when they capture intrinsics at load time (e.g. src/abort.ts).
import { FallbackTextDecoder } from './text-decoder.js';
import { cloneMessage } from './local-channel.js';

const globals = globalThis as Record<string, unknown>;
type Decoder = { decode(input?: Uint8Array): string };

function decoderUsable(): boolean {
  try {
    const Decoder = globals.TextDecoder as (new (label?: string, options?: object) => Decoder) | undefined;
    if (typeof Decoder !== 'function') return false;
    new Decoder('ascii', { fatal: true });
    // Hermes' early TextDecoder ignored `fatal`; require it to reject invalid UTF-8.
    try {
      new Decoder('utf-8', { fatal: true }).decode(Uint8Array.of(0xff));
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}
if (!decoderUsable()) globals.TextDecoder = FallbackTextDecoder;

if (typeof globals.TextEncoder !== 'function') {
  globals.TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8';
    encode(input = ''): Uint8Array {
      const out: number[] = [];
      for (const char of String(input)) {
        let code = char.codePointAt(0)!;
        if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd; // Lone surrogate.
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xc0 | code >> 6, 0x80 | code & 63);
        else if (code < 0x10000) out.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
        else out.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
      }
      return Uint8Array.from(out);
    }
  };
}

if (typeof globals.structuredClone !== 'function') globals.structuredClone = (value: unknown) => cloneMessage(value);

// React Native's abort-controller polyfill predates AbortSignal reasons.
const signalPrototype = AbortSignal.prototype as AbortSignal & Record<string, unknown>;
if (!Object.getOwnPropertyDescriptor(signalPrototype, 'reason')?.get) {
  const reasons = new WeakMap<AbortSignal, unknown>();
  const abort = AbortController.prototype.abort;
  AbortController.prototype.abort = function (this: AbortController, reason?: unknown) {
    if (!this.signal.aborted) {
      reasons.set(this.signal, reason === undefined
        ? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
        : reason);
    }
    return Reflect.apply(abort, this, []);
  };
  Object.defineProperty(signalPrototype, 'reason', {
    configurable: true,
    get(this: AbortSignal) {
      return reasons.get(this);
    },
  });
}
if (typeof signalPrototype.throwIfAborted !== 'function') {
  Object.defineProperty(signalPrototype, 'throwIfAborted', {
    configurable: true,
    writable: true,
    value(this: AbortSignal) {
      if (!this.aborted) return;
      throw this.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    },
  });
}
