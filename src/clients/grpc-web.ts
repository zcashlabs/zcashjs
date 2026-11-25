import { signalAborted, unsupportedSignalProxy, waitFor } from '../abort.js';
import type { LightUnaryMethod, LightStreamMethod, ZcashError } from '../types.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';
import { recordNotFound } from './grpc-status.js';
const media = 'application/grpc-web-text+proto';
const service = '/cash.z.wallet.sdk.rpc.CompactTxStreamer/';
const limit = () => failure('RESOURCE_LIMIT', 'transport', 'configure', 'gRPC-Web byte limit exceeded.');
const defaults = Object.freeze({
  messageBytes: 4 * 1024 * 1024,
  chunkBytes: 1024 * 1024,
  wireBytes: 96 * 1024 * 1024,
  decodedBytes: 64 * 1024 * 1024,
  messages: 65536,
});
type Limits = { readonly [K in keyof typeof defaults]: number };
export interface GrpcWebByteOptions {
  readonly timeoutMs: number;
  readonly headers?: () => Promise<Readonly<Record<string, string>>>;
  readonly limits?: Partial<Limits>;
}
const aborted = () => failure('ABORTED', 'transport', 'none', 'Request aborted.');
const timeout = () => failure('TIMEOUT', 'transport', 'none', 'Request timed out.', true);
const transportError = () => failure('TRANSPORT_ERROR', 'transport', 'configure', 'gRPC request failed.');
const protocol = () => failure('PROTOCOL_MISMATCH', 'transport', 'configure', 'Invalid gRPC-Web response.');
type Args<M> = { method: M; request: Uint8Array; signal?: AbortSignal };

const unaryMethods = new Set<LightUnaryMethod>(['GetLatestBlock', 'GetLightdInfo', 'GetTransaction',
  'GetAddressUtxos', 'GetTaddressBalance', 'GetTreeState', 'SendTransaction']);
const streamMethods = new Set<LightStreamMethod>(
  ['GetSubtreeRoots', 'GetBlockRange', 'GetTaddressTransactions', 'GetMempoolStream'],
);
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const tag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArray, 'buffer')!.get!;
const offsetOf = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset')!.get!;
const lengthOf = Object.getOwnPropertyDescriptor(typedArray, 'byteLength')!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

function record(value: unknown, keys?: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(value))

    || Reflect.ownKeys(value).some(
      key => typeof key !== 'string' || (keys && !keys.includes(key)),
    )) {
    throw invalidArgument();
  }
}
function integer(value: unknown, maximum: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1
    || value > maximum) throw invalidArgument();
}
function admit<M extends LightUnaryMethod | LightStreamMethod>(
  args: Args<M>,
  methods: Set<M>,
  limits: Limits,
): Args<M> {
  try {
    record(args, ['method', 'request', 'signal']);
    const { method, request, signal } = args;
    if (!methods.has(method) || tag.call(request) !== 'Uint8Array') throw invalidArgument();
    const buffer = bufferOf.call(request);
    bufferLength.call(buffer); // Ordinary ArrayBuffer intrinsic rejects shared buffers, including prototype spoofs.
    if (resizable?.call(buffer)) throw invalidArgument();
    const view = new Uint8Array(buffer, offsetOf.call(request), lengthOf.call(request)); // Reject detached buffers.
    if (view.length > limits.messageBytes) throw limit();
    if (signal !== undefined) {
      if (unsupportedSignalProxy(signal)) throw invalidArgument();
      signalAborted.call(signal);
    }
    return { method, request: new Uint8Array(view), ...(signal === undefined ? {} : { signal }) };
  } catch (error) {
    if (isZcashError(error)) throw error;
    throw invalidArgument();
  }
}

