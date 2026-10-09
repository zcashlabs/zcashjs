# Build from source

This page is for SDK development or testing an unpublished change. To use the
SDK in an application, follow [Installation](installation.md) and install from npm.

## Build and check

Use Node **22.12 or newer** and npm.

```sh
git clone https://github.com/zcashlabs/zcashjs.git
cd zcashjs
npm ci
npm run build
npm run check
```

The normal package build uses the committed runtime/proving assets and verifies
their integrity. It does not require rebuilding the native runtime with Rust.

## Native Rust source and rebuilds

The wallet engine comes from the separate
[`zakura-wasm-bindings` repository](https://github.com/jp4g/zakura-wasm-bindings),
whose Rust crate is named `zakura-network-bindings`. It supplies native wallet
and cryptographic functionality compiled to WebAssembly for this SDK.

The current wallet build pins revision
`9741e95a21e2314b3f817e3ed1427d17f919beb6` in
[`scripts/build-native-wallet.mjs`](https://github.com/zcashlabs/zcashjs/blob/main/scripts/build-native-wallet.mjs).
The native repository and pinned revision are public. The ordinary build above
still uses committed artifacts; rebuilding the native wallet requires preparing
the separate source checkout and toolchain.

The native crate currently has `publish = false`. Publishing it to crates.io is
not a prerequisite for building this SDK: the build can obtain a pinned Git
revision. A public source-build workflow does require that revision and all its
build inputs to be publicly obtainable.

Existing scripts cover native compilation, worker bundling and runtime
packaging, but currently require separately prepared source, pinned Rust/WASI/
wasm-bindgen tools and cached Cargo dependencies. They are not yet a single
fresh-checkout build workflow. [Issue #3](https://github.com/zcashlabs/zcashjs/issues/3)
tracks build-input availability, build orchestration, documentation and removing
generated artifacts from Git after their replacement build is verified.

npm consumers receive the compiled runtime in the package; they do not need
Rust or a checkout of the native source repository.

## Make a local package

From the SDK checkout:

```sh
mkdir -p /tmp/zcash-package
npm pack --pack-destination /tmp/zcash-package
```

`npm pack` builds and verifies the included assets before creating the tarball.
It prints the filename, which includes the checkout's package version.

From your application, install that file (this example uses rc.4):

```sh
npm install /tmp/zcash-package/jp4g-zcash.js-0.1.0-rc.4.tgz
```

The tarball includes executable code, TypeScript declarations, lazy runtime and
proving assets, integrity/build inventories, the README/changelog, and licenses.
Source tests, private wallets, and internal planning documents are excluded.
Installing it needs no separate runtime/proving download.

## Check and preview the documentation

```sh
npm run docs:typecheck
npm run docs:build
npm run docs:dev
```

The last command serves the guide at `http://127.0.0.1:4173/`.
See [Maintain and publish](gitbook.md) for GitBook sync and site deployment.
