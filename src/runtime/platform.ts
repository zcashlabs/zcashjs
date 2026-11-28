// Platform selection. React Native has no WebAssembly or workers: the Zakura core is
// a native library reached through a transport installed by @zcashlabs/zcash.js-native.
import { failure } from '../errors.js';

export type PlatformName = 'node' | 'browser' | 'react-native';

/** The JSI object the React Native module installs as `globalThis.__zakuraNative`. */
export interface NativeTransport {
  /** Synchronous call; runtime 0 runs stateless functions. Returns an encoded result. */
  call(runtime: number, name: string, args: Uint8Array): Uint8Array;
  /** Owner-thread call resolving with an encoded result. */
  start(runtime: number, name: string, args: Uint8Array): Promise<Uint8Array>;
  createRuntime(): number;
  destroyRuntime(runtime: number): void;
}

const host = globalThis as {
  navigator?: { product?: string };
  process?: { versions?: { node?: string } };
  __zakuraNative?: NativeTransport;
};

export const platformName: PlatformName = host.navigator?.product === 'ReactNative'
  ? 'react-native'
  : typeof host.process?.versions?.node === 'string' ? 'node' : 'browser';
export const reactNative = platformName === 'react-native';

export function nativeTransport(): NativeTransport {
  const transport = host.__zakuraNative;
  if (!transport || typeof transport.call !== 'function' || typeof transport.start !== 'function'
    || typeof transport.createRuntime !== 'function' || typeof transport.destroyRuntime !== 'function') {
    throw failure('RUNTIME_UNAVAILABLE', 'runtime', 'configure',
      'The Zakura native module is not installed. Add @zcashlabs/zcash.js-native to the React Native app.');
  }
  return transport;
}
