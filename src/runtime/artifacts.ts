import { waitFor, addListener, removeListener } from '../abort.js';
/* eslint-disable no-control-regex -- Canonical encoding and URL validation intentionally match ASCII control characters. */
import type { ArtifactFile, ArtifactManifest, WasmArtifact, ZcashError } from '../types.js';
import { failure, invalidArgument, isZcashError } from '../errors.js';
import { bundledArtifact, bundledUrls } from './bundled-assets.mjs';
import { packageAsset } from './package-assets.js';
import { sha256Hex } from '../hash.js';

/** Internal exact profile supplied by the integration owner. No supported production
 * ABI, operation, network-parameter or host-service revisions are assumed here. */
export interface ArtifactPolicy {
  readonly contractRevision: string;
  readonly abiVersion: string;
  readonly mode: ArtifactManifest['mode'];
  readonly schemas: ArtifactManifest['schemas'];
  readonly maxManifestBytes: number;
  readonly maxAssetBytes: number;
  readonly maxTotalAssetBytes: number;
  readonly maxFiles: number;
  readonly timeoutMs: number;
}

export interface VerifiedArtifacts {
  readonly manifest: ArtifactManifest;
  /** Each read returns a new owned copy; no stored verified buffer is exposed. */
  copyFile(relativeUrl: string): Uint8Array;
  copyManifest(): Uint8Array;
  dispose(): void;
}

// Use native signal slots/hooks; caller-owned shadow properties are untrusted.
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const signalAdd = addListener;
const signalRemove = removeListener;

const digestPattern = /^[0-9a-f]{64}$/;
const kinds = ['module', 'worker', 'wasm', 'glue', 'thread-bootstrap'];
const schemaKeys = ['operations', 'protobuf', 'networkParameters', 'database', 'hostServices'];
function unavailable(): ZcashError {
  return failure(
    'RUNTIME_UNAVAILABLE',
    'runtime',
    'configure',
    'Artifact acquisition or integrity verification failed.',
  );
}
function limit(): ZcashError {
  return failure('RESOURCE_LIMIT', 'runtime', 'configure', 'Artifact exceeds configured limits.');
}
function mismatch(): ZcashError {
  return failure('PROTOCOL_MISMATCH', 'runtime', 'configure', 'Artifact profile is incompatible.');
}
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw invalidArgument();
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  object(value);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length
    || own.some(key => typeof key !== 'string' || !keys.includes(key))) throw invalidArgument();
}
function positive(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw invalidArgument();
}
function revision(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw invalidArgument();
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw invalidArgument();
}
function schemas(value: unknown): void {
  exact(value, schemaKeys);
  for (const key of ['protobuf', 'networkParameters', 'database']) revision(value[key]);
  for (const key of ['operations', 'hostServices']) {
    const map = value[key];
    object(map);
    for (const [name, version] of Object.entries(map)) {
      revision(name);
      revision(version);
    }
  }
}
function scalarCompare(a: string, b: string): number {
  const x = Array.from(a, c => c.codePointAt(0)!);
  const y = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}
