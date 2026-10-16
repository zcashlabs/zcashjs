# API reference

Use the chapter links for examples. The [package entry point](https://github.com/zcashlabs/zcashjs/blob/main/src/index.ts) lists actual exports; the [source contracts](https://github.com/zcashlabs/zcashjs/blob/main/src/types.ts) contain complete TypeScript shapes. Your editor reads the same declarations from the installed package.

## Package exports

| Export | Purpose | Guide |
| --- | --- | --- |
| `defineNetwork`, `encodeNetworkParameters` | Validate and register network parameters | [Networks](networks-amounts.md) |
| `getConsensusContext` | Derive consensus context from a registered network and target height | [Networks](networks-amounts.md) |
| `parseZec`, `formatZec` | Exact ZEC/zatoshi conversion | [Amounts](networks-amounts.md) |
| `accountIndex`, `diversifierIndex`, `txId`, `blockHash` | Validate typed identifiers | [Identifiers](networks-amounts.md) |
| `httpTransport`, `readGenesisHash`, `createPublicClient` | JSON-RPC transport and public reads | [Public client](public-client.md) |
| `grpc`, `createLightClient` | Lightwallet transport and reads | [Light client](light-client.md) |
| `createWalletClient` | Open the local wallet and recover recorded work | [Wallet setup](wallet-runtime.md) |
| `createZcashClient` | Group existing same-network clients | [Introduction](README.md) |
| `resolveBirthday` | Resolve a scan starting point | [Accounts](accounts-signers.md) |
| `accountFromViewingKey`, `viewing`, `addresses` | Standalone viewing and address operations | [Receiving](receive-addresses.md) |
| `createCustomSigner`, `pczt` | Signer integration and standalone PCZT tools | [Signing](signing.md) |
| `isZcashError` | Narrow a structured SDK failure | [Errors](errors-lifecycle.md) |

`@zcashlabs/zcash.js/grpc-node` additionally exports `createGrpcNodeTransport` for explicit Node byte-transport use.

## Wallet methods

| Group | Methods | Effect |
| --- | --- | --- |
| `accounts` | `create`, `import`, `list`, `get`, `remove`, `attachSigner`, `restoreSigner`, `detachSigner` | Local account records and signer bindings |
| `addresses` | `current`, `next`, `list`, `at` | Read or record receive-address exposure |
| Planning | `propose` | Retain an immutable proposal and its locks |
| Execution | `send`, `shield` | Plan/execute and explicitly dispatch payment work |
| Stages | `build`, `prove`, `sign`, `finalize` | Prepare artifacts; finalize retains bytes without submission |
| `pczt` | `export`, `import` | Exchange artifacts associated with an operation |
| `operations` | `list`, `get`, `resume`, `abandon` | Inspect/recover work or retire an unbuilt proposal |
| Submission | `broadcast` | Submit retained bytes for an operation |
| Queries | `getBalance`, `getHistory`, `getTransaction`, `listNotes`, `listUtxos` | Read local scan/accounting state |
| Sync | `sync`, `getSyncStatus`, `watchSync` | Scan or observe progress |
| Lifetime | `close` | Drain work and close the wallet |

A `PendingPayment` exposes `operationId`, `snapshot`, `events`, `broadcast`, and `wait`. A wallet exposes `network` and the startup `recovery` report.

## Public and light methods

| Public client | Light client |
| --- | --- |
| `getTip` | `getTip`, `getServerInfo` |
| `getBlock`, `getBlockHeader` | `streamCompactBlocks` |
| `getTransaction`, `getTransactionStatus` | `getTransaction` |
| `getUtxos` | `getAddressUtxos`, `getAddressBalance` |
| `getTreeState`, `getSubtreeRoots` | `getTreeState`, `getSubtreeRoots` |
| `watchTransaction`, `waitForTransaction` | `streamAddressTransactions`, `streamMempool` |
| `broadcastTransaction` | `broadcastTransaction` |

Most asynchronous methods accept an optional `signal`. Pass only the documented options: unknown fields can reject. Streams need sequential consumption and explicit cleanup. Source observations include `sourceId` and `observedAt`; they are source evidence, not a full-node consensus verdict.
