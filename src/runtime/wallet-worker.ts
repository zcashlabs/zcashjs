import type { InitializedViews, InitializedSigners } from '../wallet/session.js';
import { errorTag } from '../errors.js';
import { installWalletWorker } from '../wallet/worker.js';
import { sameRecord, walletProfile } from './wallet-profile.js';
import { checkUnencryptedStorage, encryptStorage, ENCRYPTION_KEY_BYTES, KEY_MISMATCH } from './encrypted-storage.js';
import type { StorageBackend } from './encrypted-storage.js';
import type { WalletRuntimeIdentity } from './wallet-profile.js';

const node = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === 'string';
const builtin = 'node:worker_threads';
const threads = node ? await import(builtin) : undefined;
const control: Pick<MessagePort, 'postMessage' | 'onmessage'> = node
  ? threads.parentPort
  : globalThis as unknown as MessagePort;
let phase: 'new' | 'starting' | 'ready' | 'failed' = 'new';
let api: {
  runtimeIdentity: WalletRuntimeIdentity;
  initializeWalletRuntime(wasm: Uint8Array): {
    readonly invalid: boolean;
    readonly signers: InitializedSigners;
    open(backend: unknown, format: string, parameters: Uint8Array, genesis: Uint8Array): unknown;
    openMemory(format: string, parameters: Uint8Array, genesis: Uint8Array): unknown;
  };
  prepareThreaded(wasm: Uint8Array, count: number): { module: WebAssembly.Module; memory: WebAssembly.Memory };
  enterThreaded(module: WebAssembly.Module, memory: WebAssembly.Memory, index: number, loaded: () => void): never;
  finishThreaded(): ReturnType<typeof api.initializeWalletRuntime>;
  viewsForStorage(storage: unknown): InitializedViews;
  consensusContext(format: string, parameters: Uint8Array, height: number): unknown;
};
let runtime: ReturnType<typeof api.initializeWalletRuntime>;
let signerPort = false;
let initializationId: number | undefined;

function executableUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(node ? 'file:' : 'blob:');
}
function isPort(value: unknown): value is MessagePort {
  return value instanceof (node ? threads.MessagePort : MessagePort);
}
function failed(code: string): never {
  throw new Error(code);
}

type OpenRequest = {
  type: 'open';
  id: unknown;
  port: MessagePort;
  storage: { kind: 'memory' } | {
    kind: 'persistent'; location: string; hostUrl: string; encryptionKey?: Uint8Array; ledger?: Int32Array;
  };
  parametersFormat: string;
  parameters: Uint8Array;
  genesis: Uint8Array;
};
type ControlRequest = OpenRequest

  | {
    type: 'initialize';
    id: unknown;
    moduleUrl: string;
    wasm: Uint8Array;
    expected: unknown;
    maxMemoryBytes: unknown;
    workers: unknown;
  }

  | {
    type: 'compute-initialize';
    moduleUrl: string;
    module: WebAssembly.Module;
    memory: WebAssembly.Memory;
    index: number;
  }
  | { type: 'pool-build' }
  | { type: 'signers'; id: unknown; port: MessagePort };

function openRequest(data: Record<string, unknown>): OpenRequest {
  const storage = data.storage;
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) failed('INVALID_ARGUMENT');
  const record = storage as Record<string, unknown>;
  let location: OpenRequest['storage'];
  if (record.kind === 'memory') {
    if (Object.keys(record).length !== 1) failed('INVALID_ARGUMENT');
    location = { kind: 'memory' };
  } else {
    if (record.kind !== (node ? 'node-filesystem' : 'browser-opfs')) failed('INVALID_ARGUMENT');
    const path = node ? record.path : record.name;
    if (typeof path !== 'string' || !executableUrl(data.hostUrl)) failed('INVALID_ARGUMENT');
    const key = record.encryptionKey;
    const validKey = key instanceof Uint8Array && key.length === ENCRYPTION_KEY_BYTES;
    if (key !== undefined && (!node || !validKey)) failed('INVALID_ARGUMENT');
    const ledger = data.ledger;
    if (ledger !== undefined && (!node || !(ledger instanceof Int32Array)
      || !(ledger.buffer instanceof SharedArrayBuffer))) failed('INVALID_ARGUMENT');
    location = {
      kind: 'persistent',
      location: path,
      hostUrl: data.hostUrl,
      ...(key ? { encryptionKey: key } : {}),
      ...(ledger ? { ledger } : {}),
    };
  }
  if (!isPort(data.port) || !(data.genesis instanceof Uint8Array) || data.genesis.length !== 32
    || !(data.parameters instanceof Uint8Array) || data.parameters.length < 1 || data.parameters.length > 256
    || typeof data.parametersFormat !== 'string') failed('INVALID_ARGUMENT');
  return {
    type: 'open',
    id: data.id,
    storage: location,
    port: data.port,
    parametersFormat: data.parametersFormat,
    parameters: data.parameters,
    genesis: data.genesis,
  };
}