function encode(request: Uint8Array): string {
  const bytes = new Uint8Array(5 + request.length);
  new DataView(bytes.buffer).setUint32(1, request.length);
  bytes.set(request, 5);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

// Byte to base64 symbol value; '=' maps to 64 and every other byte to -1.
const base64Values = new Int8Array(256).fill(-1);
for (const [index, symbol] of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='].entries()) {
  base64Values[symbol.charCodeAt(0)] = index;
}

async function* decodeBase64(
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>,
  limits: Limits,
): AsyncGenerator<Uint8Array> {
  const quartet: number[] = [];
  let wire = 0,
    decoded = 0;
  for (; ;) {
    const chunk = await read();
    if (chunk.done) break;
    if (chunk.value.length > limits.chunkBytes || chunk.value.length > limits.wireBytes - wire) throw limit();
    wire += chunk.value.length;
    let output = new Uint8Array(12288),
      used = 0;
    for (const byte of chunk.value) {
      const value = base64Values[byte]!;
      if (value < 0) throw protocol();
      quartet.push(value);
      if (quartet.length !== 4) continue;
      const [a, b, c, d] = quartet as [number, number, number, number];
      if (a >= 64 || b >= 64 || (c === 64 && (d !== 64 || (b & 15) !== 0))
        || (c !== 64 && d === 64 && (c & 3) !== 0)) throw protocol();
      decoded += c === 64 ? 1 : d === 64 ? 2 : 3;
      if (decoded > limits.decodedBytes) throw limit();
      output[used++] = (a << 2) | (b >> 4);
      if (c !== 64) output[used++] = (b << 4) | (c >> 2);
      if (d !== 64) output[used++] = (c << 6) | d;
      quartet.length = 0;
      if (used >= 12285) {
        yield output.subarray(0, used);
        output = new Uint8Array(12288);
        used = 0;
      }
    }
    if (used) yield output.subarray(0, used);
  }
  if (quartet.length) throw protocol();
}

function status(value: string | null): void {
  if (value === null || !/^(?:[0-9]|1[0-6])$/.test(value)) throw protocol();
  if (value === '1') throw aborted();
  if (value === '4') throw timeout();
  if (value === '8') throw limit();
  if (value !== '0') {
    const error = failure(value === '12' ? 'METHOD_NOT_SUPPORTED' : 'TRANSPORT_ERROR',
      'transport', 'configure', 'gRPC request failed.', value === '14');
    throw value === '5' ? recordNotFound(error) : error;
  }
}

function trailers(bytes: Uint8Array): void {
  let text = '';
  for (const byte of bytes) {
    if (byte > 127) throw protocol();
    text += String.fromCharCode(byte);
  }
  if (text.endsWith('\r\n')) text = text.slice(0, -2);
  const fields = new Map<string, string>();
  for (const line of text.split('\r\n')) {
    const match = /^([0-9a-z_.-]+):[ \t]*([\t\x20-\x7e]*)$/.exec(line);
    if (!match || fields.has(match[1]!)) throw protocol();
    fields.set(match[1]!, match[2]!.trim());
  }
  // Rich status details require protobuf interpretation, outside this byte profile.
  if (fields.has('grpc-status-details-bin')) throw protocol();
  status(fields.get('grpc-status') ?? null);
}

function requestHeaders(supplied: unknown): Headers {
  record(supplied);
  const headers = new Headers();
  let size = 0;
  for (const key of Reflect.ownKeys(supplied) as string[]) {
    const value = supplied[key];
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)

      || /^(?:grpc-|content-|accept$|x-grpc-web$|x-user-agent$|host$|cookie$|referer$|origin$|user-agent$)/i.test(key)) {
      throw invalidArgument();
    }
    size += key.length + value.length + 32;
    if (size > 8192) throw invalidArgument();
    headers.set(key, value);
  }
  headers.set('content-type', media);
  headers.set('accept', media);
  headers.set('grpc-encoding', 'identity');
  headers.set('grpc-accept-encoding', 'identity');
  headers.set('x-grpc-web', '1');
  headers.set('x-user-agent', 'grpc-web-javascript/0.1');
  return headers;
}

