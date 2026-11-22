import { nodeRuntime as node, stageWalletWorkers } from './worker-platform.js';
import type { RuntimeWorker } from './worker-platform.js';
import type { NetworkDefinition, Op, RuntimeOptions, WalletStorage, WasmArtifact, ZcashError } from '../types.js';
import { errorMessage, failure, invalidArgument, isZcashError } from '../errors.js';
import { bindNetworkDefinition } from '../network-parameters.js';
import { admitSignal } from '../abort.js';
import { copyRecord } from '../clients/owned-plumbing.js';
import { operation } from '../clients/light-chain-reads.js';
import type { WalletQueueBudget } from '../wallet/host.js';
import { attachWalletWorker } from '../wallet/host.js';
import { acquireArtifacts, artifactEndpoint } from './artifacts.js';
import { bundledArtifact } from './bundled-assets.mjs';
import { sameRecord, walletProfile } from './wallet-profile.js';
import type { WalletRuntimeIdentity } from './wallet-profile.js';

const unavailable = () => failure('RUNTIME_UNAVAILABLE', 'runtime', 'configure', 'Wallet runtime unavailable.');
const mismatch = () => failure('PROTOCOL_MISMATCH', 'runtime', 'configure', 'Wallet runtime profile mismatch.');
const cancelled = () => failure('ABORTED', 'runtime', 'none', 'Wallet startup aborted.');
const timeout = () => failure('TIMEOUT', 'runtime', 'configure', 'Wallet startup timed out.');
const resource = () => failure('RESOURCE_LIMIT', 'runtime', 'configure', 'Wallet runtime limit unsupported.');
const layout = {
  'wallet.mjs': 'module',
  'worker.mjs': 'worker',
  'bindings_bg.wasm': 'wasm',
  'node-fs.mjs': 'glue',
  'opfs.mjs': 'glue',
} as const;
// Reviewed private producer + actual SDK bootstrap, not arbitrary same-profile JavaScript.
// Updating this immutable executable closure requires reviewing the corresponding package.
const reviewedAssets: Record<keyof typeof layout, string> = {
  'wallet.mjs': 'ac9be94513f2b97d4d264e7f1db061935e73f9929f21d08addf02b4433587a9f',
  'worker.mjs': '3e30e1eed005181582fcc3b287f4dd6494433390fb24c7df6d4f2e5033a2cdc6',
  'bindings_bg.wasm': '0b33894e8e8787ce360434ec04c4aa2d96e4f0511291f8a48fcf04f1352ba0cf',
  'node-fs.mjs': 'e5ae70677191f3eb9898ea3dac0182cf10491cd98ef04c33ad4edfdb0265bd3e',
  'opfs.mjs': 'ac1c6f7bd38467e655ff84c1a28154a5f9086fb1e877dc9709b21d4fa4c2c645',
};
// Independently reviewed threaded producer and worker bootstrap closure.
const reviewedThreadedAssets: Record<string, string> = {
  'wallet.mjs': '893c2eec26ff96fc05ab85cbc99920b707721fb66f8abca2b94a8a5b2881ac6b',
  'worker.mjs': '3e30e1eed005181582fcc3b287f4dd6494433390fb24c7df6d4f2e5033a2cdc6',
  'bindings_bg.wasm': 'ec80085fcd075292245617e6a7befa46a7437b671f8725d5767ac52f7f919591',
  'node-fs.mjs': 'e5ae70677191f3eb9898ea3dac0182cf10491cd98ef04c33ad4edfdb0265bd3e',
  'opfs.mjs': 'ac1c6f7bd38467e655ff84c1a28154a5f9086fb1e877dc9709b21d4fa4c2c645',
  'thread-bootstrap.mjs': '3e30e1eed005181582fcc3b287f4dd6494433390fb24c7df6d4f2e5033a2cdc6',
};
const policy = {
  ...walletProfile,
  mode: 'baseline' as const,
  maxManifestBytes: 16384,
  maxAssetBytes: 32 * 1024 * 1024,
  maxTotalAssetBytes: 40 * 1024 * 1024,
  maxFiles: 5,
  timeoutMs: 30000,
};

