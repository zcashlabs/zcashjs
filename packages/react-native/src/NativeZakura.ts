// TurboModule spec (codegen input). install() puts globalThis.__zakuraNative on the
// JS runtime; @zcashlabs/zcash.js uses it to reach the native Zakura core.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  install(): boolean;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeZakura');