function responseStatus(current: Response, limits: Limits): boolean {
  let headerBytes = 0;
  for (const [name, value] of current.headers) {
    headerBytes += name.length + value.length + 32;
    if (headerBytes > 8192) throw limit();
  }
  const declared = current.headers.get('content-length');
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared)) throw protocol();
    if (BigInt(declared) > BigInt(limits.wireBytes)) throw limit();
  }
  if (current.status !== 200) throw transportError();
  if (!/^application\/grpc-web-text(?:\+proto)?(?:\s*;\s*charset=utf-8)?$/i.test(
    current.headers.get('content-type') ?? '',
  )
  || (current.headers.has('grpc-encoding') && current.headers.get('grpc-encoding') !== 'identity')
  || (current.headers.has('content-encoding') && current.headers.get('content-encoding') !== 'identity')
  || current.headers.has('grpc-status-details-bin')) throw protocol();
  const headersOnly = current.headers.has('grpc-status');
  if (headersOnly) status(current.headers.get('grpc-status'));
  return headersOnly;
}

/** Assemble messages and require exactly one terminal status, without owning the stream. */
async function* decodeFrames(
  chunks: AsyncIterable<Uint8Array>,
  limits: Limits,
  terminal: boolean,
): AsyncGenerator<Uint8Array> {
  const header = new Uint8Array(5);
  let count = 0;
  let headerUsed = 0,
    payload: Uint8Array | undefined,
    payloadUsed = 0;
  for await (const chunk of chunks) {
    let offset = 0;
    while (offset < chunk.length) {
      if (terminal) throw protocol();
      if (!payload) {
        const size = Math.min(5 - headerUsed, chunk.length - offset);
        header.set(chunk.subarray(offset, offset + size), headerUsed);
        offset += size;
        headerUsed += size;
        if (headerUsed !== 5) continue;
        if (header[0] !== 0 && header[0] !== 128) throw protocol();
        const length = new DataView(header.buffer).getUint32(1);
        if (length > (header[0] === 128 ? 8192 : limits.messageBytes)
          || length > limits.decodedBytes) throw limit();
        if (header[0] === 0 && ++count > limits.messages) throw limit();
        payload = new Uint8Array(length);
      }
      const size = Math.min(payload.length - payloadUsed, chunk.length - offset);
      payload.set(chunk.subarray(offset, offset + size), payloadUsed);
      offset += size;
      payloadUsed += size;
      if (payloadUsed !== payload.length) continue;
      if (header[0] === 128) {
        trailers(payload);
        terminal = true;
      } else yield payload;
      payload = undefined;
      payloadUsed = 0;
      headerUsed = 0;
    }
  }
  if (!terminal || headerUsed || payload) throw protocol();
}

