# Node and browser setup

| Capability | Node | Browser |
| --- | --- | --- |
| ESM package imports | Node 22.23.4 | ESM bundler with modern WebAssembly support |
| Public queries | HTTP JSON-RPC | HTTP JSON-RPC with CORS |
| Light queries | Native gRPC | gRPC-Web endpoint with CORS |
| Durable wallet storage | `node-filesystem` on Linux with `/usr/bin/flock` | `browser-opfs` in a secure context |
| Disposable wallet | `memory` | `memory` |
| Wallet execution | Worker threads | Dedicated workers |

Browser RPC parsing also requires `JSON.parse` reviver `context.source` for lossless numeric tokens, and cancellation uses `AbortSignal.any`. A browser with WebAssembly alone is not sufficient.

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

## Current limits

The package is an experimental prerelease. Endpoint factories default to mainnet, but require an explicit provider endpoint (see [wallet defaults](wallet-runtime.md#defaults)). It has no managed artifact hosting, persistent secret vault, database backup API, remote proving integration, or concrete hardware signer integration. Storage is not advertised as encrypted at rest.

The current persistent Node adapter is Linux-specific and uses the operating
system's `flock` utility for crash-safe ownership. macOS and Windows persistent
wallet storage are not qualified. Bundling the WASM does not change that existing
platform limit; the memory wallet has no filesystem-lock dependency.

Fresh wallet databases, reopening, and the [closed-wallet Linux backup/restore
procedure](operations.md#closed-wallet-backup-on-linux) have same-candidate tests. Historical database migration is not yet qualified; same-version reopen
tests are not evidence of upgrade compatibility for an older wallet database.

The complete live-browser send/receive round trip is not yet qualified.

The GitHub Pages workflow checks documentation only. Run `npm run check` locally for linting and the Node test suite. Actual Firefox SDK and wallet-host checks are separate runnable checks; a passing bundle build is not a browser execution test. The [test guide](https://github.com/zcashlabs/zcashjs/blob/main/tests/README.md) describes which checks execute real native fixtures and which need external runtime/proving packages.
