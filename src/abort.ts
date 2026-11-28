import { invalidArgument } from './errors.js';

const NativeController = AbortController;
const nativeSignal = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
export const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeAbort = AbortController.prototype.abort;
// React Native's AbortSignal polyfill may not expose a global EventTarget.
function inherited<T>(name: string): T {
  for (let proto: object | null = AbortSignal.prototype; proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor && typeof descriptor.value === 'function') return descriptor.value as T;
  }
  throw new TypeError(`AbortSignal.prototype.${name} is unavailable`);
}
const nativeAdd = inherited<EventTarget['addEventListener']>('addEventListener');
const nativeRemove = inherited<EventTarget['removeEventListener']>('removeEventListener');
/** EventTarget methods captured from AbortSignal at load (no global EventTarget needed). */
export const addListener = nativeAdd;
export const removeListener = nativeRemove;
/** The same methods resolved at call time, honoring later prototype changes. */
export const currentAddListener: EventTarget['addEventListener'] = function (this: EventTarget, ...args) {
  return Reflect.apply(inherited<EventTarget['addEventListener']>('addEventListener'), this, args);
};
export const currentRemoveListener: EventTarget['removeEventListener'] = function (this: EventTarget, ...args) {
  return Reflect.apply(inherited<EventTarget['removeEventListener']>('removeEventListener'), this, args);
};
const signalReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')?.get;
const nativeAny = typeof AbortSignal.any === 'function' ? AbortSignal.any.bind(AbortSignal) : undefined;
const Weak = typeof WeakRef === 'function' ? WeakRef : undefined;

interface Follower { deref(): AbortController | undefined }
// One listener per source; followers are held weakly so abandoned results can be collected.
const followers = new WeakMap<AbortSignal, Set<Follower>>();
function follow(source: AbortSignal, controller: AbortController) {
  let set = followers.get(source);
  if (!set) {
    const created = new Set<Follower>();
    set = created;
    followers.set(source, created);
    nativeAdd.call(source, 'abort', () => {
      followers.delete(source);
      const reason = signalReason?.call(source);
      for (const follower of created) {
        const target = follower.deref();
        if (target) nativeAbort.call(target, reason);
      }
      created.clear();
    }, { once: true });
  }
  // Sweep collected followers so a long-lived source stays bounded.
  for (const follower of set) if (!follower.deref()) set.delete(follower);
  set.add(Weak ? new Weak(controller) : { deref: () => controller });
}

/** AbortSignal.any with a listener-based fallback for engines that lack it. */
export function anySignal(signals: readonly AbortSignal[], options: { fallback?: boolean } = {}): AbortSignal {
  // Resolved at call time like the direct AbortSignal.any calls this replaces.
  const any = (AbortSignal as { any?: typeof AbortSignal.any }).any;
  if (typeof any === 'function' && !options.fallback) return Reflect.apply(any, AbortSignal, [signals]);
  const controller = new NativeController();
  const result: AbortSignal = nativeSignal.call(controller);
  for (const source of signals) {
    if (signalAborted.call(source)) {
      nativeAbort.call(controller, signalReason?.call(source));
      return result;
    }
  }
  for (const source of signals) follow(source, controller);
  // Drop references once the result settles.
  nativeAdd.call(result, 'abort', () => {
    for (const source of signals) {
      const set = followers.get(source);
      if (!set) continue;
      for (const follower of set) if (follower.deref() === controller) set.delete(follower);
    }
  }, { once: true });
  return result;
}

/** AbortSignal.timeout with a timer-based fallback. */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new NativeController();
  const reason = typeof DOMException === 'function'
    ? new DOMException('The operation timed out.', 'TimeoutError')
    : Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
  setTimeout(() => nativeAbort.call(controller, reason), ms);
  return nativeSignal.call(controller);
}
const nodeHost = (globalThis as {
  process?: { versions?: { node?: string }; getBuiltinModule(name: string): unknown };
}).process;
const getBuiltin = nodeHost?.getBuiltinModule?.bind(nodeHost);
const nodeRuntime = typeof nodeHost?.versions?.node === 'string';

// Web IDL rejects signal proxies intrinsically; Node needs its proxy-proof check.
export const unsupportedSignalProxy: (value: unknown) => boolean = (() => {
  try {
    signalAborted.call(new Proxy(new NativeController().signal, {}));
  } catch {
    return () => false;
  }
  return (getBuiltin?.('node:util') as typeof import('node:util') | undefined)?.types.isProxy ?? (() => true);
})();

