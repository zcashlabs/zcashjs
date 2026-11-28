import type { AssetRequirement, LocalProvingOptions } from '../types.js';
import { snapshot, ownBytes } from '../clients/owned-plumbing.js';
import { errorMessage, failure, invalidArgument, isZcashError } from '../errors.js';
import { operation } from '../clients/light-chain-reads.js';
import { anySignal } from '../abort.js';
import { sha256Hex } from '../hash.js';
const fail = (code: 'ASSET_UNAVAILABLE' | 'ASSET_INTEGRITY' | 'RESOURCE_LIMIT') => failure(
  code,
  'proving',
  'configure',
  errorMessage(code),
);
// Canonical parameters: SHA256 pins cross-checked against zakura-proofs' BLAKE2b512 pins.
export const saplingAssets = Object.freeze([
  Object.freeze({
    pool: 'sapling',
    circuitVersion: 'sapling/1',
    assetId: 'sapling-spend.params',
    format: 'bellman-groth16/1',
    byteLength: 47958396,
    sha256: '8e48ffd23abb3a5fd9c5589204f32d9c31285a04b78096ba40a79b75677efc13',
    blake2b512: '8270785a1a0d0bc77196f000ee6d221c9c9894f55307bd9357c3f0105d31ca63991ab91324160d8f53e2bbd3c2633a6eb8bdf5205d822e7f3f73edac51b2b70c',
  }),
  Object.freeze({
    pool: 'sapling',
    circuitVersion: 'sapling/1',
    assetId: 'sapling-output.params',
    format: 'bellman-groth16/1',
    byteLength: 3592860,
    sha256: '2f0ebbcbb9bb0bcffe95a397e7eba89c29eb4dde6191c339db88570e3f3fb0e4',
    blake2b512: '657e3d38dbb5cb5e7dd2970e8b03d69b4787dd907285b5a7f0790dcc8072f60bf593b32cc2d1c030e00ff5ae64bf84c5c3beb84ddc841d48264b4a171744d028',
  }),
] as const);
const total = saplingAssets.reduce((sum, asset) => sum + asset.byteLength, 0);
async function hash(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}
type Builtins = {
  'fs/promises': typeof import('node:fs/promises');
  'os': typeof import('node:os');
  'path': typeof import('node:path');
};
const builtin = <K extends keyof Builtins>(name: K) =>
  (globalThis as {
    process?: { getBuiltinModule?<T extends keyof Builtins>(name: T): Builtins[T] };
  }).process?.getBuiltinModule?.(name);

export function provingOptions(options: LocalProvingOptions): LocalProvingOptions {
  const input = snapshot(options, ['kind', 'assets', 'loadAsset', 'cache', 'maxConcurrentProofs']);
  if (input.kind !== 'local' || input.maxConcurrentProofs !== 1
    || typeof input.loadAsset !== 'function'
    || !Array.isArray(input.assets)) throw invalidArgument();
  const length = Object.getOwnPropertyDescriptor(input.assets, 'length')?.value;
  if (!Number.isInteger(length) || length < 0 || length > 2) throw invalidArgument();
  const requirements = Object.freeze(Array.from({ length }, (_, i) => {
    const field = Object.getOwnPropertyDescriptor(input.assets, String(i));
    if (!field || !('value' in field)) throw invalidArgument();
    const value = snapshot(
      field.value as AssetRequirement,
      ['pool', 'circuitVersion', 'assetId', 'format', 'digest', 'byteLength'],
    );
    const digest = snapshot(value.digest, ['algorithm', 'hex']);
    const expected = saplingAssets.find(asset => asset.assetId === value.assetId);
    if (!expected || value.pool !== expected.pool
      || value.circuitVersion !== expected.circuitVersion
      || value.format !== expected.format
      || value.byteLength !== expected.byteLength

      || !['sha256', 'blake2b512'].includes(digest.algorithm)
      || digest.hex !== expected[digest.algorithm]) throw fail('ASSET_INTEGRITY');
    return Object.freeze({ ...value, digest: Object.freeze(digest) });
  }));
  if (new Set(requirements.map(value => value.assetId)).size !== length) throw invalidArgument();
  const cache = snapshot(input.cache, ['kind', 'namespace', 'maxBytes']);
  if (!Number.isSafeInteger(cache.maxBytes) || cache.maxBytes < 1
    || !['memory', 'persistent'].includes(cache.kind)) throw invalidArgument();
  if (cache.kind === 'persistent') {
    if (typeof cache.namespace !== 'string' || !cache.namespace.length
      || cache.namespace.length > 256) throw invalidArgument();
  } else if (Object.hasOwn(cache, 'namespace')) throw invalidArgument();
  const load = input.loadAsset;
  return Object.freeze<LocalProvingOptions>({
    ...input,
    assets: requirements,
    cache: Object.freeze(cache),
    loadAsset: args => Reflect.apply(load, options, [args]),
  });
}

