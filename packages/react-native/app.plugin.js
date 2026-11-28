// Expo config plugin. Expo Go cannot load native modules: use a development build
// (`npx expo prebuild` / `eas build`). The module needs the New Architecture and
// iOS 15.1+; this plugin checks both.
module.exports = function withZakuraNative(config) {
  if (config.newArchEnabled === false) {
    throw new Error('@zcashlabs/zcash.js-native requires the React Native New Architecture (newArchEnabled).');
  }
  const ios = config.ios ?? {};
  const target = ios.deploymentTarget ?? '15.1';
  if (Number.parseFloat(target) < 15.1) {
    throw new Error('@zcashlabs/zcash.js-native requires iOS 15.1 or newer.');
  }
  return config;
};
