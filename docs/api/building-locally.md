# Build from source

Applications can install the [prebuilt npm package](installation.md) without Rust
or post-install downloads.

## Prerequisites

- macOS (Apple Silicon/Intel) or Linux x86_64. On Windows, use WSL2 x86_64 and
  keep the checkout in its Linux filesystem.
- Node 22.23.4 (pinned in `.nvmrc`), npm, Git, curl and [rustup](https://rustup.rs/).
- C compiler and binutils: `xcode-select --install` on macOS; `build-essential`
  and `ca-certificates` on Debian/Ubuntu/WSL.

The native build installs its pinned Rust/WASM toolchain, WASI SDK and wasm-bindgen.

## Build and test

```sh
git clone https://github.com/zcashlabs/zcashjs.git
cd zcashjs
npm ci
npm run build
```

The first build downloads inputs, takes several minutes and needs several GB of
disk space. Later builds verify and reuse native/proving caches. SDK output is
regenerated in ignored `dist/`; tracked files stay unchanged.

Run `npm run check` for lint, build and Node tests. See
[tests/README.md](https://github.com/zcashlabs/zcashjs/blob/main/tests/README.md)
for browser and optional integration tests.

## Source inputs

This repo builds the TypeScript SDK, worker and npm package. The Rust crates
(`zakura-bindings-core` with its WebAssembly and native front-ends) and native codecs
live in [zakura-bindings](https://github.com/jp4g/zakura-bindings), built via
`cargo xtask build` (WebAssembly) and `cargo xtask build-mobile` (React Native).
[native-source.json](https://github.com/zcashlabs/zcashjs/blob/main/scripts/native-source.json)
selects either a release tag (`release`) or an exact 40-character Git commit
(`revision`), never both. Branch names and abbreviated commits are rejected.
The SDK pins an exact commit of `jp4g/zakura-bindings` (formerly
`zakura-wasm-bindings`; releases up to v0.1.4 were published under that name).
Build receipts retain the resolved commit; the toolchain,
lockfiles and tool hashes pin the build inputs.

Sapling parameters come from `https://download.z.cash/downloads/`, checked against
the sizes and hashes in [proving-assets.ts](https://github.com/zcashlabs/zcashjs/blob/main/src/wallet/proving-assets.ts).
Generated production assets stay out of Git; pinned test fixtures remain tracked.

## Cache recovery

Run one build at a time per checkout. Remove the relevant cache and retry:

| Problem | Remove |
| --- | --- |
| Rebuild native output | `.cache/native/<revision>/sdk/` |
| Interrupted source fetch | `.cache/native/<release-or-revision>/source/` |
| Checksum mismatch | The cached file named in the error |
| Reset all SDK build caches | `.cache/native/`, `.cache/proving/`, `dist/` |

Failed builds remove `dist/`. Rustup and Cargo also retain their own toolchain caches.

## Local package

```sh
mkdir -p /tmp/zcash-package
npm pack --pack-destination /tmp/zcash-package
```

`npm pack` builds and includes the JavaScript, declarations, WASM, workers, proving
assets and licenses. Install the resulting tarball from your application:

```sh
npm install /tmp/zcash-package/zcashlabs-zcash.js-0.1.4.tgz
```

Use the filename printed by `npm pack` for the current version.

## React Native

`npm run build` also writes `dist/react-native/`, the WebAssembly-free bundle Metro
loads. The native libraries come from the pinned bindings source:

```sh
cd .cache/native/<pinned revision>/source
cargo xtask build-mobile --targets android --output /tmp/native   # needs ANDROID_NDK_HOME
cargo xtask build-mobile --targets ios --output /tmp/native-ios   # macOS with Xcode
cd -
node scripts/build-react-native-package.js /tmp/native            # fills packages/react-native
```

`npm run test:react-native` builds the host library (`--targets host`). It runs
`dist/react-native` in a Node process that lacks WebAssembly, workers and WebCrypto,
against the actual native library, and checks that encrypted wallets move between
Node and the native library. Device runs use the
[example app](https://github.com/zcashlabs/zcashjs/tree/main/examples/react-native).

## Documentation

```sh
npm run docs:typecheck
npm run docs:build
npm run docs:dev
```

Preview at `http://127.0.0.1:4173/`. The guide is published at [zcashlabs.github.io/zcashjs](https://zcashlabs.github.io/zcashjs/). See [Maintain and publish](gitbook.md) for GitHub Pages deployment and production preview instructions.