/** React Native: parameter files read and verified by the native library, which
 * returns short tokens the native prover resolves, so ~50 MB never passes through JS. */
export type NativeProvingLoader = (path: string, sha256: string, byteLength: number) => Uint8Array;
let nativeLoader: NativeProvingLoader | undefined;
const nativeDirectories = new WeakMap<object, string>();
export function installNativeProving(loader: NativeProvingLoader): void {
  nativeLoader = loader;
}
/** Mark proving options as native file-backed parameters in `directory`. */
export function registerNativeProving(options: LocalProvingOptions, directory: string): LocalProvingOptions {
  nativeDirectories.set(options, directory);
  return options;
}

/** Fixed canonical asset inventory; caches never receive wallet data or witnesses. */
export class ProvingAssets {
  private readonly requirements: readonly AssetRequirement[];
  private readonly load: LocalProvingOptions['loadAsset'];
  private readonly cache: LocalProvingOptions['cache'];
  private readonly memory = new Map<string, Uint8Array>();
  private closed = false;
  private readonly abort = new AbortController();
  private running: Promise<{ spend: Uint8Array; output: Uint8Array }> | undefined;
  private readonly nativeDirectory: string | undefined;
  constructor(options: LocalProvingOptions, private readonly packageOwned = false) {
    this.nativeDirectory = typeof options === 'object' && options !== null ? nativeDirectories.get(options) : undefined;
    const input = provingOptions(options);
    this.requirements = input.assets;
    this.cache = input.cache;
    this.load = input.loadAsset;
  }

  // Cache plus callback, owned verification, digest and platform-write working copies.
  get cacheReservation() {
    return this.cache.kind === 'memory' ? total : 0;
  }

  get workingReservation() {
    return 5 * total;
  }

  async close() {
    this.closed = true;
    this.abort.abort();
    await this.running?.catch(() => { });
    this.memory.clear();
  }

  private check() {
    if (this.closed) throw failure('CLOSED', 'proving', 'none', 'Wallet is closed.');
  }

  sapling(signal?: AbortSignal): Promise<{ spend: Uint8Array; output: Uint8Array }> {
    const result = this.loadSapling(signal);
    this.running = result;
    return result.finally(() => {
      this.running = undefined;
    });
  }

  private async loadSapling(signal?: AbortSignal): Promise<{ spend: Uint8Array; output: Uint8Array }> {
    const caller = operation(signal),
      pending = operation(anySignal([caller.signal, this.abort.signal]));
    try {
      this.check();
      pending.check();
      if (this.requirements.length !== 2) throw fail('ASSET_UNAVAILABLE');
      if (this.nativeDirectory !== undefined) return this.loadNative(this.nativeDirectory);
      if (this.cache.maxBytes < total) throw fail('RESOURCE_LIMIT');
      const bytes: Uint8Array[] = [];
      for (const expected of saplingAssets) {
        const requirement = this.requirements.find(item => item.assetId === expected.assetId)!;
        let value = this.memory.get(expected.sha256);
        if (!value && this.cache.kind === 'persistent') value = await this.read(expected.sha256, expected.byteLength);
        if (value) {
          if (value.byteLength !== expected.byteLength
            || await hash(value) !== expected.sha256) throw fail('ASSET_INTEGRITY');
        } else {
          const delivered = await pending.wait(
            Promise.resolve().then(
              () => this.load({ requirement, signal: pending.signal }),
            ),
          );
          this.check();
          pending.check();
          // The wallet's default package loader returns a fresh exact-size buffer nobody else holds;
          // caller-supplied loaders are snapshotted because they may retain or mutate their bytes.
          value = this.packageOwned
            ? delivered
            : ownBytes(
                delivered,
                () => fail('ASSET_INTEGRITY'),
                () => fail('RESOURCE_LIMIT'),
                expected.byteLength,
              );
          if (value.byteLength !== expected.byteLength
            || await hash(value) !== expected.sha256) throw fail('ASSET_INTEGRITY');
          this.check();
          pending.check();
          if (this.cache.kind === 'memory') this.memory.set(expected.sha256, value);
          else await this.write(expected.sha256, value);
        }
        this.check();
        pending.check();
        bytes.push(value);
      }
      return { spend: bytes[0]!, output: bytes[1]! };
    } catch (error) {
      throw isZcashError(error) ? error : fail('ASSET_UNAVAILABLE');
    } finally {
      pending.close();
      caller.close();
    }
  }