/** Re-encoding also rejects duplicate keys: JSON.parse cannot preserve a duplicate,
 * so its canonical output can never equal an input containing duplicate members.
 * The schema needs at most four containers; eight bounds malformed nesting. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 8) throw invalidArgument();
  if (typeof value === 'string') {
    for (const c of value) {
      const n = c.codePointAt(0)!;
      if (n >= 0xd800 && n <= 0xdfff) throw invalidArgument();
    }
    return '"' + value.replace(/["\\\u0000-\u001f]/g, c => c === '"' || c === '\\'
      ? '\\' + c
      : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"';
  }
  if (typeof value === 'number') {
    positive(value);
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  object(value);
  return '{' + Object.keys(value).sort(scalarCompare).map(
    key => canonical(key, depth + 1) + ':' + canonical(value[key], depth + 1),
  ).join(',') + '}';
}
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
function manifestSchema(value: unknown): asserts value is ArtifactManifest {
  exact(
    value,
    ['format', 'contractRevision', 'abiVersion', 'schemas', 'buildSha256', 'dependencyGraphSha256', 'mode', 'files'],
  );
  if (value.format !== 'zcash-artifact/1'
    || !['baseline', 'threaded'].includes(value.mode as string)) throw invalidArgument();
  revision(value.contractRevision);
  revision(value.abiVersion);
  schemas(value.schemas);
  digest(value.buildSha256);
  digest(value.dependencyGraphSha256);
  if (!Array.isArray(value.files) || value.files.length === 0) throw invalidArgument();
  for (const file of value.files) {
    exact(file, ['url', 'sha256', 'byteLength', 'kind', 'mediaType']);
    revision(file.url);
    digest(file.sha256);
    positive(file.byteLength);
    if (!kinds.includes(file.kind as string)
      || file.mediaType !== (file.kind === 'wasm' ? 'application/wasm' : 'text/javascript')) throw invalidArgument();
  }
}
function manifestUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value.startsWith('https://')
    || /[\s\\?#\u0000-\u001f\u007f]/u.test(value)) throw invalidArgument();
  const url = new URL(value);
  const authority = value.slice(8).split('/')[0]!;
  if (!authority || url.protocol !== 'https:' || url.username || url.password
    || authority.includes('@')) throw invalidArgument();
  return url;
}
/** Validate a selected or fallback-only artifact without fetching it. */
export function artifactEndpoint(artifact: WasmArtifact): URL {
  try {
    exact(artifact, ['manifestUrl', 'manifestSha256']);
    digest(artifact.manifestSha256);
    return manifestUrl(artifact.manifestUrl);
  } catch {
    throw invalidArgument();
  }
}
function assetUrl(file: ArtifactFile, directory: URL): string {
  const path = file.url;
  if (path.trim() !== path || /[\\%?#\u0000-\u001f\u007f]/u.test(path)

    || path.split('/')[0]!.includes(':')
    || path.split('/').some(part => ['', '.', '..'].includes(part))) throw invalidArgument();
  const resolved = new URL(path, directory);
  if (resolved.origin !== directory.origin
    || !resolved.pathname.startsWith(directory.pathname)) throw invalidArgument();
  return resolved.href;
}
async function sha(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return sha256Hex(bytes);
}

/** Acquisition only. Inspects the entire declared inventory before fetching assets;
 * never imports, instantiates, starts workers, or opens storage. The later loader
 * must confine transitive imports/bootstrap to this inventory and consume verified
 * copies under platform CSP. This component cannot establish closure completeness. */
export async function acquireArtifacts(
  artifact: WasmArtifact,
  supplied: ArtifactPolicy,
  caller?: AbortSignal,
): Promise<VerifiedArtifacts> {
  let endpoint: URL,
    pin: string,
    policy: ArtifactPolicy;
  try {
    endpoint = artifact === bundledArtifact ? new URL(artifact.manifestUrl) : artifactEndpoint(artifact);
    pin = artifact.manifestSha256;
    // Snapshot all caller-owned configuration before asynchronous admission.
    policy = structuredClone(supplied);
    exact(
      policy,
      [
        'contractRevision',
        'abiVersion',
        'mode',
        'schemas',
        'maxManifestBytes',
        'maxAssetBytes',
        'maxTotalAssetBytes',
        'maxFiles',
        'timeoutMs',
      ],
    );
    revision(policy.contractRevision);
    revision(policy.abiVersion);
    schemas(policy.schemas);
    if (!['baseline', 'threaded'].includes(policy.mode)) throw invalidArgument();
    for (const key of [
      'maxManifestBytes',
      'maxAssetBytes',
      'maxTotalAssetBytes',
      'maxFiles',
      'timeoutMs',
    ] as const) positive(policy[key]);
    canonical(policy.schemas);
    if (caller !== undefined) {
      if (!(caller instanceof AbortSignal)) throw invalidArgument();
      signalAborted.call(caller); // Native brand validation before starting any timer.
    }
  } catch {
    throw invalidArgument();
  }
  const controller = new AbortController();
  let stopped: ZcashError | undefined;
  const stop = (error: ZcashError) => {
    if (!stopped) {
      stopped = error;
      controller.abort();
    }
  };
  const onAbort = () => stop(failure('ABORTED', 'runtime', 'none', 'Artifact acquisition aborted.'));
  const started = performance.now();
  const timeout = () => failure('TIMEOUT', 'runtime', 'configure', 'Artifact acquisition timed out.');
  const check = () => {
    if (stopped) throw stopped;
    if (performance.now() - started >= policy.timeoutMs) {
      stop(timeout());
      throw stopped;
    }
  };
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const remaining = policy.timeoutMs - (performance.now() - started);
    if (remaining <= 0) stop(timeout());
    else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
  };
  const bounded = <T>(promise: Promise<T>) => waitFor(promise, controller.signal, () => stopped);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  let manifestBytes: Uint8Array<ArrayBuffer> | undefined;
  const discard = () => {
    manifestBytes?.fill(0);
    for (const bytes of files.values()) bytes.fill(0);
    files.clear();
  };

  async function read(
    url: string, media: string | undefined, maximum: number, expected?: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    let complete = false;
    try {
      check();
      response = await bounded<Response>((artifact === bundledArtifact
        ? packageAsset(url, controller.signal)
        : fetch(url, {
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          })).then((value) => {
        response = value;
        if (stopped) void value.body?.cancel().catch(() => { });
        return value;
      }));
      check();
      if (!response.ok || response.redirected || response.type === 'opaqueredirect'
        || (response.url && response.url !== url)) throw unavailable();
      if (media !== undefined
        && response.headers.get('content-type')?.split(';')[0]!.trim().toLowerCase() !== media) throw invalidArgument();
      // Fetch exposes decoded bytes. A compressed wire Content-Length does not
      // describe that representation. CORS may hide Content-Encoding entirely;
      // decoded stream bounds, exact asset lengths and hashes remain authoritative.
      const encoding = response.headers.get('content-encoding');
      const declared = (!encoding && response.type !== 'cors') || encoding?.trim().toLowerCase() === 'identity'
        ? response.headers.get('content-length')
        : null;
      if (declared !== null) {
        if (!/^[0-9]+$/.test(declared)) throw invalidArgument();
        if (BigInt(declared) > BigInt(maximum)) throw limit();
        if (expected !== undefined && BigInt(declared) !== BigInt(expected)) throw unavailable();
      }
      if (!response.body) throw unavailable();
      reader = response.body.getReader();
      // One bounded destination avoids retaining arbitrarily many tiny stream chunks.
      bytes = new Uint8Array(expected ?? maximum);
      let size = 0;
      for (; ;) {
        const chunk = await bounded(reader.read());
        check();
        if (chunk.done) break;
        if (chunk.value.byteLength > maximum - size) throw limit();
        if (chunk.value.byteLength > bytes.length - size) throw unavailable();
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      if (expected !== undefined && size !== expected) throw unavailable();
      if (declared !== null && BigInt(declared) !== BigInt(size)) throw unavailable();
      complete = true;
      return bytes.subarray(0, size);
    } finally {
      if (!complete) bytes?.fill(0);
      // Nonconforming stream cancellation must not extend the operation deadline.
      if (reader) {
        void reader.cancel().catch(() => { });
        reader.releaseLock();
      } else if (response) void response.body?.cancel().catch(() => { });
    }
  }

  try {
    tick();
    if (caller) {
      signalAdd.call(caller, 'abort', onAbort, { once: true });
      if (signalAborted.call(caller)) onAbort();
    }
    check();
    manifestBytes = await read(endpoint.href, undefined, policy.maxManifestBytes);
    if (await bounded(sha(manifestBytes)) !== pin) throw unavailable();
    check();
    let manifest: unknown;
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(manifestBytes);
      manifest = JSON.parse(text);
      if (canonical(manifest) !== text) throw invalidArgument();
      manifestSchema(manifest);
    } catch {
      throw invalidArgument();
    }
    // Exact profile comparison, including the complete operation/host-service maps.
    if (manifest.mode !== policy.mode || manifest.contractRevision !== policy.contractRevision

      || manifest.abiVersion !== policy.abiVersion
      || canonical(manifest.schemas) !== canonical(policy.schemas)) throw mismatch();
    if (manifest.files.length > policy.maxFiles) throw limit();
    const directory = new URL('.', endpoint);
    const urls = manifest.files.map((file) => {
      const confined = assetUrl(file, directory);
      if (artifact !== bundledArtifact) return confined;
      const shipped = bundledUrls()[`wallet/${file.url}`];
      if (!shipped) throw unavailable();
      return shipped.href;
    });
    if (new Set(urls).size !== urls.length) throw invalidArgument();
    const count = (kind: string) => manifest.files.filter(file => file.kind === kind).length;
    if (count('module') !== 1 || count('worker') !== 1 || count('wasm') < 1
      || (manifest.mode === 'threaded' && count('thread-bootstrap') < 1)) throw invalidArgument();
    let total = 0;
    for (const file of manifest.files) {
      if (file.byteLength > policy.maxAssetBytes || file.byteLength > policy.maxTotalAssetBytes - total) throw limit();
      total += file.byteLength;
    }
    for (const [i, file] of manifest.files.entries()) {
      const bytes = await read(urls[i]!, file.mediaType, policy.maxAssetBytes, file.byteLength);
      files.set(file.url, bytes); // Retain for cleanup even if digesting fails or aborts.
      if (await bounded(sha(bytes)) !== file.sha256) throw unavailable();
      check();
    }
    freeze(manifest);
    check();
    let disposed = false;
    const live = () => {
      if (disposed) throw failure('CLOSED', 'runtime', 'none', 'Verified artifacts are disposed.');
    };
    return Object.freeze({
      manifest,
      copyFile(relativeUrl: string) {
        live();
        const bytes = files.get(relativeUrl);
        if (!bytes) throw invalidArgument();
        return bytes.slice();
      },
      copyManifest() {
        live();
        return manifestBytes!.slice();
      },
      dispose() {
        if (!disposed) {
          disposed = true;
          discard();
        }
      },
    });
  } catch (error) {
    discard();
    if (stopped) throw stopped;
    if (isZcashError(error)) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer!);
    if (caller) signalRemove.call(caller, 'abort', onAbort);
    controller.abort();
  }
}