function record(value: unknown, keys: string[]): Record<string, unknown> {
  return copyRecord(value, keys);
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw invalidArgument();
  return value;
}
function artifact(value: unknown): WasmArtifact {
  const fields = record(value, ['manifestUrl', 'manifestSha256']);
  if (typeof fields.manifestUrl !== 'string' || typeof fields.manifestSha256 !== 'string') throw invalidArgument();
  const result = { manifestUrl: fields.manifestUrl, manifestSha256: fields.manifestSha256 };
  artifactEndpoint(result);
  return result;
}
export function runtimeOptions(value: unknown): RuntimeOptions {
  const supplied = record(
    value === undefined ? {} : value,
    [
      'baseline',
      'threading',
      'maxMemoryBytes',
      'maxQueuedBytes',
      'maxQueuedJobs',
      'scanBatchSize',
      'maxPcztBytes',
      'onDiagnostic',
    ],
  );
  const fields = {
    baseline: bundledArtifact,
    threading: { mode: 'baseline' },
    maxMemoryBytes: 1024 * 1024 * 1024,
    maxQueuedBytes: 128 * 1024 * 1024,
    maxQueuedJobs: 8,
    scanBatchSize: 16,
    maxPcztBytes: 4 * 1024 * 1024,
    onDiagnostic: undefined,
    ...supplied,
  };
  const raw = record(fields.threading, ['mode', 'artifact', 'workers', 'startupTimeoutMs']);
  let threading: RuntimeOptions['threading'];
  if (raw.mode === 'baseline' && Object.keys(raw).length === 1) threading = { mode: 'baseline' };
  else if (raw.mode === 'prefer-threaded' && Object.keys(raw).length === 4) {
    threading = {
      mode: raw.mode,
      artifact: artifact(raw.artifact),
      workers: positive(raw.workers),
      startupTimeoutMs: positive(raw.startupTimeoutMs),
    };
    if (threading.workers > 8) throw resource();
  } else throw invalidArgument();
  const diagnostic = fields.onDiagnostic;
  if (diagnostic !== undefined && typeof diagnostic !== 'function') throw invalidArgument();
  return {
    baseline: fields.baseline === bundledArtifact ? bundledArtifact : artifact(fields.baseline),
    threading,
    maxMemoryBytes: positive(fields.maxMemoryBytes),
    maxQueuedBytes: positive(fields.maxQueuedBytes),
    maxQueuedJobs: positive(fields.maxQueuedJobs),
    scanBatchSize: positive(fields.scanBatchSize),
    maxPcztBytes: positive(fields.maxPcztBytes),
    ...(diagnostic === undefined ? {} : { onDiagnostic: event => Reflect.apply(diagnostic, fields, [event]) }),
  };
}
export function walletStorage(value: unknown): WalletStorage {
  const storage = record(value, ['kind', 'path', 'name', 'encryptionKey']);
  if (storage.kind !== 'memory' && storage.kind !== (node ? 'node-filesystem' : 'browser-opfs')) throw unavailable();
  if (storage.kind === 'memory') {
    if (Object.keys(storage).length !== 1) throw invalidArgument();
    return { kind: 'memory' };
  }
  const name = storage[node ? 'path' : 'name'];
  const key = storage.encryptionKey;
  if (key !== undefined && !node) throw unavailable();
  if (key !== undefined && (!(key instanceof Uint8Array) || key.length !== 32)) throw invalidArgument();
  if (Object.keys(storage).length !== (key === undefined ? 2 : 3) || typeof name !== 'string' || !name.length
    || name.includes('\0') || (!node && !/^[a-zA-Z0-9_-]{1,128}$/.test(name))) throw invalidArgument();
  if (!node) return { kind: 'browser-opfs', name };
  // Defensive copy: the caller may clear its key after the factory returns.
  return key === undefined
    ? { kind: 'node-filesystem', path: name }
    : { kind: 'node-filesystem', path: name, encryptionKey: Uint8Array.from(key) };
}

