// React Native proving parameters: files in an app directory, verified natively.
import type { LocalProvingOptions, Op } from '../types.js';
import { failure, invalidArgument } from '../errors.js';
import { registerNativeProving, saplingAssets } from '../wallet/proving-assets.js';
import { nativeTransport } from './platform.js';
import { createStatelessBindings } from './native-glue.mjs';

type Files = ReturnType<typeof createStatelessBindings> & {
  file_append(path: string, bytes: Uint8Array): void;
  file_size(path: string): number | undefined;
  file_remove(path: string): void;
  file_commit(from: string, to: string): void;
};
let files: Files | undefined;
const native = () => files ??= createStatelessBindings(nativeTransport()) as Files;

function directoryPath(directory: unknown): string {
  if (typeof directory !== 'string' || !directory.startsWith('/') || directory.length > 4096
    || directory.includes('\0')) throw invalidArgument();
  return directory.replace(/\/+$/, '');
}

/** Proving options for parameter files `sapling-spend.params` and `sapling-output.params`
 * in `directory` (an absolute app path). The native library checks each file's exact
 * length and SHA-256 when a proof needs it; the parameters never enter JavaScript. */
export function nativeProving(options: { directory: string }): LocalProvingOptions {
  const directory = directoryPath(options?.directory);
  return registerNativeProving(Object.freeze({
    kind: 'local' as const,
    assets: saplingAssets.map(({ sha256, blake2b512: _unused, ...asset }) => {
      void _unused;
      return { ...asset, digest: { algorithm: 'sha256' as const, hex: sha256 } };
    }),
    cache: { kind: 'memory' as const, maxBytes: saplingAssets.reduce((sum, asset) => sum + asset.byteLength, 0) },
    maxConcurrentProofs: 1 as const,
    loadAsset(): Promise<Uint8Array> {
      return Promise.reject(failure('ASSET_UNAVAILABLE', 'proving', 'configure',
        'Native proving parameters are read by the native library.'));
    },
  }), directory);
}

/** Download missing or invalid Sapling parameters into `directory`, verifying each
 * natively before an atomic rename. Pass a streaming `fetch` (e.g. expo/fetch) to
 * avoid buffering ~48 MB; the default fetch is read with arrayBuffer(). */
export async function downloadProvingParameters(
  options: { directory: string; fetch?: typeof fetch; baseUrl?: string } & Op,
): Promise<void> {
  const directory = directoryPath(options?.directory);
  const fetcher = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof fetcher !== 'function') throw invalidArgument();
  const base = options.baseUrl ?? 'https://download.z.cash/downloads/';
  if (!/^https:\/\/[^\s?#]+\/$/.test(base)) throw invalidArgument();
  const api = native();
  for (const asset of saplingAssets) {
    options.signal?.throwIfAborted();
    const target = `${directory}/${asset.assetId}`;
    const partial = `${target}.part`;
    if (api.file_size(target) === asset.byteLength && api.file_sha256(target) === asset.sha256) continue;
    api.file_remove(partial);
    const response = await fetcher(base + asset.assetId, {
      credentials: 'omit', redirect: 'follow', ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw failure('ASSET_UNAVAILABLE', 'proving', 'configure', 'Proving parameter download failed.');
    let written = 0;
    const write = (chunk: Uint8Array) => {
      written += chunk.length;
      if (written > asset.byteLength) {
        throw failure('ASSET_INTEGRITY', 'proving', 'configure', 'Proving parameter size mismatch.');
      }
      api.file_append(partial, chunk);
    };
    try {
      const body = response.body as ReadableStream<Uint8Array> | null | undefined;
      if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        try {
          for (;;) {
            options.signal?.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            write(value);
          }
        } finally {
          void reader.cancel().catch(() => { });
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        for (let at = 0; at < bytes.length; at += 1 << 20) write(bytes.subarray(at, at + (1 << 20)));
      }
      if (written !== asset.byteLength || api.file_sha256(partial) !== asset.sha256) {
        throw failure('ASSET_INTEGRITY', 'proving', 'configure', 'Proving parameter integrity check failed.');
      }
      api.file_commit(partial, target);
    } catch (error) {
      try {
        api.file_remove(partial);
      } catch { /* Report the download failure. */ }
      throw error;
    }
  }
}
