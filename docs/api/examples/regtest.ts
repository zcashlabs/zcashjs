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