function admit(data: Record<string, unknown>): ControlRequest {
  switch (data.type) {
    case 'compute-initialize':
      if (phase !== 'new') failed('PROTOCOL_MISMATCH');
      if (!executableUrl(data.moduleUrl) || !(data.module instanceof WebAssembly.Module)
        || !(data.memory instanceof WebAssembly.Memory) || !(data.memory.buffer instanceof SharedArrayBuffer)

        || typeof data.index !== 'number'
        || !Number.isSafeInteger(data.index)
        || data.index < 0
        || data.index >= 8) failed('PROTOCOL_MISMATCH');
      return {
        type: data.type,
        moduleUrl: data.moduleUrl,
        module: data.module,
        memory: data.memory,
        index: data.index,
      };
    case 'initialize':
      if (phase !== 'new') failed('PROTOCOL_MISMATCH');
      if (!executableUrl(data.moduleUrl) || !(data.wasm instanceof Uint8Array)) failed('INVALID_ARGUMENT');
      return {
        type: data.type,
        id: data.id,
        moduleUrl: data.moduleUrl,
        wasm: data.wasm,
        expected: data.expected,
        maxMemoryBytes: data.maxMemoryBytes,
        workers: data.workers,
      };
    case 'pool-build':
      if (phase !== 'starting' || initializationId === undefined) failed('PROTOCOL_MISMATCH');
      return { type: data.type };
    case 'signers':
      if (phase !== 'ready' || signerPort || !isPort(data.port)) failed('PROTOCOL_MISMATCH');
      return { type: data.type, id: data.id, port: data.port };
    case 'open':
      if (phase !== 'ready') failed('PROTOCOL_MISMATCH');
      return openRequest(data);
    default: return failed('PROTOCOL_MISMATCH');
  }
}

function checkIdentity(expected: unknown, maxMemoryBytes: unknown) {
  const identity = api.runtimeIdentity;
  if (!identity || !sameRecord(walletProfile, {
    contractRevision: identity.contractRevision, abiVersion: identity.abiVersion, schemas: identity.schemas,
  }) || !sameRecord(expected, {
    contractRevision: identity.contractRevision,
    abiVersion: identity.abiVersion,
    schemas: identity.schemas,
    buildSha256: identity.buildSha256,
    dependencyGraphSha256: identity.dependencyGraphSha256,
    mode: identity.mode,
  })) failed('PROTOCOL_MISMATCH');
  if (!['baseline', 'threaded'].includes(identity.mode) || identity.memory?.shared !== (identity.mode === 'threaded')
    || identity.memory.maximumPages !== 4096 || !Number.isSafeInteger(identity.memory.initialPages)

    || identity.memory.initialPages < 1
    || identity.memory.initialPages > identity.memory.maximumPages) failed('PROTOCOL_MISMATCH');
  if (typeof maxMemoryBytes !== 'number' || !Number.isSafeInteger(maxMemoryBytes)
    || maxMemoryBytes < identity.memory.maximumPages * 65536) failed('RESOURCE_LIMIT');
  return identity;
}

async function initialize(request: Extract<ControlRequest, { type: 'initialize' }>) {
  phase = 'starting';
  api = await import(request.moduleUrl);
  const identity = checkIdentity(request.expected, request.maxMemoryBytes);
  if (identity.mode === 'threaded') {
    const { workers, id } = request;
    if (typeof workers !== 'number' || !Number.isSafeInteger(workers)
      || workers < 1
      || workers > 8) failed('RESOURCE_LIMIT');
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) failed('PROTOCOL_MISMATCH');
    initializationId = id;
    const pool = api.prepareThreaded(request.wasm, workers);
    request.wasm.fill(0);
    control.postMessage({ type: 'pool', id, module: pool.module, memory: pool.memory });
    return;
  }
  runtime = api.initializeWalletRuntime(request.wasm);
  request.wasm.fill(0);
  phase = 'ready';
  control.postMessage({ type: 'ready', identity, id: request.id });
}

async function initializeCompute(request: Extract<ControlRequest, { type: 'compute-initialize' }>) {
  phase = 'starting';
  api = await import(request.moduleUrl);
  // Report loaded only after the generated initializer establishes the child's TLS/stack.
  api.enterThreaded(request.module, request.memory, request.index,
    () => control.postMessage({ type: 'compute-loaded', index: request.index }));
  failed('RUNTIME_UNAVAILABLE');
}

