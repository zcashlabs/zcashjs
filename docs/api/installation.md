# Installation and first request

## Install from npm

Node **22.23.4** is recommended for Node applications, following the current
repository pin. The published rc.5 package engine is `>=22.12.0`.

```sh
npm install @zcashlabs/zcash.js@0.1.0-rc.5
```

The package includes TypeScript declarations, the wallet engine, workers, and
proving files. You do not need a separate runtime package or Rust toolchain.

For TypeScript projects, use ESM imports. Set `"type": "module"` in
`package.json` and use `"module": "NodeNext"` in `tsconfig.json`. Browser
applications can use their existing TypeScript/ESM bundler.

## Make your first request

Save this JavaScript-compatible example as `index.mjs`:

```ts
import { createLightClient } from '@zcashlabs/zcash.js';

const light = await createLightClient('https://testnet.zec.rocks:443', {
  network: 'testnet',
});

const tip = await light.getTip();
console.log(tip.height, tip.hash);
```

Run it directly with Node:

```sh
node index.mjs
```

Success prints the current block height and hash; these change as the chain
advances. The endpoint above serves native gRPC for Node; browser requirements
are below.

The SDK supplies the testnet genesis hash, activation schedule, and transport
defaults. No wallet is created and no funds are needed for this request.
`getTip()` returns the block height, display-order block hash, source label, and
observation time.

Omitting `network` selects **mainnet**; use a matching mainnet endpoint. A network
mismatch fails rather than silently changing chains. See
[network configuration](networks-amounts.md) for custom definitions and
[light clients](light-client.md) for transport overrides.

## Browser applications

Import the same package through your TypeScript/ESM bundler. Queries do not start
the wallet runtime or open a database. Browser lightwallet endpoints must provide
**gRPC-Web** and permit your application's origin through **CORS**; a native
gRPC endpoint alone is not sufficient. Supply an HTTP(S) origin without a path
prefix, query, fragment, or URL credentials; see [light endpoint requirements](light-client.md).

[Run the browser starter](https://github.com/zcashlabs/zcashjs/tree/main/examples/browser):
**List local accounts** works offline after assets load; **Read chain tip** needs
your own matching gRPC-Web/CORS endpoint.

For wallets, bundlers emit the lazy runtime, worker, and proving assets alongside
your application. Deploy those assets too. See [platforms](platforms.md) for
storage requirements and current limitations.

## Next steps

- [Open a wallet](wallet-runtime.md) to create accounts and scan for funds.
- [Light client](light-client.md) for queries and streams.
- [Public client](public-client.md) if you use a JSON-RPC server.
- [Build from source](building-locally.md) only if you want to develop or package the SDK yourself.
