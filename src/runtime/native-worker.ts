// React Native wallet owner: the WASM worker's control protocol (initialize, signers,
// open) served in-process over a LocalChannel. Each owner is one native runtime (a
// Rust owner thread with its own wallet domain), mirroring one WASM worker.
import type { InitializedViews } from '../wallet/session.js';
import { installWalletWorker } from '../wallet/worker.js';
import { errorTag } from '../errors.js';
import { LocalPort } from './local-channel.js';
import type { NativeTransport } from './platform.js';
import {
  consensusContext, createRuntimeBindings, createStatelessBindings, expectedNativeRevision,
  initializeNativeWalletRuntime, viewsForStorage,
} from './native-glue.mjs';
import type { NativeWalletRuntime } from './native-glue.mjs';
import { walletProfile } from './wallet-profile.js';

const knownFailures = new Set(['STORAGE_KEY_MISMATCH', 'STORAGE_BUSY', 'STORAGE_QUOTA', 'STORAGE_ERROR',
  'INVALID_ARGUMENT', 'PROTOCOL_MISMATCH', 'RESOURCE_LIMIT', 'NETWORK_MISMATCH', 'SCHEMA_MISMATCH',
  'VIEWING_SCHEMA_REQUIRED', 'MIGRATION_REQUIRED']);

/** Runtime identity reported to the host; native code is identified, not hash-checked. */
export function nativeRuntimeIdentity(transport: NativeTransport) {
  const native = createStatelessBindings(transport).identity();
  return {
    ...walletProfile,
    mode: 'native' as const,
    buildSha256: native.revision,
    dependencyGraphSha256: native.dependencyGraphSha256,
    native,
  };
}

/** Start a native owner behind `control`; returns its teardown. */
export function startNativeWorker(control: LocalPort, transport: NativeTransport): () => void {
  let phase: 'new' | 'ready' | 'failed' = 'new';
  let runtimeId = 0;
  let runtime: NativeWalletRuntime | undefined;
  let signerPort = false;
  const post = (value: Record<string, unknown>) => control.postMessage(value);
  const fail = (id: unknown, code: string, fatal: boolean) => {
    if (fatal) phase = 'failed';
    post({ type: 'failure', code, id, fatal });
  };
  const isPort = (value: unknown): value is MessagePort => value instanceof LocalPort;

  function initialize(data: Record<string, unknown>) {
    if (phase !== 'new') return fail(data.id, 'PROTOCOL_MISMATCH', true);
    const identity = nativeRuntimeIdentity(transport);
    // The JS glue and the native library must come from the same bindings revision.
    if (!identity.native.wallet || identity.native.abiVersion !== 1
      || (expectedNativeRevision !== 'unversioned' && identity.native.revision !== expectedNativeRevision)) {
      return fail(data.id, 'PROTOCOL_MISMATCH', true);
    }
    runtimeId = transport.createRuntime();
    if (!runtimeId) return fail(data.id, 'RUNTIME_UNAVAILABLE', true);
    runtime = initializeNativeWalletRuntime(createRuntimeBindings(transport, runtimeId));
    phase = 'ready';
    post({ type: 'ready', identity, id: data.id });
  }

  function open(data: Record<string, unknown>) {
    let owner: InitializedViews | undefined;
    let fallback = 'RUNTIME_UNAVAILABLE';
    const storage = data.storage as Record<string, unknown> | undefined;
    const key = storage?.encryptionKey;
    try {
      if (phase !== 'ready' || !runtime || !isPort(data.port)) throw Error('PROTOCOL_MISMATCH');
      const { parametersFormat, parameters, genesis } = data;
      if (typeof parametersFormat !== 'string' || !(parameters instanceof Uint8Array)
        || !(genesis instanceof Uint8Array) || genesis.length !== 32) throw Error('INVALID_ARGUMENT');
      // Native document validation precedes storage acquisition.
      consensusContext(parametersFormat, parameters, 0);
      fallback = 'STORAGE_ERROR';
      let opened;
      if (storage?.kind === 'memory') opened = runtime.openMemory(parametersFormat, parameters, genesis);
      else if (storage?.kind === 'native-filesystem' && typeof storage.path === 'string') {
        if (key !== undefined && !(key instanceof Uint8Array && key.length === 32)) throw Error('INVALID_ARGUMENT');
        opened = runtime.openPath(storage.path, parametersFormat, parameters, genesis, key as Uint8Array | undefined);
      } else throw Error('INVALID_ARGUMENT');
      owner = viewsForStorage(opened);
      installWalletWorker(owner, data.port as MessagePort, () => runtime!.invalid);
      post({ type: 'opened', id: data.id });
    } catch (error) {
      const tag = errorTag(error);
      const known = typeof tag === 'string' && knownFailures.has(tag);
      try {
        if (owner) owner.close(owner.generation, owner.instance);
      } catch { /* Report the original failure. */ }
      fail(data.id, known ? tag : fallback, runtime?.invalid === true || (!known && fallback !== 'STORAGE_ERROR'));
    } finally {
      if (key instanceof Uint8Array) key.fill(0);
    }
  }

  let queue = Promise.resolve();
  control.onmessage = ({ data: raw }) => {
    queue = queue.then(() => {
      const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      try {
        switch (data.type) {
          case 'initialize': return initialize(data);
          case 'signers':
            if (phase !== 'ready' || signerPort || !isPort(data.port) || !runtime) {
              return fail(data.id, 'PROTOCOL_MISMATCH', true);
            }
            installWalletWorker(undefined, data.port, () => runtime!.invalid, runtime.signers);
            signerPort = true;
            return post({ type: 'signers-ready', id: data.id });
          case 'open': return open(data);
          default: return fail(data.id, 'PROTOCOL_MISMATCH', true);
        }
      } catch {
        fail(data.id, 'RUNTIME_UNAVAILABLE', true);
      }
    });
  };
  return () => {
    control.close();
    if (runtimeId) transport.destroyRuntime(runtimeId);
    runtimeId = 0;
  };
}
