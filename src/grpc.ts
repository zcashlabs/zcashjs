import type {
  GrpcTransport,
  TransportOptions,
  CustomLightTransport,
  LightUnaryMethod,
  LightStreamMethod,
} from './types.js';
import { invalidArgument, failure, isZcashError } from './errors.js';

import { ownBytes } from './clients/owned-plumbing.js';

const transports = new WeakMap<GrpcTransport, Readonly<{ url: string; options: TransportOptions }>>();

// Capture data once: header callbacks are invoked only by an actual request.
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object'
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw invalidArgument();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw invalidArgument();
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, 'value')) throw invalidArgument();
    result[key] = field.value;
  }
  return result;
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum) throw invalidArgument();
  return value;
}

/** Opaque configuration only; platform loading and connections are lazy. */
export function grpc(url: string, options: TransportOptions): GrpcTransport {
  let message = 'gRPC endpoint must be an HTTP(S) origin without credentials, path, query or fragment.';
  try {
    if (typeof url !== 'string' || /[\s\\?#]/.test(url) || !/^https?:\/\//.test(url)) throw invalidArgument();
    const authority = /^https?:\/\/([^/]+)/.exec(url)?.[1];
    if (!authority || authority.includes('@')) throw invalidArgument();
    const endpoint = new URL(url);
    if (endpoint.username || endpoint.password || endpoint.pathname !== '/') throw invalidArgument();
    message = 'gRPC options require sourceId, positive timeoutMs and maxResponseBytes, '
      + 'readRetry attempts/delayMs, and an optional headers callback.';
    const input = record(options, ['sourceId', 'timeoutMs', 'readRetry', 'maxResponseBytes', 'headers']);
    const retry = record(input.readRetry, ['attempts', 'delayMs']);
    if (typeof input.sourceId !== 'string' || !input.sourceId.trim() || input.sourceId.length > 256
      || (input.headers !== undefined && typeof input.headers !== 'function')) throw invalidArgument();
    const snapshot: TransportOptions = Object.freeze({
      sourceId: input.sourceId,
      timeoutMs: integer(input.timeoutMs, 1, 2_147_483_647),
      maxResponseBytes: integer(input.maxResponseBytes, 1),
      readRetry: Object.freeze({ attempts: integer(retry.attempts, 1), delayMs: integer(retry.delayMs, 0) }),
      ...(input.headers === undefined ? {} : { headers: input.headers as NonNullable<TransportOptions['headers']> }),
    });
    const transport = Object.freeze({}) as GrpcTransport;
    // Preserve the explicit authority/port; URL normalization drops default ports.
    transports.set(transport, Object.freeze({ url, options: snapshot }));
    return transport;
  } catch {
    throw failure('INVALID_ARGUMENT', 'validation', 'correct-input', message);
  }
}

export function grpcBinding(transport: GrpcTransport) {
  const binding = transports.get(transport);
  if (!binding) throw invalidArgument();
  return binding;
}

const nodeProcess = (globalThis as {
  process?: {
    versions?: { node?: string };
    getBuiltinModule?(name: string): { types: { isProxy(value: unknown): boolean } };
  };
}).process;
const protocolRevision = 'lightwire:80575dbe59a9bf2e6b79e2391eb78679c453f1a0477292eb97ea3b58bb6c8b10:d8d0c8aaa5ceec7d5dcc188ef25b04011df2ec0254901620fce982fc13aeb32d';
const aborted = () => failure('ABORTED', 'transport', 'none', 'Request aborted.');
const limited = () => failure('RESOURCE_LIMIT', 'transport', 'configure', 'gRPC byte limit exceeded.');
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
function checkpoint(signal: AbortSignal) {
  if (signalAborted.call(signal)) throw aborted();
}
function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  checkpoint(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

/** Internal lazy platform bridge. Only unary reads are eligible for configured retries. */
export function grpcAdapter(transport: GrpcTransport): CustomLightTransport {
  const { url, options } = grpcBinding(transport);
  let platform: Promise<Pick<CustomLightTransport, 'unary' | 'stream'>> | undefined;
  const load = () => platform ??= (async () => {
    const limits = { messageBytes: Math.min(options.maxResponseBytes, 4 * 1024 * 1024) };
    const common = {
      timeoutMs: options.timeoutMs,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    };
    if (nodeProcess?.versions?.node) {
      // Keep the Node-only dependency out of browser bundles.
      const path = './clients/grpc-node.js';
      const { createGrpcNodeTransport } = await import(/* @vite-ignore */ path) as typeof import(
        './clients/grpc-node.js'
      );
      return createGrpcNodeTransport(
        url,
        {
          ...common,
          sourceId: options.sourceId,
          limits: { ...limits, totalBytes: Math.min(options.maxResponseBytes, 64 * 1024 * 1024) },
          // Reuse the HTTP/2 connection across polls instead of a TLS handshake per request.
          channelIdleMs: 30_000,
        },
      );
    }
    const { createGrpcWebByteTransport } = await import('./clients/grpc-web.js');
    return createGrpcWebByteTransport(
      url,
      { ...common, limits: { ...limits, decodedBytes: Math.min(options.maxResponseBytes, 64 * 1024 * 1024) } },
    );
  })().catch(() => {
    throw failure('RUNTIME_UNAVAILABLE', 'runtime', 'configure', 'gRPC adapter unavailable.');
  });
  function admit<M extends LightUnaryMethod | LightStreamMethod>(
    args: { method: M; request: Uint8Array; signal?: AbortSignal },
  ) {
    const input = record(args, ['method', 'request', 'signal']);
    if (typeof input.method !== 'string') throw invalidArgument();
    const request = ownBytes(input.request as Uint8Array, invalidArgument, limited);
    let signal: AbortSignal;
    try {
      if (input.signal !== undefined) {
        if (nodeProcess?.versions?.node
          && nodeProcess.getBuiltinModule?.('node:util').types.isProxy(input.signal)) throw invalidArgument();
        signalAborted.call(input.signal);
      }
      signal = AbortSignal.any(input.signal === undefined ? [] : [input.signal as AbortSignal]);
    } catch {
      throw invalidArgument();
    }
    checkpoint(signal);
    return { method: input.method as M, request, signal };
  }
  return Object.freeze<CustomLightTransport>({
    kind: 'custom-lightwallet',
    sourceId: options.sourceId,
    protocolRevision,
    async unary(args) {
      const owned = admit(args);
      const adapter = await wait(load(), owned.signal);
      const attempts = owned.method === 'SendTransaction' ? 1 : options.readRetry.attempts;
      for (let attempt = 0; ; attempt++) {
        checkpoint(owned.signal);
        try {
          return await adapter.unary(owned);
        } catch (error) {
          if (attempt + 1 >= attempts || !isZcashError(error) || !error.retryable) throw error;
          let remaining = options.readRetry.delayMs;
          while (remaining > 0) {
            const chunk = Math.min(remaining, 2147483647);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await wait(new Promise<void>((resolve) => {
                timer = setTimeout(resolve, chunk);
              }), owned.signal);
            } finally {
              clearTimeout(timer);
            }
            remaining -= chunk;
          }
        }
      }
    },
    stream(args) {
      const owned = admit(args),
        stop = new AbortController();
      const signal = AbortSignal.any([owned.signal, stop.signal]);
      let iterator: AsyncIterator<Uint8Array> | undefined,
        done = false,
        pending: Promise<IteratorResult<Uint8Array>> | undefined;
      const result: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          if (done) return Promise.resolve({ done: true, value: undefined });
          if (pending) return Promise.reject(invalidArgument());
          pending = (async () => {
            const adapter = await wait(load(), signal);
            checkpoint(signal);
            iterator ??= adapter.stream({ ...owned, signal })[Symbol.asyncIterator]();
            const value = await iterator.next();
            if (value.done) done = true;
            return value;
          })().catch((error) => {
            done = true;
            throw error;
          }).finally(() => {
            pending = undefined;
          });
          return pending;
        },
        async return() {
          done = true;
          stop.abort();
          await pending?.catch(() => { });
          await iterator?.return?.();
          return { done: true, value: undefined };
        },
      };
      return result;
    },
  });
}
