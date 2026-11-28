import { bridgeSignal, waitFor } from './abort.js';
import type { BlockHash, HttpTransport, Op, TransportOptions, ZcashError } from './types.js';
import { failure, invalidArgument, isZcashError } from './errors.js';
import { JsonNumber, parseJson, protocolError } from './json.js';
import type { Json } from './json.js';
import { blockHash } from './primitives.js';
import { copyRecord } from './clients/owned-plumbing.js';
import { bodyReader, selectFetch } from './clients/body.js';
import type { BodyReader } from './clients/body.js';

interface State {
  readonly url: string;
  readonly options: TransportOptions;
  nextId: bigint;
}
const transports = new WeakMap<HttpTransport, State>();
const rpcCodes = new WeakMap<object, number>();
/** Only errors produced from a validated RPC envelope carry trusted status. */
export function rpcErrorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null ? rpcCodes.get(error) : undefined;
}
export function httpSourceId(transport: HttpTransport): string {
  const state = transports.get(transport);
  if (!state) throw invalidArgument();
  return state.options.sourceId;
}
/** Private route identity; credentials supplied by headers are never part of this value. */
export function httpEndpoint(transport: HttpTransport): string {
  const state = transports.get(transport);
  if (!state) throw invalidArgument();
  return state.url;
}
const readMethods = new Set(['getblockchaininfo', 'getblockhash', 'getblock', 'getblockheader',
  'getrawtransaction', 'getrawmempool', 'getaddressutxos', 'z_gettreestate', 'z_getsubtreesbyindex']);

function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw invalidArgument();
  }
}
function integer(value: unknown, minimum: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalidArgument();
}

export function httpTransport(url: string, options: Partial<TransportOptions> = {}): HttpTransport {
  let endpoint: URL;
  let message = 'HTTP endpoint must be an absolute HTTP(S) URL without credentials or a fragment.';
  try {
    if (typeof url !== 'string' || url.trim() !== url) throw invalidArgument();
    endpoint = new URL(url);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
      || url.includes('#')) throw invalidArgument();
    message = 'HTTP transport options must contain only sourceId, timeoutMs, readRetry, maxResponseBytes, '
      + 'headers and fetch.';
    record(options, ['sourceId', 'timeoutMs', 'readRetry', 'maxResponseBytes', 'headers', 'fetch']);
    const {
      sourceId = 'public-rpc', timeoutMs = 30000,
      readRetry = { attempts: 2, delayMs: 500 },
      maxResponseBytes = 4 * 1024 * 1024, headers, fetch: fetcher,
    } = options;
    message = 'HTTP readRetry must contain attempts and delayMs.';
    record(readRetry, ['attempts', 'delayMs']);
    const snapshot: TransportOptions = {
      sourceId,
      timeoutMs,
      maxResponseBytes,
      ...(headers === undefined ? {} : { headers }),
      ...(fetcher === undefined ? {} : { fetch: fetcher }),
      readRetry: { attempts: readRetry.attempts, delayMs: readRetry.delayMs },
    };
    message = 'HTTP sourceId must be a nonempty string.';
    if (typeof snapshot.sourceId !== 'string' || snapshot.sourceId.trim().length === 0) throw invalidArgument();
    message = 'HTTP timeoutMs must be a positive safe integer.';
    integer(snapshot.timeoutMs, 1);
    message = 'HTTP maxResponseBytes must be a positive safe integer.';
    integer(snapshot.maxResponseBytes, 1);
    message = 'HTTP readRetry.attempts must be a positive safe integer.';
    integer(snapshot.readRetry.attempts, 1);
    message = 'HTTP readRetry.delayMs must be a nonnegative safe integer.';
    integer(snapshot.readRetry.delayMs, 0);
    message = 'HTTP headers must be a callback.';
    if (snapshot.headers !== undefined && typeof snapshot.headers !== 'function') throw invalidArgument();
    message = 'HTTP fetch must be a function.';
    if (snapshot.fetch !== undefined && typeof snapshot.fetch !== 'function') throw invalidArgument();
    Object.freeze(snapshot.readRetry);
    Object.freeze(snapshot);
    const transport = Object.freeze({}) as HttpTransport;
    transports.set(transport, { url: endpoint.href, options: snapshot, nextId: 0n });
    return transport;
  } catch {
    throw failure('INVALID_ARGUMENT', 'validation', 'correct-input', message);
  }
}

function aborted(): ZcashError {
  return failure('ABORTED', 'transport', 'none', 'Request aborted.');
}
function timeout(): ZcashError {
  return failure('TIMEOUT', 'transport', 'none', 'Request timed out.', true);
}
function transportError(retryable = true): ZcashError {
  return failure('TRANSPORT_ERROR', 'transport', 'configure', 'HTTP JSON-RPC request failed.', retryable);
}
function resourceLimit(): ZcashError {
  return failure('RESOURCE_LIMIT', 'transport', 'configure', 'Response exceeds configured byte limit.');
}