  private loadNative(directory: string): { spend: Uint8Array; output: Uint8Array } {
    if (!nativeLoader) throw fail('ASSET_UNAVAILABLE');
    const tokens = saplingAssets.map((asset) => {
      try {
        return nativeLoader!(`${directory}/${asset.assetId}`, asset.sha256, asset.byteLength);
      } catch (error) {
        throw fail(error === 'ASSET_INTEGRITY' ? 'ASSET_INTEGRITY' : 'ASSET_UNAVAILABLE');
      }
    });
    return { spend: tokens[0]!, output: tokens[1]! };
  }

  private async location() {
    const namespace = this.cache.kind === 'persistent' ? this.cache.namespace : '';
    return 'zakura-proving-' + await hash(new TextEncoder().encode(namespace));
  }

  private async read(key: string, maximum: number): Promise<Uint8Array | undefined> {
    this.check();
    const name = await this.location(),
      fs = builtin('fs/promises');
    if (fs) {
      const os = builtin('os')!,
        path = builtin('path')!;
      const filename = path.join(os.homedir(), '.cache', 'zakura', name, key);
      let file;
      try {
        file = await fs.open(filename, 'r');
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error
          && error.code === 'ENOENT') return;
        throw error;
      }
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== maximum) throw fail('ASSET_INTEGRITY');
        const bytes = new Uint8Array(maximum);
        let offset = 0;
        while (offset < maximum) {
          const { bytesRead } = await file.read(bytes, offset, maximum - offset, offset);
          if (!bytesRead) throw fail('ASSET_INTEGRITY');
          offset += bytesRead;
        }
        return bytes;
      } finally {
        await file.close();
      }
    }
    const cache = await caches.open(name),
      response = await cache.match(new URL('/' + key, location.origin).href);
    if (!response) return;
    const reader = response.body?.getReader();
    if (!reader) throw fail('ASSET_INTEGRITY');
    const bytes = new Uint8Array(maximum);
    let offset = 0;
    try {
      for (; ;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (offset + value.byteLength > maximum) throw fail('ASSET_INTEGRITY');
        bytes.set(value, offset);
        offset += value.byteLength;
      }
      if (offset !== maximum) throw fail('ASSET_INTEGRITY');
      return bytes;
    } finally {
      await reader.cancel().catch(() => { });
      reader.releaseLock();
    }
  }

  private async write(key: string, bytes: Uint8Array) {
    this.check();
    const name = await this.location(),
      fs = builtin('fs/promises');
    if (fs) {
      const path = builtin('path')!,
        os = builtin('os')!,
        directory = path.join(os.homedir(), '.cache', 'zakura', name);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(directory, key + '.' + crypto.randomUUID());
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        this.check();
        await fs.rename(temporary, path.join(directory, key));
      } finally {
        await fs.unlink(temporary).catch(() => { });
      }
    } else {
      const cache = await caches.open(name);
      this.check();
      await cache.put(
        new URL('/' + key, location.origin).href,
        new Response(bytes as Uint8Array<ArrayBuffer>),
      );
    }
  }
}
