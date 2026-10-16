import { accountIndex, defineNetwork, diversifierIndex, formatZec, parseZec } from "@zcashlabs/zcash.js";
import type { NetworkDefinition } from "@zcashlabs/zcash.js";

export async function validateInputs(definition: NetworkDefinition) {
  const network = await defineNetwork(definition);
  const index = accountIndex(0);
  const receiveIndex = diversifierIndex(0n);
  const amount = parseZec("0.00125"); // 125_000n zatoshis
  const amountZec = formatZec(amount); // "0.00125"
  return { network, index, receiveIndex, amount, amountZec };
}