// Chunk long timers so valid safe-integer durations cannot overflow host timers.
function schedule(ms: number, callback: () => void): () => void {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const remaining = ms - (performance.now() - start);
    if (remaining <= 0) callback();
    else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
  };
  timer = setTimeout(tick, Math.min(ms, 2_147_483_647));
  return () => clearTimeout(timer);
}

function requestHeaders(supplied: unknown): Headers {
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) throw invalidArgument();
  const headers = new Headers();
  for (const key of Reflect.ownKeys(supplied)) {
    if (typeof key !== 'string') throw invalidArgument();
    const value = (supplied as Record<string, unknown>)[key];
    if (typeof value !== 'string') throw invalidArgument();
    headers.set(key, value);
  }
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  return headers;
}

function responseStatus(response: Response, maximum: number): ZcashError | undefined {
  const httpError = response.ok
    ? undefined
    : transportError([408, 429, 500, 502, 503, 504].includes(response.status));
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared)) throw protocolError();
    if (BigInt(declared) > BigInt(maximum)) throw resourceLimit();
  }
  return httpError;
}

/** Decode actual stream bytes; the request owner bounds reads and releases the reader. */
async function readText(read: () => Promise<ReadableStreamReadResult<Uint8Array>>, maximum: number): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const chunks: string[] = [];
  let bytes = 0;
  for (; ;) {
    const chunk = await read();
    if (chunk.done) break;
    if (chunk.value.byteLength > maximum - bytes) throw resourceLimit();
    bytes += chunk.value.byteLength;
    try {
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    } catch {
      throw protocolError();
    }
  }
  try {
    chunks.push(decoder.decode());
  } catch {
    throw protocolError();
  }
  return chunks.join('');
}

function parseResponse(text: string, id: string, httpError: ZcashError | undefined): Json {
  let result: Json;
  try {
    result = parseEnvelope(text, id);
  } catch (error) {
    // Servers may use HTTP 500 for a structured RPC failure. Preserve those
    // semantics; a non-JSON HTTP error page is still an HTTP transport failure.
    if (httpError && isZcashError(error) && error.code === 'PROTOCOL_MISMATCH') throw httpError;
    throw error;
  }
  if (httpError) throw httpError;
  return result;
}

/** One deadline includes the header callback, dispatch, body and parsing. */
async function attempt(
  state: State,
  body: string,
  id: string,
  caller?: AbortSignal,
  dispatched?: () => void,
): Promise<Json> {
  if (caller?.aborted) throw aborted();
  const controller = new AbortController();
  let stopped: ZcashError | undefined;
  const stop = (error: ZcashError) => {
    if (stopped) return;
    stopped = error;
    controller.abort();
  };
  const onAbort = () => stop(aborted());
  caller?.addEventListener('abort', onAbort, { once: true });
  const cancelTimer = schedule(state.options.timeoutMs, () => stop(timeout()));
  const started = performance.now();
  let reader: BodyReader | undefined;
  let response: Response | undefined;
  const bounded = <T>(promise: Promise<T>) => waitFor(promise, controller.signal, () => stopped);
  try {
    let headers: Headers;
    try {
      const supplied = state.options.headers
        ? await bounded(Promise.resolve().then(() => state.options.headers!()))
        : {};
      headers = requestHeaders(supplied);
    } catch {
      throw stopped ?? invalidArgument();
    }
    if (caller?.aborted) throw aborted();
    if (stopped) throw stopped;
    // Header callbacks and processing can block the timeout timer.
    if (performance.now() - started >= state.options.timeoutMs) throw timeout();
    // Cancel a late response even if a nonconforming injected fetch ignores abort.
    dispatched?.();
    const fetcher = selectFetch(state.options.fetch);
    const fetching = fetcher(state.url, {
      method: 'POST',
      body,
      headers,
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    }).then((value) => {
      response = value;
      if (stopped) void value.body?.cancel().catch(() => { });
      return value;
    });
    response = await bounded(fetching);
    const httpError = responseStatus(response, state.options.maxResponseBytes);
    reader = bodyReader(response, false);
    if (!reader) throw httpError ?? protocolError();
    const text = await readText(() => bounded(reader!.read()), state.options.maxResponseBytes);
    if (stopped) throw stopped;
    const result = parseResponse(text, id, httpError);
    // Synchronous parsing cannot be interrupted by a timer; check elapsed time.
    if (performance.now() - started >= state.options.timeoutMs) throw timeout();
    return result;
  } catch (error) {
    if (stopped) throw stopped;
    if (isZcashError(error)) throw error;
    throw transportError();
  } finally {
    cancelTimer();
    caller?.removeEventListener('abort', onAbort);
    // Never await a foreign stream's cancellation promise past the deadline.
    if (reader) reader.cancel();
    else if (response) void response.body?.cancel().catch(() => { });
    controller.abort();
  }
}