function messages(url: string, args: Args<LightUnaryMethod | LightStreamMethod>, limits: Limits,
  options: GrpcWebByteOptions): AsyncIterableIterator<Uint8Array> {
  const controller = new AbortController();
  let stopped: ZcashError | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started: number | undefined;
  let finished = false,
    busy = false,
    cleaned = false;
  const onAbort = () => stop(aborted());
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    // Foreign listener teardown must not replace the outcome or skip owned cancellation.
    try {
      if (args.signal) EventTarget.prototype.removeEventListener.call(args.signal, 'abort', onAbort);
    } catch { /* Best effort on a caller-owned signal. */ }
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => { });
      reader.releaseLock();
    } else void response?.body?.cancel().catch(() => { });
  }
  function stop(error: ZcashError) {
    if (stopped || finished) return;
    stopped = error;
    cleanup();
    void iterator.return(undefined).catch(() => { });
  }
  function check() {
    if (!stopped && started !== undefined && performance.now() - started >= options.timeoutMs) stop(timeout());
    if (stopped) throw stopped;
  }
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    const value = await waitFor(promise, controller.signal, () => stopped ?? aborted());
    check();
    return value;
  }
  async function* responseChunks(): AsyncGenerator<Uint8Array> {
    for await (const chunk of decodeBase64(() => bounded(reader!.read()), limits)) {
      check();
      yield chunk;
    }
  }
  async function* run(): AsyncGenerator<Uint8Array> {
    try {
      const endpoint = new URL(url);
      endpoint.pathname = service + args.method;
      let headers: Headers;
      try {
        const supplied = options.headers ? await bounded(Promise.resolve().then(() => options.headers!())) : {};
        headers = requestHeaders(supplied);
      } catch {
        throw stopped ?? invalidArgument();
      }
      const body = encode(args.request);
      check();
      const current = await bounded(fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrer: '',
        referrerPolicy: 'no-referrer',
      }).then((value) => {
        response = value;
        if (stopped || finished) void value.body?.cancel().catch(() => { });
        return value;
      }));
      const headersOnly = responseStatus(current, limits);
      if (!current.body) {
        if (headersOnly) return;
        throw protocol();
      }
      reader = current.body.getReader();
      for await (const payload of decodeFrames(responseChunks(), limits, headersOnly)) {
        check();
        yield payload;
        check();
      }
      check();
    } finally {
      cleanup();
    }
  }
  const iterator = run();
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (finished) return { value: undefined, done: true };
      if (busy) throw invalidArgument();
      busy = true;
      try {
        if (started === undefined) {
          started = performance.now();
          if (args.signal) {
            EventTarget.prototype.addEventListener.call(args.signal, 'abort', onAbort, { once: true });
            if (signalAborted.call(args.signal)) stop(aborted());
          }
          if (!stopped) timer = setTimeout(() => stop(timeout()), options.timeoutMs);
        }
        check();
        const result = await iterator.next();
        if (result.done) {
          finished = true;
          cleanup();
        }
        return result;
      } catch (error) {
        finished = true;
        cleanup();
        throw stopped ?? (isZcashError(error) ? error : transportError());
      } finally {
        busy = false;
      }
    },
    async return() {
      if (!finished) {
        stop(aborted());
        finished = true;
      }
      return { value: undefined, done: true };
    },
  };
}

/** Internal byte profile only; no public GrpcTransport/LightClient identity or handshake. */
export function createGrpcWebByteTransport(url: string, options: GrpcWebByteOptions) {
  let limits: Limits;
  let snapshot: GrpcWebByteOptions;
  try {
    if (typeof url !== 'string' || /[\s\\#]/.test(url)) throw invalidArgument();
    const authority = /^https?:\/\/([^/?]+)/i.exec(url)?.[1];
    if (!authority || authority.includes('@')) throw invalidArgument();
    const endpoint = new URL(url);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
      || endpoint.pathname !== '/') throw invalidArgument();
    url = endpoint.href;
    record(options, ['timeoutMs', 'headers', 'limits']);
    const { timeoutMs, headers, limits: supplied } = options;
    integer(timeoutMs, 2147483647);
    if (headers !== undefined && typeof headers !== 'function') throw invalidArgument();
    const values = { ...defaults };
    if (supplied !== undefined) {
      record(supplied, Object.keys(defaults));
      for (const key of Reflect.ownKeys(supplied) as (keyof Limits)[]) {
        const value = supplied[key];
        integer(value, defaults[key]);
        Object.assign(values, { [key]: value });
      }
    }
    limits = Object.freeze(values);
    snapshot = Object.freeze({ timeoutMs, ...(headers === undefined ? {} : { headers }) });
  } catch {
    throw invalidArgument();
  }
  return Object.freeze({
    async unary(args: Args<LightUnaryMethod>): Promise<Uint8Array> {
      const owned = admit(args, unaryMethods, limits);
      let result: Uint8Array | undefined;
      for await (const message of messages(url, owned, limits, snapshot)) {
        if (result) throw protocol();
        result = message;
      }
      if (!result) throw protocol();
      return result;
    },
    stream(args: Args<LightStreamMethod>): AsyncIterableIterator<Uint8Array> {
      const owned = admit(args, streamMethods, limits);
      return messages(url, owned, limits, snapshot);
    },
  });
}
