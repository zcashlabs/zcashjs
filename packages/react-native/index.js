// Importing this package installs the JSI transport @zcashlabs/zcash.js uses on
// React Native. The SDK imports it itself; apps only need it installed.
import './url';
import NativeZakura from './src/NativeZakura';

if (!globalThis.__zakuraNative && !NativeZakura.install()) {
  throw new Error('@zcashlabs/zcash.js-native: native module installation failed');
}