/** Browser capabilities only; this does not qualify a threaded artifact. */
export function browserThreadingPrerequisites(): boolean {
  return globalThis.isSecureContext === true && globalThis.crossOriginIsolated === true
    && typeof SharedArrayBuffer === 'function' && typeof Worker === 'function'
    && typeof Atomics === 'object' && typeof Atomics.wait === 'function' && typeof Atomics.notify === 'function';
}

/** Internal baseline construction. The returned session is not the complete WalletClient. */
export async function openWalletRuntime(
  options: { runtime: RuntimeOptions; storage: WalletStorage; network: NetworkDefinition } & Op,
) {
  const input = record(options, ['runtime', 'storage', 'network', 'signal']);
  const runtime = runtimeOptions(input.runtime);
  const { baseline, threading } = runtime;
  const threaded = threading.mode === 'prefer-threaded' && (node || browserThreadingPrerequisites());
  const fallback = threading.mode === 'prefer-threaded' && !node && !browserThreadingPrerequisites();
  // Reserve native maximum, verified inventory + executable staging copies, one
  // WASM initialization copy, manifest working space, and admitted payload/control
  // records. This bounds owned-allocation admission, not the engine/process RSS.
  // Reserve conversion space for bounded scan lowering and <=6 MiB native query
  // JSON, including parsed/projected records, <=2 MiB raw bytes and reply copies.
  const nativeScratchBytes = 64 * 1024 * 1024;
  const reserved = nativeScratchBytes + 4096 * 65536 + 2 * policy.maxTotalAssetBytes + policy.maxAssetBytes
    + 4 * policy.maxManifestBytes + runtime.maxQueuedBytes + 8192 * runtime.maxQueuedJobs
    + (threaded && threading.mode === 'prefer-threaded' ? threading.workers * policy.maxAssetBytes : 0)
    + 8192 * 1024; // Native lifetime signer ceiling: one retained token/cleanup control each.
  if (!Number.isSafeInteger(reserved) || runtime.maxMemoryBytes < reserved) throw resource();
  const storage = walletStorage(input.storage);
  const network = bindNetworkDefinition(
    record(input.network, ['identity', 'genesisHash', 'parameters', 'parametersFormat']),
  );
  const parameters = network.parameters.bytes;
  const genesis = Uint8Array.from(network.genesisHash.match(/../g)!.reverse(), hex => parseInt(hex, 16));
  const signal = input.signal;
  admitSignal(signal);

  const pending = operation(signal);
  try {
    pending.check();
  } catch (error) {
    pending.close();
    throw error;
  }
  // Same immutable executable and limits share authority; no key migration across owners.
  const key = JSON.stringify(
    [
      baseline.manifestUrl,
      baseline.manifestSha256,
      threading.mode,
      ...(threading.mode === 'prefer-threaded'
        ? [
            threading.artifact.manifestUrl,
            threading.artifact.manifestSha256,
            threading.workers,
            threading.startupTimeoutMs,
          ]
        : []),
      runtime.maxMemoryBytes,
      runtime.maxQueuedBytes,
      runtime.maxQueuedJobs,
      runtime.maxPcztBytes,
    ],
  );
  let entry = owners.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { refs: 0, wallets: 0, controller, ready: undefined! };
    const created = entry;
    const forget = () => {
      if (owners.get(key) === created) owners.delete(key);
    };
    entry.ready = createOwner(
      threaded && threading.mode === 'prefer-threaded' ? threading.artifact : baseline,
      runtime,
      runtime.maxMemoryBytes - reserved,
      controller.signal,
      forget,
      threaded,
    ).catch(
      async (error) => {
        if (!threaded || controller.signal.aborted || !error
          || typeof error !== 'object'
          || !bootstrapFailures.has(error)) {
          forget();
          throw error;
        }
        return createOwner(
          baseline,
          runtime,
          runtime.maxMemoryBytes - reserved,
          controller.signal,
          forget,
          false,
        ).catch((error) => {
          forget();
          throw error;
        });
      },
    );
    owners.set(key, entry);
  }
  if (entry.wallets >= runtime.maxQueuedJobs) {
    pending.close();
    throw resource();
  }
  entry.refs++;
  entry.wallets++;
  const selected = entry;
  let released = false,
    capacityReleased = false;
  const release = async (abandoned = false) => {
    if (!abandoned && !capacityReleased) {
      capacityReleased = true;
      selected.wallets--;
    }
    if (released) return;
    released = true;
    selected.refs--;
    if (!selected.refs) {
      if (owners.get(key) === selected) owners.delete(key);
      selected.controller.abort();
      try {
        await (await selected.ready).destroy();
      } catch { /* Startup failure owns its cleanup. */ }
    }
  };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let opening: Promise<OpenedWallet> | undefined;
  let opened: OpenedWallet | undefined;
  try {
    pending.check();
    const owner = await pending.wait(selected.ready);
    pending.check();
    try {
      runtime.onDiagnostic?.(
        Object.freeze(
          owner.identity.mode === 'threaded'
            ? { code: 'THREADED_SELECTED', reason: 'ready' }
            : fallback
              ? { code: 'THREADED_FALLBACK', reason: 'prerequisiteMissing' }
              : threaded
                ? { code: 'THREADED_FALLBACK', reason: 'bootstrapFailed' }
                : { code: 'BASELINE_SELECTED', reason: 'requested' },
        ),
      );
    } catch { /* Diagnostics do not own startup. */ }
    pending.check();
    opening = owner.open(storage, network.parametersFormat, parameters, genesis, release);
    const timed = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(timeout()), 30000);
    });
    opened = await pending.wait(Promise.race([opening, timed]));
    pending.check();
    return Object.freeze({
      identity: owner.identity,
      // Previously reviewed external runtimes predate the restore command.
      supportsMnemonicRestoration: owner.identity.mode === 'baseline'
        && baseline.manifestSha256 === bundledArtifact.manifestSha256,
      session: opened.session,
      close: opened.close,
      // Internal signer composition retains this owner independently of its creating wallet.
      owner: Object.freeze({
        identity: owner.token,
        check: owner.check,
        maxPcztBytes: runtime.maxPcztBytes,
        signers: owner.signers,
        invalidate: owner.invalidate,
        retain() {
          owner.check();
          selected.refs++;
          let done = false;
          return async () => {
            if (done) return;
            done = true;
            selected.refs--;
            if (!selected.refs) {
              if (owners.get(key) === selected) owners.delete(key);
              selected.controller.abort();
              await owner.destroy();
            }
          };
        },
      }),
    });
  } catch (error) {
    if (opened) await opened.close().catch(() => { });
    else if (opening) {
      // An abandoned acquisition keeps a capacity slot, never a lifetime lease.
      // Last-consumer destruction also cancels a host acquisition that cannot settle.
      await release(true);
      void opening.then(value => value.close(), () => release()).catch(() => { });
    } else await release();
    throw error;
  } finally {
    clearTimeout(deadline);
    pending.close();
  }
}

