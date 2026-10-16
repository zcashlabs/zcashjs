import { createWalletClient } from "@zcashlabs/zcash.js";
import type { WalletOptions } from "@zcashlabs/zcash.js";

declare const options: WalletOptions;

const wallet = await createWalletClient(options);
await wallet.close();