export function admitSignal(signal: unknown): asserts signal is AbortSignal | undefined {
  if (signal === undefined) return;
  try {
    if (typeof signal !== 'object' || signal === null
      || unsupportedSignalProxy(signal)
      || Object.getPrototypeOf(signal) !== AbortSignal.prototype
      || Object.hasOwn(signal, 'aborted') || Object.hasOwn(signal, 'reason')) throw invalidArgument();
    signalAborted.call(signal);
  } catch {
    throw invalidArgument();
  }
}

/** Forward native cancellation without consulting caller getters or event methods. */
// HTTP callbacks can mutate prototypes; protect only signals consumed by HTTP.
// Other adapters require a native signal without own aborted/reason properties.
export async function bridgeSignal(original?: AbortSignal, protect = false) {
  if (original === undefined) return { signal: undefined, close() { } };
  try {
    if (unsupportedSignalProxy(original)) throw invalidArgument();
    signalAborted.call(original);
    const controller = new NativeController();
    const signal: AbortSignal = nativeSignal.call(controller);
    if (protect) {
      Object.defineProperties(signal, {
        aborted: { get: () => signalAborted.call(signal) },
        addEventListener: { value: nativeAdd.bind(signal) },
        removeEventListener: { value: nativeRemove.bind(signal) },
      });
    }
    let closed = false;
    const onAbort = () => {
      if (!closed && signalAborted.call(original)) nativeAbort.call(controller);
    };
    let dispose: () => void;
    if (nodeRuntime) {
      const { addAbortListener } = getBuiltin!('node:events') as typeof import('node:events');
      // addAbortListener resists stopImmediatePropagation, but reads public methods.
      const view: AbortSignal = nativeSignal.call(new NativeController());
      Object.defineProperties(view, {
        aborted: { get: () => signalAborted.call(original) },
        addEventListener: {
          value: (type: string, listener: EventListener, options: AddEventListenerOptions) =>
            // Synthetic events must not consume the native cancellation listener.
            nativeAdd.call(original, type, listener, { ...options, once: false }),
        },
        removeEventListener: { value: nativeRemove.bind(original) },
      });
      const subscription = addAbortListener(view, onAbort);
      const release = subscription[Symbol.dispose];
      dispose = () => Reflect.apply(release, subscription, []);
    } else {
      // Browser dependent signals propagate independently of caller event delivery.
      const dependent = nativeAny ? nativeAny([original]) : anySignal([original]);
      nativeAdd.call(dependent, 'abort', onAbort);
      dispose = () => nativeRemove.call(dependent, 'abort', onAbort);
    }
    onAbort();
    return {
      signal,
      close() {
        if (!closed) {
          closed = true;
          dispose();
        }
      },
    };
  } catch {
    throw invalidArgument();
  }
}

/** Wait on an SDK-owned signal; detach after each chunk instead of retaining races. */
export function waitFor<T>(value: PromiseLike<T> | T, signal: AbortSignal, error: () => unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => nativeRemove.call(signal, 'abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(error());
    };
    // Always observe late rejection, even when cancellation has already won.
    Promise.resolve(value).then((result) => {
      cleanup();
      resolve(result);
    }, (reason) => {
      cleanup();
      reject(reason);
    });
    if (signalAborted.call(signal)) onAbort();
    else nativeAdd.call(signal, 'abort', onAbort, { once: true });
  });
}

/** Schedule long delays without overflowing the native timer limit. */
export function schedule(callback: () => void, ms: number) {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const left = ms - (performance.now() - start);
    if (left <= 0) callback();
    else timer = setTimeout(arm, Math.min(left, 2147483647));
  };
  timer = setTimeout(arm, Math.min(ms, 2147483647));
  return () => clearTimeout(timer);
}
/** SDK-owned signal; cancellation wakes the caller or rejects with its domain error. */
export function delay(ms: number, signal: AbortSignal, error?: () => Error): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (aborted = false) => {
      stop();
      signal.removeEventListener('abort', onAbort);
      if (aborted && error) reject(error());
      else resolve();
    };
    const onAbort = () => finish(true);
    const stop = schedule(() => finish(), ms);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
