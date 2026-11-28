// In-process MessageChannel for platforms without workers (React Native). Delivery is
// asynchronous (one task per message) and payloads are cloned like structured clone,
// so either side may zero or reuse its buffers without affecting the other.

type Listener = ((event: { data: unknown }) => unknown) | null;

const schedule: (callback: () => void) => void = typeof setImmediate === 'function'
  ? callback => setImmediate(callback)
  : callback => setTimeout(callback, 0);

class DataCloneError extends Error {
  override readonly name = 'DataCloneError';
}

/** Clone message data. Local ports are transferred by reference; bytes are copied. */
export function cloneMessage(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw new DataCloneError('Value cannot be cloned.');
    return value;
  }
  if (seen.has(value)) return seen.get(value);
  if (value instanceof LocalPort) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as unknown as { constructor: new (bytes: ArrayBufferLike) => unknown; buffer: ArrayBuffer };
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    if (value instanceof DataView) return new DataView(bytes.buffer);
    const element = (value as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    const Typed = view.constructor as unknown as new (b: ArrayBufferLike, o: number, l: number) => unknown;
    return new Typed(bytes.buffer, 0, value.byteLength / element);
  }
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(cloneMessage(k, seen), cloneMessage(v, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const v of value) copy.add(cloneMessage(v, seen));
    return copy;
  }
  if (value instanceof Error) {
    const copy = new Error(value.message);
    copy.name = value.name;
    return copy;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneMessage(item, seen));
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new DataCloneError('Value cannot be cloned.');
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = cloneMessage((value as Record<string, unknown>)[key], seen);
  return copy;
}

export class LocalPort {
  peer: LocalPort | undefined;
  private queue: unknown[] = [];
  private started = false;
  private closed = false;
  private listener: Listener = null;
  onmessageerror: Listener = null;

  get onmessage(): Listener {
    return this.listener;
  }

  set onmessage(listener: Listener) {
    this.listener = listener;
    // Assigning onmessage starts the port, as for a real MessagePort.
    if (listener) this.start();
  }

  postMessage(data: unknown, _transfer?: unknown): void {
    void _transfer;
    if (this.closed) return;
    const target = this.peer;
    if (!target || target.closed) return;
    const copy = cloneMessage(data);
    target.enqueue(copy);
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.flush();
  }

  close(): void {
    this.closed = true;
    this.queue = [];
    this.listener = null;
    this.onmessageerror = null;
  }

  private enqueue(data: unknown) {
    this.queue.push(data);
    if (this.started) this.flush();
  }

  private flush() {
    while (this.queue.length) {
      const data = this.queue.shift();
      schedule(() => {
        if (this.closed) return;
        const listener = this.listener;
        if (listener) void listener({ data });
      });
    }
  }
}

export class LocalChannel {
  readonly port1 = new LocalPort();
  readonly port2 = new LocalPort();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}
