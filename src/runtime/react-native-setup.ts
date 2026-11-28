// React Native platform services: SHA-256 and proving parameters through the native
// module. Global fallbacks are installed earlier by react-native-globals.ts.
import { installSha256 } from '../hash.js';
import { installNativeProving } from '../wallet/proving-assets.js';
import { nativeTransport } from './platform.js';
import type { createStatelessBindings } from './native-glue.mjs';

// Loaded lazily: the glue is only needed once the native transport is used.
let native: ReturnType<typeof createStatelessBindings> | undefined;
let loading: Promise<ReturnType<typeof createStatelessBindings>> | undefined;
const bindings = () => loading ??= import('./native-glue.mjs')
  .then(glue => native = glue.createStatelessBindings(nativeTransport()));
installSha256(async bytes => (await bindings()).sha256(bytes));
void bindings().catch(() => { /* Reported when first used. */ });
installNativeProving((path, sha256, length) => {
  if (!native) throw 'ASSET_UNAVAILABLE';
  return native.proving_load(path, sha256, length);
});
