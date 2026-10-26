# zcash.js

An experimental TypeScript SDK for Zcash chain queries and local wallets on Node and browsers.

**[Read the developer guide](https://zcashlabs.github.io/zcashjs/api/README.html)** · [First request](https://zcashlabs.github.io/zcashjs/api/installation.html) · [Wallet walkthrough](https://zcashlabs.github.io/zcashjs/api/walkthrough.html) · [API reference](https://zcashlabs.github.io/zcashjs/api/reference.html)

## What it provides

- Public JSON-RPC queries and transaction observation through `createPublicClient`.
- Lightwallet queries and streams through `createLightClient`.
- Local accounts, scanning, proposals, signing, submission, and recorded payment recovery through `createWalletClient`.
- Exact bigint amounts, validated network/identifier values, viewing/address tools, and PCZT utilities.

`@zcashlabs/zcash.js@0.1.1` is an experimental release. It includes codec capsules, the baseline wallet engine, workers, and local Sapling proving assets. Wallet execution loads the bundled engine automatically; proving assets load only when needed. Mainnet/testnet presets include genesis hashes and activation schedules; applications supply endpoints and storage. Custom network definitions remain supported. See [wallet setup](https://zcashlabs.github.io/zcashjs/api/wallet-runtime.html) and [platform limits](https://zcashlabs.github.io/zcashjs/api/platforms.html).

```js
import { createLightClient, createWalletClient } from '@zcashlabs/zcash.js';

const light = await createLightClient('https://testnet.zec.rocks:443', { network: 'testnet' });
// Use light.network and light when creating your wallet.
```

The same import works in Node and browser applications. No separate runtime
package, Rust installation, or post-install asset download is required. Browser
bundlers emit the lazy WASM/worker/proving files alongside the application; deploy
those files too. Persistent Node wallets currently require Linux and `flock`.

Historical wallet-database migration and the complete live-browser send/receive
round trip are not yet qualified. Fresh database creation and same-candidate
reopening are verified; these do not establish older-database compatibility.

## Build and test

Use Node 22.23.4 (pinned in `.nvmrc`). Install the [build prerequisites](https://zcashlabs.github.io/zcashjs/api/building-locally.html), then:

```sh
npm ci
npm run build
```

The complete SDK is generated in `dist/`. The first build takes several minutes;
later builds reuse cached native components and proving parameters.
Run `npm run check` for lint, build and tests, or `npm pack` for a local tarball.
See [tests/README.md](https://github.com/zcashlabs/zcashjs/blob/main/tests/README.md) for additional checks.

## Documentation

```sh
npm run docs:typecheck
npm run docs:build
npm run docs:dev
```

The local guide runs at `http://127.0.0.1:4173/`. Its displayed TypeScript snippets are checked against the actual package entry point. The [documentation site](https://zcashlabs.github.io/zcashjs/) deploys to GitHub Pages after documentation checks pass on `main`. See [publishing instructions](https://zcashlabs.github.io/zcashjs/api/gitbook.html).

[Contributing](https://github.com/zcashlabs/zcashjs/blob/main/CONTRIBUTING.md) describes the PR workflow. Retained planning and research live under `docs/planning` and `docs/research` in the repository; they do not override the implemented API and are not shipped in the npm package.

## License

Project-owned code is [MIT licensed](https://github.com/zcashlabs/zcashjs/blob/main/LICENSE). Bundled dependencies retain their own licenses; preserve the [third-party notices](https://github.com/zcashlabs/zcashjs/blob/main/licenses/README.md) when redistributing JavaScript/WASM artifacts.
