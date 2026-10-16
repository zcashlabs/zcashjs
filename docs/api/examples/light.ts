import { createLightClient } from "@zcashlabs/zcash.js";
import type { CompactBlock, HeightRange } from "@zcashlabs/zcash.js";

declare const lightUrl: string; // application-selected fixture endpoint
declare const range: HeightRange;
declare const signal: AbortSignal;
declare function inspect(block: CompactBlock): void;

const light = await createLightClient(lightUrl, { network: 'testnet' });
for await (const block of light.streamCompactBlocks({ ...range, signal })) {
  inspect(block); // receiving data alone does not scan a wallet
}
