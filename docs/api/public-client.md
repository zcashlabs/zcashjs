# Query the public chain

Use a public client when you need chain data without opening a wallet:

```ts
import { createPublicClient } from '@zcashlabs/zcash.js';

export async function readTip(rpcUrl: string) {
  const client = await createPublicClient(rpcUrl);
  return client.getTip();
}
```

Omitting `network` selects mainnet. For testnet pass `{ network: 'testnet' }`;
custom networks accept a validated `Network` or `NetworkDefinition`. No provider is
selected for you, and the first read still verifies the endpoint's genesis header.
Construction initializes local codecs but makes no requests.

The shorthand defaults to a 30-second deadline per HTTP attempt, two read attempts 500 ms
apart, a 4 MiB response limit, and the source label `public-rpc`. Observers poll
every second and buffer at most 16 updates. Override selected fields with
`transportOptions` and `observation`; `readRetry`, when supplied, replaces the
whole retry policy. Explicit `createPublicClient({ network, transport,
observation })` composition remains synchronous and requires those components.

`httpTransport(url, overrides?)` owns the same bounded HTTP defaults, so
`readGenesisHash(httpTransport(rpcUrl))` also works without policy boilerplate.
The transport factory was previously named `http`; update imports and calls to
`httpTransport`.

For a custom/regtest endpoint without a configured genesis hash, use
[`readGenesisHash` to bootstrap the network](networks-amounts.md#bootstrap-a-local-regtest-endpoint)
before constructing the client.

## Authenticated endpoints

Keep credentials out of the RPC URL; credential-bearing URLs are rejected. Supply
headers through the asynchronous callback, which runs for each HTTP attempt:

```ts
import { createPublicClient } from '@zcashlabs/zcash.js';

export async function authenticatedClient(
  rpcUrl: string,
  readAuthorization: () => Promise<string>,
) {
  return createPublicClient(rpcUrl, {
    transportOptions: {
      headers: async () => ({ authorization: await readAuthorization() }),
    },
  });
}
```

The callback returns the complete authorization value expected by your endpoint
(for example, `Bearer <token>` or `Basic <base64(username:password)>`). Load it from
your application's credential store; do not put server credentials in a browser bundle.
The same `headers` option is available on `httpTransport`.

## Read a transaction

```ts
import { txId } from '@zcashlabs/zcash.js';
import type { PublicClient } from '@zcashlabs/zcash.js';

export async function inspectTransaction(client: PublicClient, displayTxid: string) {
  const id = txId(displayTxid);
  const transaction = await client.getTransaction({ txid: id });
  const observation = await client.getTransactionStatus({ txid: id });
  return { transaction, observation };
}
```

A transaction contains owned raw bytes and an observation. Status can be `notSeen`, `mempool`, `mined`, `offMainChain`, or `unknown`. `notSeen` means this source has not found it; it does not prove that no other source has it. Inclusion and confirmation fields can be `null` when the source cannot establish them.

## Watch or wait for confirmation

```ts
import { txId } from '@zcashlabs/zcash.js';
import type { PublicClient, TransactionObservation } from '@zcashlabs/zcash.js';

export async function watchTransaction(
  client: PublicClient,
  displayTxid: string,
  signal: AbortSignal,
  render: (state: TransactionObservation) => void,
) {
  for await (const state of client.watchTransaction({ txid: txId(displayTxid), signal })) {
    render(state);
    if (state.state === 'mined' && (state.inclusion?.confirmations ?? 0) >= 3) break;
  }
}

export async function waitForPayment(client: PublicClient, displayTxid: string) {
  return client.waitForTransaction({
    txid: txId(displayTxid), confirmations: 3, timeoutMs: 120_000,
  });
}
```

Breaking a `for await` loop closes the iterator. Keep consuming updates: a full observation buffer rejects instead of silently discarding changes. Reorganizations can change a previous inclusion; do not treat the first `mined` observation as permanent.

## Other reads and raw submission

`getBlock` and `getBlockHeader` accept exactly one of `{ height }` or `{ hash }`. `getUtxos({ addresses })` queries a nonempty list of transparent addresses. Tree state and subtree methods depend on server support.

`broadcastTransaction({ bytes })` submits one already-built transaction. Its outcome is `acknowledged`, `rejected`, or `unknown`. A timeout after dispatch can be `unknown`; acknowledgement is not confirmation. This API has no wallet operation journal. For wallet-created payments, use [send and recovery](send-shield.md) so exact transaction bytes and attempts are retained.
