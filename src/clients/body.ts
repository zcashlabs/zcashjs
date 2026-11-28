import { failure } from '../errors.js';

/** Reader over a fetch response body. Streaming bodies are read incrementally;
 * implementations without ReadableStream bodies (e.g. React Native's default fetch)
 * are read once with arrayBuffer() and delivered as a single chunk.
 */
export interface BodyReader {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel(): void;
}

export function streamingUnavailable() {
  return failure('RUNTIME_UNAVAILABLE', 'transport', 'configure',
    'Streaming responses require a fetch implementation with ReadableStream bodies (transportOptions.fetch).');
}

/** Returns undefined when the response carries no body at all. */
export function bodyReader(response: Response, streaming: boolean): BodyReader | undefined {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    return {
      read: () => reader.read(),
      cancel() {
        void reader.cancel().catch(() => { });
        try {
          reader.releaseLock();
        } catch { /* Already released. */ }
      },
    };
  }
  if (streaming) throw streamingUnavailable();
  if (typeof response.arrayBuffer !== 'function') return undefined;
  let pending: Promise<ArrayBuffer> | undefined;
  let done = false;
  return {
    async read() {
      if (done) return { done: true, value: undefined };
      pending ??= response.arrayBuffer();
      const buffer = await pending;
      done = true;
      return buffer.byteLength ? { done: false, value: new Uint8Array(buffer) } : { done: true, value: undefined };
    },
    cancel() {
      done = true;
    },
  };
}

/** Selected fetch: the caller's implementation, or the global one at call time. */
export function selectFetch(supplied: typeof fetch | undefined): typeof fetch {
  const selected = supplied ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof selected !== 'function') {
    throw failure('RUNTIME_UNAVAILABLE', 'transport', 'configure', 'No fetch implementation is available.');
  }
  return selected;
}
