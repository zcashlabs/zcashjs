# Build with zcash.js

A practical TypeScript guide to chain queries, local wallets, receiving, sending, signing, and payment recovery.

Start with [installation and a first request](api/installation.md), then follow the [developer guide](api/README.md). For the complete wallet journey, read the [walkthrough](api/walkthrough.md). The [API reference](api/reference.md) maps the implemented exports to examples.

`@zcashlabs/zcash.js@0.1.0-rc.5` is an experimental release candidate with bundled codec capsules, a baseline wallet engine, workers, and local Sapling proving assets. Wallet execution loads the bundled engine automatically; proving assets load only when needed. Applications supply endpoints and storage. No separate runtime package, Rust installation, or post-install asset download is required.

Browser bundlers emit lazy WASM, worker, and proving files alongside the application; deploy those files too. Persistent Node wallets currently require Linux and `flock`. Historical wallet-database migration and the complete live-browser send/receive round trip are not yet qualified. See [wallet setup](api/wallet-runtime.md) and [platform limits](api/platforms.md).

This developer guide is published with VitePress on [GitHub Pages](https://zcashlabs.github.io/zcashjs/). See [Maintain and publish](api/gitbook.md) for documentation checks and deployment.
