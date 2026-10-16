# Networks, amounts, and identifiers

## Define the network once

Pass the returned `Network` to every client and viewing operation for that chain. It is an SDK-owned value; do not manufacture one with a TypeScript cast.

```ts
import { defineNetwork } from '@zcashlabs/zcash.js';

const mainnet = await defineNetwork(); // same as defineNetwork('mainnet')
const testnet = await defineNetwork('testnet');
```

The package includes genesis hashes and activation schedules through NU6.3,
matching the bundled `zcash_protocol` 0.10.6. Presets are release-pinned, not
downloaded or inferred from your endpoint. Future upgrades require an updated
SDK or an explicit matching definition. The normal light-client endpoint form
creates this network for you; reuse `light.network` for the wallet.

Use `getConsensusContext({ network, targetHeight })` to derive the branch ID from
that network's schedule. It is synchronous and makes no network requests. Supply
the intended transaction height; it does not choose a height or inspect PCZT bytes.

For a custom deployment, supply the genesis hash and a complete typed schedule:

```ts
import { blockHash, defineNetwork, encodeNetworkParameters } from '@zcashlabs/zcash.js';

import type { NetworkParameters } from '@zcashlabs/zcash.js';

export async function loadNetwork(
  identity: string,
  genesisHash: string,
  parameters: NetworkParameters,
) {
  return defineNetwork({
    identity,
    genesisHash: blockHash(genesisHash),
    ...encodeNetworkParameters(parameters),
  });
}
```

For custom definitions, your application supplies the genesis hash and exact
consensus schedule. `encodeNetworkParameters` accepts fields in any order and produces
the canonical bytes and format tag for `defineNetwork`. Every activation field is
required; the encoder does not infer or fill in consensus rules. The object's `identity` remains a label, not a preset selector.
Full objects replace the preset; they are not partially merged into mainnet.

Preset provenance: [zcash_protocol 0.10.6 consensus](https://docs.rs/zcash_protocol/0.10.6/src/zcash_protocol/consensus.rs.html)
and [Zcash genesis definitions](https://github.com/zcash/zcash/blob/master/src/chainparams.cpp).

Advanced callers can still provide `parametersFormat: 'zcash-js-network/1'` and
`parameters: Uint8Array` directly. This byte form retains strict validation.
The parameter document is canonical UTF-8 JSON: `encoding` (`main`, `test`, or `regtest`), followed by `Overwinter`, `Sapling`, `Blossom`, `Heartwood`, `Canopy`, `Nu5`, `Nu6`, `Nu6_1`, `Nu6_2`, and `Nu6_3`, in that order. Each upgrade is a nondecreasing activation height or `null`; no activated upgrade may follow an inactive one. Whitespace, duplicate keys, and extra keys are rejected. Obtain the matching document from your deployment configuration; changing a label does not change consensus rules. The [validator](https://github.com/zcashlabs/zcashjs/blob/main/src/network-parameters.ts) defines the exact format.

## Bootstrap a local regtest endpoint

`readGenesisHash(transport, { signal? })` reads `getblockhash(0)` before a
`Network` or client exists. It returns a validated `BlockHash` and uses the
transport's headers, retries, timeout, and response limit. No custom `fetch`
helper is needed.

This example assumes your node uses the activation schedule shown below;
replace it with your deployment's exact schedule.

```ts
import {
  createPublicClient, defineNetwork, encodeNetworkParameters, httpTransport, readGenesisHash,
} from '@zcashlabs/zcash.js';

export async function connectRegtest(rpcUrl: string) {
  const transport = httpTransport(rpcUrl, {
    sourceId: 'local-regtest', timeoutMs: 15_000,
    readRetry: { attempts: 2, delayMs: 100 }, maxResponseBytes: 4 * 1024 * 1024,
  });
  const genesisHash = await readGenesisHash(transport);
  const network = await defineNetwork({
    identity: 'local-regtest', genesisHash,
    ...encodeNetworkParameters({
      encoding: 'regtest',
      Overwinter: 1, Sapling: 1, Blossom: 1, Heartwood: 1, Canopy: 1,
      Nu5: 1, Nu6: 1, Nu6_1: null, Nu6_2: null, Nu6_3: null,
    }),
  });
  const client = createPublicClient({
    network, transport,
    observation: { pollIntervalMs: 1_000, maxBufferedUpdates: 16 },
  });
  const tip = await client.getTip();
  const header = await client.getBlockHeader({ hash: tip.hash });
  return { client, tip, header };
}
```

Discovery reports the endpoint's identity; it does not authenticate that endpoint
against an independently trusted chain. For a known chain, supply its configured
genesis hash instead (or use the mainnet/testnet presets). The public client still
independently reads and hashes the genesis header on its first query and rejects
a mismatch. Discovery does not infer activation heights or change consensus rules.

## Keep money exact

```ts
import { accountIndex, blockHash, diversifierIndex, formatZec, parseZec, txId } from '@zcashlabs/zcash.js';

export function paymentInputs(zec: string, transactionHex: string, blockHex: string) {
  return {
    amount: parseZec(zec),
    displayAmount: formatZec(parseZec(zec)),
    transaction: txId(transactionHex),
    block: blockHash(blockHex),
    account: accountIndex(0),
    addressIndex: diversifierIndex(0n),
  };
}
```

One ZEC is 100,000,000 zatoshis. Avoid `Number(zec) * 100000000`: floating-point rounding can change a payment. For application JSON, convert bigint fields to decimal strings explicitly; native `JSON.stringify` cannot serialize bigint.

`txId` and `blockHash` validate **display-order** hexadecimal identifiers. Account IDs come from `wallet.accounts` records; an account index is a derivation index, not a database account ID. Address derivation indices are bigint values validated by `diversifierIndex`.

The supported pool names are `transparent`, `sapling`, and `ironwood`. An `orchard` receiver encoding may appear in address inspection; it is not a selectable pool name.
