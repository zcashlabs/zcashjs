# Open a wallet

A wallet owns a local database and a worker. Supply an endpoint and choose where
to store its data:

```ts
import { createWalletClient } from '@zcashlabs/zcash.js';

const wallet = await createWalletClient('https://testnet.zec.rocks:443', {
  network: 'testnet',
  storage: { kind: 'node-filesystem', path: './my-wallet' },
});

try {
  const accounts = await wallet.accounts.list();
  console.log(accounts);
} finally {
  await wallet.close();
}
```

The SDK configures the light client, submission route, runtime, proving assets,
and transaction policy. Opening a wallet does not generate a recovery phrase,
attach a signer, scan the chain, or send a payment. See
[Accounts and signers](accounts-signers.md) to import or create an account.

## Defaults

| Option | Default |
| --- | --- |
| Network | Mainnet; use `network: 'testnet'` for testnet |
| Connection | The supplied endpoint, used for scanning and explicit submission |
| Runtime and proving | Bundled engine, workers, and on-demand proving files |
| Confirmations | 3 trusted and 3 untrusted; no zero-confirmation shielding |
| Observation | Poll every 5 seconds; buffer up to 16 updates |
| Spending and change | Ironwood only; transparent inputs disallowed |
| Fee rule | ZIP-317 standard |
| Transaction expiry | 80 blocks after the proposal's target height |
| Proposal lock expiry | 20 blocks |
| Shielding threshold | 10,000 zatoshis |
| Freshness | Require a synced wallet, with no allowed block lag |
| Startup recovery | Local/offline reconciliation; no automatic rebroadcast |

The network preset supplies genesis and activation rules. The endpoint must match
that network; the SDK does not auto-detect or silently switch chains.
Ironwood-only defaults require Ironwood-capable funds and recipients. Other pools
or transparent shielding require an explicit transaction policy.

Call `wallet.sync()` before proposing a payment. Submission still requires a
valid account, spending authority, and an explicit send/broadcast call.

## Choose storage

Storage is required: the SDK never silently chooses a temporary wallet.

| Environment | Storage |
| --- | --- |
| Node | `{ kind: 'node-filesystem', path: './my-wallet' }` |
| Browser | `{ kind: 'browser-opfs', name: 'my-wallet' }` |
| Disposable session | `{ kind: 'memory' }` |

Memory storage loses local wallet state and operation records after close.
Back up recovery material separately. Only one owner should open a database at a
time; conflicting ownership can fail with `STORAGE_BUSY`.
Browser endpoints must support gRPC-Web and CORS. See [platforms](platforms.md).

## Override configuration

Pass a preset name, a registered `Network`, or a full `NetworkDefinition` as
`network`. Configure the endpoint through `transportOptions`:

```ts
import { createWalletClient } from '@zcashlabs/zcash.js';

export async function openWallet(endpoint: string) {
  return createWalletClient(endpoint, {
    network: 'testnet',
    storage: { kind: 'node-filesystem', path: './my-wallet' },
    transportOptions: { timeoutMs: 15000, sourceId: 'my-node' },
    confirmations: { trusted: 5, untrusted: 5, allowZeroConfirmationShielding: false },
    observation: { pollIntervalMs: 3000, maxBufferedUpdates: 16 },
  });
}
```

`runtime` accepts individual budget overrides. `confirmations`, `observation`,
`recovery`, `proving`, and `transactionPolicy` accept their complete option
objects. A supplied transaction policy also supplies the query confirmations
unless `confirmations` is explicit; if both are provided, they must match.
See [proposals](proposals.md) for transaction policy and [operations and
recovery](operations.md) for recovery options.

An explicit `runtime.baseline` selects a compatible authenticated runtime.
Custom `proving` supplies reviewed asset requirements and a byte-loading callback;
lengths and digests are checked. No remote proving service is supplied.

## Supply your own clients

For separate scanning and submission routes, offline wallets, or a custom
transport, supply the components directly:

```ts
import { createWalletClient } from '@zcashlabs/zcash.js';
import type { LightClient, WalletStorage } from '@zcashlabs/zcash.js';

export function openReadOnly(light: LightClient, storage: WalletStorage) {
  return createWalletClient({
    network: light.network,
    light,
    storage,
    confirmations: { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false },
    observation: { pollIntervalMs: 5000, maxBufferedUpdates: 16 },
    recovery: { mode: 'offline' },
  });
}
```

In this component form, `broadcaster` and `transactionPolicy` are explicit:
omitting them leaves submission and planning unconfigured. Providing only
`light` enables scanning, not broadcasting.

Always await `wallet.close()`. Returned signers remain caller-owned and need
their own `dispose()`. See the [walkthrough](walkthrough.md) for cleanup.
