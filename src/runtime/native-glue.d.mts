// Generated for React Native builds from the zakura-bindings JS glue with the native
// binding shim in place of wasm-bindgen output (scripts/build-react-native.js).
import type { NativeTransport } from './platform.js';
import type { InitializedViews, InitializedSigners } from '../wallet/session.js';

export interface NativeOpenedStorage { readonly generation: number; readonly instance: string }
export interface NativeWalletRuntime {
  readonly invalid: boolean;
  readonly signers: InitializedSigners;
  openMemory(format: string, parameters: Uint8Array, genesis: Uint8Array): NativeOpenedStorage;
  openPath(directory: string, format: string, parameters: Uint8Array, genesis: Uint8Array,
    key?: Uint8Array): NativeOpenedStorage;
}
export interface NativeIdentity {
  readonly format: 'zakura-native/1';
  readonly abiVersion: number;
  readonly revision: string;
  readonly dependencyGraphSha256: string;
  readonly target: string;
  readonly wallet: boolean;
}
export function createRuntimeBindings(transport: NativeTransport, runtime: number): unknown;
export function createStatelessBindings(transport: NativeTransport): {
  sha256(bytes: Uint8Array): Uint8Array;
  random_bytes(length: number): Uint8Array;
  identity(): NativeIdentity;
  proving_load(path: string, sha256: string, length: number): Uint8Array;
  file_sha256(path: string): string;
};
export function initializeNativeWalletRuntime(bindings: unknown): NativeWalletRuntime;
export function viewsForStorage(storage: NativeOpenedStorage): InitializedViews;
export function consensusContext(format: string, parameters: Uint8Array, height: number): unknown;
/** Native revision this SDK build was produced against (scripts/native-source.json). */
export const expectedNativeRevision: string;
