// Expo config plugin. Expo Go cannot load native modules: use a development build
// (`npx expo prebuild` / `eas build`). The module needs the New Architecture and
// iOS 15.1+; this plugin checks both, and limits Android to the 64-bit ABIs the
// native library ships (arm64-v8a, x86_64).
// Resolved from the app (Expo runs prebuild in the project root), so a linked or
// hoisted copy of this package uses the app's own Expo.
const { withGradleProperties } = require(require.resolve('expo/config-plugins', { paths: [process.cwd(), __dirname] }));

const ANDROID_ABIS = 'arm64-v8a,x86_64';

module.exports = function withZakuraNative(config) {
  if (config.newArchEnabled === false) {
    throw new Error('@zcashlabs/zcash.js-native requires the React Native New Architecture (newArchEnabled).');
  }
  const ios = config.ios ?? {};
  const target = ios.deploymentTarget ?? '15.1';
  if (Number.parseFloat(target) < 15.1) {
    throw new Error('@zcashlabs/zcash.js-native requires iOS 15.1 or newer.');
  }
  return withGradleProperties(config, config => {
    const properties = config.modResults;
    const existing = properties.find(item => item.type === 'property' && item.key === 'reactNativeArchitectures');
    if (existing) {
      // The template default lists all four ABIs: keep only the supported ones.
      const kept = existing.value.split(',').map(abi => abi.trim()).filter(abi => ANDROID_ABIS.split(',').includes(abi));
      if (!kept.length) {
        throw new Error(`@zcashlabs/zcash.js-native ships only ${ANDROID_ABIS}; reactNativeArchitectures lists none of them.`);
      }
      existing.value = kept.join(',');
    } else {
      properties.push({ type: 'property', key: 'reactNativeArchitectures', value: ANDROID_ABIS });
    }
    return config;
  });
};