type PersistentRequest = Extract<OpenRequest['storage'], { kind: 'persistent' }>;
async function acquireStorage(storage: PersistentRequest): Promise<StorageBackend> {
  if (node) {
    const filesystem = 'node:fs';
    const fs = await import(filesystem);
    try {
      fs.mkdirSync(storage.location, { mode: 0o700 });
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    }
  }
  const host = await import(storage.hostUrl);
  const backend = await host.acquire(storage.location,
    { create: true, ...(storage.ledger ? { ledger: storage.ledger } : {}) }) as StorageBackend;
  try {
    if (!node) return backend;
    if (!storage.encryptionKey) return checkUnencryptedStorage(backend);
    const cryptoModule = 'node:crypto';
    const crypto = await import(cryptoModule) as typeof import('node:crypto');
    try {
      return encryptStorage(backend, crypto, storage.encryptionKey);
    } finally {
      storage.encryptionKey.fill(0);
    }
  } catch (error) {
    if (backend.owned) backend.release();
    throw error;
  }
}

const isDomException = (error: unknown, name: string) =>
  typeof DOMException === 'function' && error instanceof DOMException && error.name === name;
const knownFailures = new Set([KEY_MISMATCH, 'INVALID_ARGUMENT', 'PROTOCOL_MISMATCH', 'RESOURCE_LIMIT',
  'NETWORK_MISMATCH', 'SCHEMA_MISMATCH', 'VIEWING_SCHEMA_REQUIRED', 'MIGRATION_REQUIRED']);
function failureInfo(error: unknown, fallback: string) {
  const tag = errorTag(error);
  let code = fallback;
  try {
    const systemCode = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    if (systemCode === 'ENOSPC' || systemCode === 'EDQUOT'
      || isDomException(error, 'QuotaExceededError')) code = 'STORAGE_QUOTA';
    else if (systemCode === 'EBUSY'
      || isDomException(error, 'NoModificationAllowedError')) code = 'STORAGE_BUSY';
  } catch { /* Keep the fixed fallback. */ }
  const known = typeof tag === 'string' && knownFailures.has(tag);
  if (known && typeof tag === 'string') code = tag;
  return { code, known };
}

/** Acquisition owns cleanup until both the wallet port and its control receipt are installed. */
async function openStorage(request: OpenRequest): Promise<{ code: string; fatal: boolean } | undefined> {
  let backend: StorageBackend | undefined,
    owner: InitializedViews | undefined;
  let nativeOpening = false,
    fallback = 'RUNTIME_UNAVAILABLE';
  try {
    // Native document validation precedes storage acquisition.
    api.consensusContext(request.parametersFormat, request.parameters, 0);
    fallback = 'STORAGE_ERROR';
    const { storage, parametersFormat, parameters, genesis } = request;
    if (storage.kind === 'persistent') backend = await acquireStorage(storage);
    nativeOpening = true;
    const opened = storage.kind === 'memory'
      ? runtime.openMemory(parametersFormat, parameters, genesis)
      : runtime.open(backend, parametersFormat, parameters, genesis);
    owner = api.viewsForStorage(opened);
    installWalletWorker(owner, request.port, () => runtime.invalid);
    control.postMessage({ type: 'opened', id: request.id });
    return;
  } catch (error) {
    const info = failureInfo(error, fallback);
    let cleanupFailed = false;
    try {
      if (owner) owner.close(owner.generation, owner.instance);
    } catch {
      cleanupFailed = true;
    }
    try {
      if (backend?.owned) backend.release();
    } catch {
      cleanupFailed = true;
      info.code = 'STORAGE_ERROR';
    }
    const fatal = cleanupFailed || runtime?.invalid === true
      || nativeOpening && (!info.known || info.code === 'MIGRATION_REQUIRED');
    return { code: info.code, fatal };
  }
}

function reportFailure(data: Record<string, unknown>, code: string, fatal: boolean) {
  if (fatal) phase = 'failed';
  control.postMessage({ type: 'failure', code, id: data.type === 'pool-build' ? initializationId : data.id, fatal });
}

// Open requests serialize only acquisition; existing wallet ports keep their own queues.
let opening = Promise.resolve();
control.onmessage = ({ data }) => {
  opening = opening.then(() => handle(data));
};
async function handle(raw: unknown) {
  const data: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  try {
    const request = admit(data);
    switch (request.type) {
      case 'initialize': return await initialize(request);
      case 'compute-initialize': return await initializeCompute(request);
      case 'pool-build':
        runtime = api.finishThreaded();
        phase = 'ready';
        control.postMessage({ type: 'ready', identity: api.runtimeIdentity, id: initializationId });
        return;
      case 'signers':
        installWalletWorker(undefined, request.port, () => runtime.invalid, runtime.signers);
        signerPort = true;
        control.postMessage({ type: 'signers-ready', id: request.id });
        return;
      case 'open': {
        const result = await openStorage(request);
        if (result) reportFailure(data, result.code, result.fatal);
      }
    }
  } catch (error) {
    // Invalid open inputs can be corrected; all other control failures invalidate startup.
    const fatal = data.type !== 'open' || phase !== 'ready' || runtime?.invalid === true;
    reportFailure(data, failureInfo(error, 'RUNTIME_UNAVAILABLE').code, fatal);
  }
}
