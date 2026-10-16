import { createWalletClient } from '@zcashlabs/zcash.js';
import type { WalletEndpointOptions } from '@zcashlabs/zcash.js';

declare const endpoint: string;
const options: WalletEndpointOptions = {
  network: 'testnet',
  storage: { kind: 'memory' },
};
const wallet = await createWalletClient(endpoint, options);
await wallet.close();

// @ts-expect-error Storage must be an explicit choice.
await createWalletClient(endpoint, { network: 'testnet' });
// @ts-expect-error Unknown preset names are rejected.
await createWalletClient(endpoint, { ...options, network: 'typo' });
