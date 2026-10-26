# Installation and first request

## Install from npm

Use Node **22.23.4**, matching the package engine and repository pin, for Node applications.

```sh
npm install @zcashlabs/zcash.js@0.1.1
```

The package includes TypeScript declarations, the wallet engine, workers, and
proving files. You do not need a separate runtime package or Rust toolchain.

Use TypeScript with ESM imports. For a Node project, set `"type": "module"` in
`package.json` and use `"module": "NodeNext"` in `tsconfig.json`. Browser
applications can use their existing TypeScript/ESM bundler.

## Make your first request

In `index.ts`:

```ts
import { createLightClient } from '@zcashlabs/zcash.js';

const light = await createLightClient('https://testnet.zec.rocks:443', {
  network: 'testnet',
});

const tip = await light.getTip();
console.log(tip.height, tip.hash);
```

Run this through your TypeScript project's usual build/run command. The endpoint
above serves native gRPC for Node; browser requirements are below.

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
gRPC endpoint alone is not sufficient.

For wallets, bundlers emit the lazy runtime, worker, and proving assets alongside
your application. Deploy those assets too. See [platforms](platforms.md) for
storage requirements and current limitations.

## Next steps

- [Open a wallet](wallet-runtime.md) to create accounts and scan for funds.
- [Light client](light-client.md) for queries and streams.
- [Public client](public-client.md) if you use a JSON-RPC server.
- [Build from source](building-locally.md) only if you want to develop or package the SDK yourself.
