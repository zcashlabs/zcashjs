# zcash.js developer guide

Build a Zcash application with TypeScript: read the chain, maintain a local wallet, receive funds, review a payment, and recover its state after a restart.

The SDK is available from npm as an experimental release candidate. Start with
[Installation](installation.md). Public and light queries use the included
codecs. Wallet operations automatically load the included baseline WASM runtime;
local proving assets are included and loaded when needed. See [platforms and
current limits](platforms.md#current-limits) before choosing a deployment.

## Choose your starting point

| I want to… | Start here |
| --- | --- |
| Install the SDK and make a first request | [Installation](installation.md) |
| Query blocks and transactions without a wallet | [Public client](public-client.md) |
| Read lightwallet data or stream blocks | [Light client](light-client.md) |
| Keep accounts, balances, and transaction history | [Open a wallet](wallet-runtime.md) |
| Follow a complete wallet workflow | [Wallet walkthrough](walkthrough.md) |
| Recover after an interrupted payment | [Operations and recovery](operations.md) |
| Find a specific export or method | [API reference](reference.md) |

## Three clients, different jobs

- `createPublicClient`: stateless JSON-RPC queries and transaction observation.
- `createLightClient`: lightwallet queries and streams over native gRPC in Node or gRPC-Web in a browser.
- `createWalletClient`: a local database, scanning, accounts, proposals, signing, and recorded payment operations.

`createWalletClient(endpoint, { network, storage })` configures its light client
and submission route with wallet defaults. For explicit component composition,
pass `light` for scanning and `broadcaster` for submission.
`createZcashClient({ public, light, wallet })` groups existing instances and checks
their networks; it does not create or own them.

## A first example

```ts
import { formatZec, parseZec } from '@zcashlabs/zcash.js';

const amount = parseZec('0.00125');
console.log(amount);           // 125000n zatoshis
console.log(formatZec(amount)); // "0.00125"
```

Amounts are `bigint`. Keep user-entered ZEC as a string until `parseZec` validates it.

The chapters below use ordinary TypeScript and the actual package exports. Examples with function parameters expect your application to supply those values. Typechecking verifies the API calls; it does not supply network endpoints, accounts, or funds.
