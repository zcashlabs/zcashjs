# Receive addresses and viewing

## Issue an address from a wallet

```ts
import type { AccountRecord, WalletClient } from '@zcashlabs/zcash.js';

export async function receiveAddress(wallet: WalletClient, account: AccountRecord) {
  const issued = await wallet.addresses.next({
    accountId: account.id,
    request: { format: 'unified', transparent: 'omit', sapling: 'omit', ironwood: 'require' },
  });
  return issued.address;
}
```

This Ironwood-only address matches the endpoint wallet’s default spending policy. Request additional receivers only when your spending policy and network support those pools. Omitting receiver requirements still exposes all supported receivers; the SDK default is unchanged.

`next` commits address exposure before returning. Display the returned string in your receive UI or QR code. `current({ accountId, request })` is a local read returning a string or `null`; it does not allocate an address. `list` returns issued records. `at({ accountId, index, request })` exposes an exact derivation index and is a write.

Use `{ format: 'transparent' }` for a transparent address. Explicit unified receiver requirements can fail when the account lacks the required viewing components.

## Derive without a wallet database

```ts
import { accountFromViewingKey, addresses, diversifierIndex } from '@zcashlabs/zcash.js';
import type { Network } from '@zcashlabs/zcash.js';

export async function deriveAddress(network: Network, encoded: string) {
  const account = await accountFromViewingKey({
    network, format: 'ufvk', encoded, enabledPools: ['transparent', 'sapling', 'ironwood'],
  });
  try {
    return await addresses.find({
      account,
      start: diversifierIndex(0n),
      maxAttempts: 100,
      request: { format: 'unified' },
    });
  } finally {
    await account.viewing.dispose();
  }
}
```

Standalone derivation does not record address exposure in a wallet. Prefer wallet address methods for wallet receive flows. `addresses.derive` tries an exact index; `find` performs a bounded search. `addresses.decode` inspects an address, and `addresses.selectReceiver` chooses a supported receiver for a consensus context.

`viewing.toIncoming({ account })` creates a separate incoming-viewing descriptor. Dispose each descriptor's viewing handle independently. `viewing.export` requires explicit `acknowledge: 'discloses-viewing-authority'` because a viewing key reveals private account information.

## Inspect and select a receiver

Use a reviewed proposal's context when available. For standalone selection,
derive one from the registered network and intended transaction height:

```ts
import { addresses, getConsensusContext } from '@zcashlabs/zcash.js';
import type { Network, Pool } from '@zcashlabs/zcash.js';

export async function receiver(network: Network, targetHeight: number, encoded: string, pool: Pool) {
  const context = getConsensusContext({ network, targetHeight });
  const address = await addresses.decode({ network, address: encoded });
  return addresses.selectReceiver({ address, pool, context });
}
```

Decoding exposes known receivers and unknown typecodes. A decodable address is not automatically usable for every pool or transaction context.
