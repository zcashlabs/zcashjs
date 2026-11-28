import { failure } from './errors.js';

/** One-shot SHA-256 used by the SDK. Platforms without WebCrypto install a provider. */
export type Sha256 = (bytes: Uint8Array) => Promise<Uint8Array>;
let provider: Sha256 | undefined;

/** Internal: the active platform installs its digest (e.g. the React Native module). */
export function installSha256(digest: Sha256 | undefined): void {
  provider = digest;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (provider) return provider(bytes);
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw failure('RUNTIME_UNAVAILABLE', 'runtime', 'configure', 'SHA-256 is unavailable on this platform.');
  return new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

export const hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await sha256(bytes));
}