type OpenedWallet = { session: ReturnType<typeof attachWalletWorker>; close(): Promise<void> };
type Owner = Awaited<ReturnType<typeof createOwner>>;
const bootstrapFailures = new WeakSet<object>();
const owners = new Map<string, { refs: number; wallets: number; controller: AbortController; ready: Promise<Owner> }>();

async function createOwner(
  baseline: WasmArtifact,
  runtime: RuntimeOptions,
  provingCapacity: number,
  signal: AbortSignal,
  forget: () => void,
  threaded = false,
) {
  let worker: RuntimeWorker | undefined;
  const children: RuntimeWorker[] = [];
  let spawnChild: ((
    index: number,
    pool: { module: WebAssembly.Module; memory: WebAssembly.Memory },
  ) => void)
  | undefined;
  const startup: { phase: 'assets' | 'executing' | 'pool' | 'ready' | 'admitted'; loaded: Set<number> } = {
    phase: 'assets', loaded: new Set(),
  };
  const sessions = new Set<ReturnType<typeof attachWalletWorker>>();
  const budget: WalletQueueBudget = {
    jobs: 0,
    bytes: 0,
    active: false,
    wake: new Set(),
    signers: new Map(),
    proving: { capacity: provingCapacity, bytes: 0, active: false },
  };
  let removeAssets = () => { };
  let destroying: Promise<void> | undefined,
    stopped: ZcashError | undefined;
  let nextId = 0;
  const waiting = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: unknown): void }>();
  const destroy = () => destroying ??= Promise.resolve().then(async () => {
    if (startup.phase === 'admitted') forget();
    try {
      const results = await Promise.allSettled([worker, ...children].map(async (value) => {
        await value?.terminate();
      }));
      if (results.some(result => result.status === 'rejected')) throw unavailable();
    } finally {
      for (const value of [worker, ...children]) value?.removeEvents();
      removeAssets();
    }
  });
  const stop = (error: ZcashError) => {
    if (stopped) return;
    stopped = error;
    if (startup.phase === 'admitted') forget();
    for (const request of waiting.values()) request.reject(error);
    waiting.clear();
    for (const session of sessions) session.crashed();
    void destroy().catch(() => { });
  };
  budget.crash = () => stop(failure('WORKER_CRASHED', 'runtime', 'reopen', 'Wallet worker failed.'));
  const check = () => {
    if (signal.aborted) throw cancelled();
    if (stopped) throw stopped;
  };
  const onAbort = () => stop(cancelled());
  signal.addEventListener('abort', onAbort, { once: true });
  const workers = runtime.threading.mode === 'prefer-threaded' ? runtime.threading.workers : 0;
  const timer = setTimeout(
    () => stop(timeout()),
    threaded && runtime.threading.mode === 'prefer-threaded' ? runtime.threading.startupTimeoutMs : 30000,
  );
  const request = (value: object, transfer: Transferable[] = []) => new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      if (nextId >= Number.MAX_SAFE_INTEGER) {
        reject(resource());
        return;
      }
      const id = ++nextId;
      try {
        check();
        waiting.set(id, { resolve, reject });
        worker!.postMessage({ ...value, id }, transfer);
      } catch (error) {
        waiting.delete(id);
        reject(error);
      }
    },
  );
  const message = (raw: unknown) => {
    if (stopped) return;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      stop(mismatch());
      return;
    }
    const data = raw as Record<string, unknown>;
    if (typeof data.id !== 'number' || !Number.isSafeInteger(data.id)) {
      stop(mismatch());
      return;
    }
    if (threaded && data?.type === 'pool') {
      if (startup.phase !== 'executing' || !waiting.has(data.id)
        || !(data.module instanceof WebAssembly.Module)
        || !(data.memory instanceof WebAssembly.Memory)
        || !(data.memory.buffer instanceof SharedArrayBuffer)) {
        stop(mismatch());
        return;
      }
      startup.phase = 'pool';
      try {
        for (let i = 0; i < workers; i++) spawnChild!(i, { module: data.module, memory: data.memory });
      } catch {
        stop(unavailable());
      }
      return;
    }
    const pending = waiting.get(data?.id);
    if (!pending) {
      stop(mismatch());
      return;
    }
    waiting.delete(data.id);
    if (data?.type === 'failure') {
      const codes = [
        'STORAGE_ERROR',
        'STORAGE_BUSY',
        'STORAGE_QUOTA',
        'STORAGE_KEY_MISMATCH',
        'NETWORK_MISMATCH',
        'INVALID_ARGUMENT',
        'RESOURCE_LIMIT',
        'PROTOCOL_MISMATCH',
        'RUNTIME_UNAVAILABLE',
      ] as const;
      const code = (data.code === 'SCHEMA_MISMATCH' || data.code === 'VIEWING_SCHEMA_REQUIRED')
        ? 'MIGRATION_REQUIRED'
        : data.code;
      const known = code === 'MIGRATION_REQUIRED' ? code : codes.find(value => value === code);
      pending.reject(
        known
          ? failure(
              known,
              known.startsWith('STORAGE') || known === 'MIGRATION_REQUIRED' ? 'storage' : 'runtime',
              'configure',
              errorMessage(known),
            )
          : unavailable(),
      );
    } else {
      if (data?.type === 'ready') {
        const poolLoaded = startup.phase === 'pool' && startup.loaded.size === workers;
        startup.phase = 'ready';
        if (threaded && !poolLoaded) {
          pending.reject(mismatch());
          stop(mismatch());
          return;
        }
      }
      pending.resolve(data);
    }
    if (data.fatal === true) stop(unavailable());
  };
  try {
    check();
    const verified = await acquireArtifacts(
      baseline,
      { ...policy, mode: threaded ? 'threaded' : 'baseline', maxFiles: threaded ? 6 : 5 },
      signal,
    );
    try {
      check();
      const selectedLayout = threaded ? { ...layout, 'thread-bootstrap.mjs': 'thread-bootstrap' } : layout;
      const selectedAssets = threaded ? reviewedThreadedAssets : reviewedAssets;
      // The exact package manifest also authenticates an externally hosted copy.
      if (verified.manifest.files.length !== (threaded ? 6 : 5)
        || verified.manifest.files.some(
          file => !Object.hasOwn(selectedLayout, file.url)
            || (selectedLayout as Record<string, string>)[file.url] !== file.kind
            || (baseline.manifestSha256 !== bundledArtifact.manifestSha256
              && selectedAssets[file.url as keyof typeof selectedAssets] !== file.sha256),
        )) throw mismatch();
      const { format: _format, files: _files, ...expected } = verified.manifest;
      void _format;
      void _files;
      const childMessage = (index: number, raw: unknown) => {
        if (stopped) return;
        const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
        if (startup.phase !== 'pool' || data?.type !== 'compute-loaded'
          || data.index !== index
          || startup.loaded.has(index)) {
          stop(failure('WORKER_CRASHED', 'runtime', 'reopen', 'Wallet compute worker failed.'));
          return;
        }
        startup.loaded.add(index);
        if (startup.loaded.size === workers) {
          try {
            worker!.postMessage({ type: 'pool-build' }, []);
          } catch {
            stop(unavailable());
          }
        }
      };
      const platform = await stageWalletWorkers(name => verified.copyFile(name), threaded, check);
      try {
        check();
      } catch (error) {
        platform.dispose();
        throw error;
      }
      removeAssets = platform.dispose;
      const { urls, channels } = platform;
      const crash = () => stop(failure('WORKER_CRASHED', 'runtime', 'reopen', 'Wallet worker failed.'));
      const messageError = node ? crash : () => stop(mismatch());
      startup.phase = 'executing';
      worker = platform.spawn('worker.mjs', {
        message,
        error: node ? crash : () => stop(unavailable()),
        messageerror: messageError,
      });
      spawnChild = (index, pool) => {
        const child = platform.spawn('thread-bootstrap.mjs', {
          message: data => childMessage(index, data),
          error: () => stop(failure('WORKER_CRASHED', 'runtime', 'reopen', 'Wallet compute worker failed.')),
          messageerror: messageError,
        });
        children.push(child);
        child.postMessage({
          type: 'compute-initialize', moduleUrl: urls['wallet.mjs'], module: pool.module, memory: pool.memory, index,
        }, []);
      };
      const wasm = verified.copyFile('bindings_bg.wasm');
      const ready = await request({
        type: 'initialize',
        moduleUrl: urls['wallet.mjs'],
        wasm,
        expected,
        maxMemoryBytes: runtime.maxMemoryBytes,
        ...(threaded ? { workers } : {}),
      }, [wasm.buffer]);
      check();
      const rawIdentity = ready.identity;
      if (!rawIdentity || typeof rawIdentity !== 'object') throw mismatch();
      const identity = rawIdentity as Record<string, unknown>;
      if (ready?.type !== 'ready' || !identity || !sameRecord(expected, {
        contractRevision: identity.contractRevision,
        abiVersion: identity.abiVersion,
        schemas: identity.schemas,
        buildSha256: identity.buildSha256,
        dependencyGraphSha256: identity.dependencyGraphSha256,
        mode: identity.mode,
      })
      || !sameRecord(
        identity.memory,
        { initialPages: threaded ? 322 : 321, maximumPages: 4096, shared: threaded },
      )) throw mismatch();
      const validatedIdentity: WalletRuntimeIdentity = {
        ...expected,
        memory: { initialPages: threaded ? 322 : 321, maximumPages: 4096, shared: threaded },
      };
      startup.phase = 'ready';
      const authorityChannel = channels();
      let authority: ReturnType<typeof attachWalletWorker>;
      try {
        const reply = await request({ type: 'signers', port: authorityChannel.port2 }, [authorityChannel.port2]);
        if (reply?.type !== 'signers-ready') throw mismatch();
        authority = attachWalletWorker(
          authorityChannel.port1,
          async () => { },
          {
            maxQueuedJobs: runtime.maxQueuedJobs,
            maxQueuedBytes: runtime.maxQueuedBytes,
            maxPcztBytes: runtime.maxPcztBytes,
          },
          budget,
        );
        sessions.add(authority);
      } catch (error) {
        authorityChannel.port1.close();
        authorityChannel.port2.close();
        throw error;
      }
      startup.phase = 'admitted';
      return {
        token: Object.freeze({}),
        identity: Object.freeze(validatedIdentity),
        check,
        destroy,
        signers: authority.signers,
        invalidate: () => {
          stop(failure('WORKER_CRASHED', 'runtime', 'reopen', 'Native authority cleanup failed.'));
          return destroy();
        },
        async open(
          storage: WalletStorage,
          parametersFormat: string,
          parameters: Uint8Array,
          genesis: Uint8Array,
          release: () => Promise<void>,
        ): Promise<OpenedWallet> {
          check();
          const channel = channels();
          try {
            const opened = await request({
              type: 'open',
              storage,
              ...(storage.kind === 'memory' ? {} : { hostUrl: urls[node ? 'node-fs.mjs' : 'opfs.mjs'] }),
              parametersFormat,
              parameters,
              genesis,
              port: channel.port2,
            }, [channel.port2]);
            check();
            if (opened?.type !== 'opened') {
              stop(mismatch());
              throw mismatch();
            }
            const session = attachWalletWorker(
              channel.port1,
              async () => {
                sessions.delete(session);
                await release();
              },
              {
                maxQueuedJobs: runtime.maxQueuedJobs,
                maxQueuedBytes: runtime.maxQueuedBytes,
                maxPcztBytes: runtime.maxPcztBytes,
              },
              budget,
            );
            sessions.add(session);
            return { session, close: () => session.close() };
          } catch (error) {
            channel.port1.close();
            channel.port2.close();
            await release();
            throw error;
          }
        },
      };
    } finally {
      verified.dispose();
    }
  } catch (error) {
    const finalError = isZcashError(error) ? error : unavailable();
    stop(finalError);
    await destroy(); // Failed teardown must never admit a fresh fallback domain.
    if (threaded && ['executing', 'pool'].includes(startup.phase)
      && !signal.aborted
      && ['TIMEOUT', 'WORKER_CRASHED', 'RUNTIME_UNAVAILABLE'].includes(finalError.code)) {
      bootstrapFailures.add(finalError);
    }
    throw finalError;
  } finally {
    clearTimeout(timer);
    // Lifetime cancellation remains connected after startup, until the last lease.
    if (stopped) signal.removeEventListener('abort', onAbort);
  }
}
