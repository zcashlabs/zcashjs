# React Native example

An Expo development build that runs `@zcashlabs/zcash.js` on React Native with the
native Zakura core (no WebAssembly): viewing keys and addresses, a memory wallet, and
an encrypted durable wallet that is reopened, using synthetic regtest data.

```sh
# From the repository root: build the SDK and the native package for your platform.
npm ci && npm run build
(cd .cache/native/<pinned revision>/source && cargo xtask build-mobile --targets android --output /tmp/native)
node scripts/build-react-native-package.js /tmp/native

cd examples/react-native
npm run setup       # installs dependencies and generates ios/ and android/ (expo prebuild)
npm run android     # or: npm run ios (macOS)
```

The screen ends with "All checks passed". CI runs the same flow on an Android emulator
and an iOS simulator with Maestro (`e2e/offline.yaml`). Expo Go cannot load the native
module; use a development build.
