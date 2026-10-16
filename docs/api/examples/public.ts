import { createPublicClient } from "@zcashlabs/zcash.js";
import type { Network } from "@zcashlabs/zcash.js";

declare const network: Network;
declare const rpcUrl: string; // application-selected fixture endpoint

const publicClient = await createPublicClient(rpcUrl, { network });
const tip = await publicClient.getTip();
const header = await publicClient.getBlockHeader({ hash: tip.hash });
