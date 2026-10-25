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

This repo builds the TypeScript SDK, worker and npm package. The Rust crate
`zakura-network-bindings` and native codecs live in
[zakura-wasm-bindings](https://github.com/jp4g/zakura-wasm-bindings), built via
`cargo xtask build`. [native-source.json](https://github.com/zcashlabs/zcashjs/blob/main/scripts/native-source.json)
selects its release tag. Build receipts retain the resolved commit; the toolchain,
lockfiles and tool hashes pin the build inputs.

Sapling parameters come from `https://download.z.cash/downloads/`, checked against
the sizes and hashes in [proving-assets.ts](https://github.com/zcashlabs/zcashjs/blob/main/src/wallet/proving-assets.ts).
Generated production assets stay out of Git; pinned test fixtures remain tracked.

## Cache recovery

Run one build at a time per checkout. Remove the relevant cache and retry:

| Problem | Remove |
| --- | --- |
| Rebuild native output | `.cache/native/<revision>/sdk/` |
| Interrupted source fetch | `.cache/native/<release>/` |
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
npm install /tmp/zcash-package/zcashlabs-zcash.js-0.1.0-rc.5.tgz
```

Use the filename printed by `npm pack` for the current version.

## Documentation

```sh
npm run docs:typecheck
npm run docs:build
npm run docs:dev
```

Preview at `http://127.0.0.1:4173/`. The guide is published at [zcashlabs.github.io/zcashjs](https://zcashlabs.github.io/zcashjs/). See [Maintain and publish](gitbook.md) for GitHub Pages deployment and production preview instructions.
