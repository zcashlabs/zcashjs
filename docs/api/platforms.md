# Node, browser and React Native setup

| Capability | Node | Browser | React Native |
| --- | --- | --- | --- |
| Package imports | Node 22.23.4 | ESM bundler with modern WebAssembly support | Metro, React Native 0.77+ (New Architecture), Hermes |
| Zakura core | WebAssembly | WebAssembly | Native library (`@zcashlabs/zcash.js-native`) |
| Public queries | HTTP JSON-RPC | HTTP JSON-RPC with CORS | HTTP JSON-RPC |
| Light queries | Native gRPC | gRPC-Web endpoint with CORS | gRPC-Web; streams need a streaming `fetch` |
| Durable wallet storage | `node-filesystem` on Linux with `/usr/bin/flock` | `browser-opfs` in a secure context | `native-filesystem` in app storage |
| At-rest encryption | Yes | No | Yes (same format as Node) |
| Disposable wallet | `memory` | `memory` | `memory` |
| Wallet execution | Worker threads | Dedicated workers | Native threads (one owner thread per runtime) |
| Proving parameters | Bundled | Bundled assets | App directory, verified natively |

Lossless numeric RPC parsing uses `JSON.parse` reviver `context.source` when the engine provides it and an equivalent strict parser otherwise; cancellation uses `AbortSignal.any` or an equivalent fallback. A browser with WebAssembly alone is not sufficient for wallets.

Omit `runtime` to use the bundled baseline engine. Prefer-threaded mode requires a separately pinned threaded runtime. Threaded browser execution additionally needs cross-origin isolation and `SharedArrayBuffer`; check your COOP/COEP, CORS, worker, and content-security policies together. Baseline remains the explicit fallback where permitted by configuration.

The baseline runtime and proving assets ship inside the package. Node reads them locally; browser bundlers must emit and serve them with the application. Runtime assets remain hash-checked before execution. Custom remote runtime overrides use the loader's accepted authenticated URLs. The loader runs verified bytes and manages worker staging; applications should not import an arbitrary downloaded wallet script themselves. The [runtime profile](https://github.com/zcashlabs/zcashjs/blob/main/src/runtime/wallet-profile.ts) is the source of accepted runtime identities and compatibility values.

The clean consumer check uses a Vite application build with `assetsInlineLimit: 0`
and a non-root deployment base. Deploy its entire generated asset directory.
Library-mode builds that inline assets are not equivalent and are not qualified.
The single import does not mean a single JavaScript file: WASM, workers, and proving
parameters remain separate lazy assets within the same installed npm package.

Do not open the same wallet storage concurrently from multiple processes or tabs. Always close wallets on an orderly shutdown. OPFS data is origin-scoped and can be removed with browser site data; memory storage disappears at shutdown.

A [runnable Vite browser starter](https://github.com/zcashlabs/zcashjs/tree/main/examples/browser)
includes the asset configuration and an offline OPFS wallet check.

## React Native

Install both packages; the app imports only `@zcashlabs/zcash.js`:

```sh
npm install @zcashlabs/zcash.js @zcashlabs/zcash.js-native
```

`@zcashlabs/zcash.js-native` holds the prebuilt Zakura core (an iOS XCFramework and
Android libraries for `arm64-v8a` and `x86_64`) and a C++ TurboModule, so it needs the
New Architecture (the default from React Native 0.76) and iOS 15.1+ / Android API 24+.
Both packages must have the same version. With Expo, add `@zcashlabs/zcash.js-native` to
`plugins` and use a development build; Expo Go cannot load native modules. The plugin also
limits the Android build to the 64-bit ABIs. Bare React Native apps set
`reactNativeArchitectures=arm64-v8a,x86_64` in `android/gradle.properties`. 32-bit Android
devices are not supported.

Metro selects the React Native build through the package's `react-native` field and
export condition. It contains no WebAssembly. The same JavaScript glue that drives the
WebAssembly build calls the native library, which runs the same Rust core. Results,
errors and storage behavior match the other platforms, and a native/WebAssembly parity
suite checks this. Scanning and proving run on native threads off the JavaScript thread.

Storage is a directory in app storage, given as an absolute path (for example under
the documents directory): `{ kind: 'native-filesystem', path, encryptionKey? }`. It holds
`wallet.db`, its rollback journal and `owner.lock`, like Node. With a 32-byte key the
files use the [Node encryption format](wallet-runtime.md#encrypt-storage-at-rest), so
an encrypted wallet can move between Node and a device. Keep the key in the Keychain
or Keystore. The app decides whether the directory is included in backups.

Proving parameters are not in the JavaScript bundle. Place `sapling-spend.params` and
`sapling-output.params` in an app directory, or let `downloadProvingParameters` fetch
them into one. Then pass `proving: nativeProving({ directory })`. The native library
checks each file's length and SHA-256 when a proof needs it, and the parameters never
pass through JavaScript.

React Native's default `fetch` cannot stream. Queries work with it, but light-client
block streams need a streaming implementation such as `expo/fetch`, passed as
`transportOptions.fetch`. Without one, streaming calls fail with `RUNTIME_UNAVAILABLE`.

A [runnable Expo example](https://github.com/zcashlabs/zcashjs/tree/main/examples/react-native)
runs offline checks on a device: viewing keys, memory and encrypted wallets, and reopening.

## Current limits

The package is an experimental prerelease. Endpoint factories default to mainnet, but require an explicit provider endpoint (see [wallet defaults](wallet-runtime.md#defaults)). It has no managed artifact hosting, persistent secret vault, database backup API, remote proving integration, or concrete hardware signer integration. Node filesystem storage can be [encrypted at rest](wallet-runtime.md#encrypt-storage-at-rest) with an application-supplied key; OPFS and memory storage are not encrypted.

The current persistent Node adapter is Linux-specific and uses the operating
system's `flock` utility for crash-safe ownership. macOS and Windows persistent
wallet storage are not qualified. Bundling the WASM does not change that existing
platform limit; the memory wallet has no filesystem-lock dependency.

Fresh wallet databases, reopening, and the [closed-wallet Linux backup/restore
procedure](operations.md#closed-wallet-backup-on-linux) have same-candidate tests. Historical database migration is not yet qualified; same-version reopen
tests are not evidence of upgrade compatibility for an older wallet database.

The complete live-browser send/receive round trip is not yet qualified.

On React Native, the device checks cover viewing, storage, encryption and reopening. A
live testnet sync and send on a device is not yet qualified. The legacy (bridge)
architecture and Expo Go are not supported.

The GitHub Pages workflow checks documentation only. Run `npm run check` locally for linting and the Node test suite. Actual Firefox SDK and wallet-host checks are separate runnable checks; a passing bundle build is not a browser execution test. The [test guide](https://github.com/zcashlabs/zcashjs/blob/main/tests/README.md) describes which checks execute real native fixtures and which need external runtime/proving packages.