function object(value: Json): value is { [key: string]: Json } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof JsonNumber);
}
function parseEnvelope(text: string, id: string): Json {
  const envelope = parseJson(text);
  if (!object(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== id
    || Object.keys(envelope).some(key => !['jsonrpc', 'id', 'result', 'error'].includes(key))
    || Object.hasOwn(envelope, 'result') === Object.hasOwn(envelope, 'error')) throw protocolError();
  if (Object.hasOwn(envelope, 'result')) return envelope.result!;
  const error = envelope.error!;
  if (!object(error) || !(error.code instanceof JsonNumber) || typeof error.message !== 'string'
    || !/^-?(?:0|[1-9][0-9]*)$/.test(error.code.text)
    || !Number.isSafeInteger(Number(error.code.text))
    || Object.keys(error).some(key => !['code', 'message', 'data'].includes(key))) throw protocolError();
  const normalized = error.code.text === '-32601'
    ? failure('METHOD_NOT_SUPPORTED', 'transport', 'configure', 'RPC method is not supported.')
    : transportError(false);
  rpcCodes.set(normalized, Number(error.code.text));
  throw normalized;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw aborted();
  if (ms === 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cancel();
      signal?.removeEventListener('abort', onAbort);
      reject(aborted());
    };
    const cancel = schedule(ms, () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type RpcParameter = string | number | boolean | { readonly addresses: readonly string[]; readonly chainInfo: true };
function ownParameters(method: string, params: readonly RpcParameter[]): RpcParameter[] {
  const parameters = [...params];
  if (method === 'getaddressutxos' && parameters.length === 1 && typeof parameters[0] === 'object') {
    const input = parameters[0];
    record(input, ['addresses', 'chainInfo']);
    const { addresses, chainInfo } = input;
    if (!Array.isArray(addresses) || addresses.length < 1
      || addresses.length > 1024
      || chainInfo !== true) throw invalidArgument();
    const owned: string[] = [];
    const count = addresses.length;
    for (let index = 0; index < count; index++) {
      const value: unknown = addresses[index];
      if (typeof value !== 'string' || !value.length || value.length > 512) throw invalidArgument();
      owned.push(value);
    }
    return [{ addresses: owned, chainInfo: true }];
  }
  if (parameters.some(value => !['string', 'boolean'].includes(typeof value)
    && !(typeof value === 'number' && Number.isSafeInteger(value)))) throw invalidArgument();
  return parameters;
}

/** Read an endpoint-reported genesis identity before defining a custom network. */
export async function readGenesisHash(transport: HttpTransport, args: Op = {}): Promise<BlockHash> {
  const owned = await bridgeSignal(copyRecord(args, ['signal']).signal, true);
  try {
    const value = await readRpc(transport, 'getblockhash', [0], owned.signal);
    try {
      return blockHash(value as string);
    } catch {
      throw protocolError();
    }
  } finally {
    owned.close();
  }
}

/** Internal read engine; no public raw-RPC escape hatch or broadcast replay. */
export async function readRpc(
  transport: HttpTransport,
  method: string,
  params: readonly RpcParameter[],
  signal?: AbortSignal,
): Promise<Json> {
  const state = transports.get(transport);
  if (!state || !readMethods.has(method) || !Array.isArray(params)
    || (signal !== undefined && !(signal instanceof AbortSignal))) throw invalidArgument();
  const parameters = ownParameters(method, params);
  for (let index = 0; index < state.options.readRetry.attempts; index++) {
    const id = (++state.nextId).toString();
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: parameters });
    try {
      return await attempt(state, body, id, signal);
    } catch (error) {
      if (!isZcashError(error) || !error.retryable || index + 1 >= state.options.readRetry.attempts) throw error;
      await delay(state.options.readRetry.delayMs, signal);
    }
  }
  throw invalidArgument();
}

/** Internal single-attempt write. Before dispatch errors throw; afterward uncertainty is explicit. */
export async function sendRawTransaction(
  transport: HttpTransport,
  hex: string,
  signal?: AbortSignal,
): Promise<{ result: Json } | { error: unknown }> {
  const state = transports.get(transport);
  if (!state || typeof hex !== 'string' || !hex.length || hex.length > 4 * 1024 * 1024

    || hex.length % 2 !== 0
    || !/^[0-9a-f]+$/.test(hex)
    || (signal !== undefined && !(signal instanceof AbortSignal))) throw invalidArgument();
  const id = (++state.nextId).toString();
  const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'sendrawtransaction', params: [hex] });
  let dispatched = false;
  try {
    return {
      result: await attempt(state, body, id, signal, () => {
        dispatched = true;
      }),
    };
  } catch (error) {
    if (!dispatched) throw error;
    return { error };
  }
}
