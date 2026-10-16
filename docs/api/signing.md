# Signing and PCZT exchange

The ordinary path is `wallet.send` with an attached memory signer. A memory signer returned by mnemonic onboarding is caller-owned; attach it to the account and dispose it after use.

`createCustomSigner` adapts your own `Signer` implementation. Its capabilities, account lookup, and authorization must describe the actual signing backend. The SDK does not include a ready-to-use hardware-device integration. Custom signing currently requires a single-step proposal; an unsupported multi-step flow fails with `PCZT_MULTI_STEP_UNSUPPORTED`.

## Exchange an already prepared PCZT

This function starts with an artifact whose required proof state has already been prepared. Your exchange callback owns the device/file/transport interaction and review UX.

```ts
import type { PcztArtifact, WalletClient } from '@zcashlabs/zcash.js';

export async function externalSign(
  wallet: WalletClient,
  prepared: PcztArtifact,
  exchangeWithSigner: (bytes: Uint8Array) => Promise<Uint8Array>,
) {
  const exchange = await wallet.pczt.export({ pczt: prepared });
  const returned = await exchangeWithSigner(exchange.bytes);
  const authorized = await wallet.pczt.import({
    operationId: exchange.operationId, bytes: returned,
  });
  if (!authorized.proofsComplete || !authorized.authorizationComplete) {
    throw new Error('The returned artifact still needs proof or authorization work');
  }
  return wallet.finalize({ pczt: authorized });
}
```

`finalize` verifies and stores final bytes locally; it does **not** submit them. Call `pending.broadcast()` explicitly afterward, then use the [send guide’s confirmation helper](send-shield.md#send-a-payment) to scan and observe confirmations with a bounded wait. `pending.wait()` alone does not scan the wallet. Treat exported PCZTs as sensitive data.

## Local stages and standalone tools

The local stage methods are `wallet.build`, `wallet.prove`, `wallet.sign`, and `wallet.finalize`. Proof/sign order depends on the signer's role requirements. Prefer `wallet.send` for the SDK-managed flow instead of assuming every signer accepts the same stage order.

The standalone `pczt` namespace provides `parse`, `inspect`, `serialize`, `combine`, and `redact`. Parsing requires the correct consensus context. Dispose every returned `PcztHandle`. Parsing or inspection alone does not prove authorization, consensus acceptance, or a successful submission.

## Inspect standalone PCZT bytes

```ts
import { pczt } from '@zcashlabs/zcash.js';
import type { ConsensusContext } from '@zcashlabs/zcash.js';

export async function inspectPczt(bytes: Uint8Array, context: ConsensusContext) {
  const handle = await pczt.parse({ bytes, context, maxBytes: 4 * 1024 * 1024 });
  try {
    return await pczt.inspect({ pczt: handle });
  } finally {
    await handle.dispose();
  }
}
```

Reuse the corresponding proposal's context. Without a proposal, use
`getConsensusContext({ network, targetHeight })` only when the application knows
the PCZT's intended network and height. The helper derives consensus rules; it
does not establish the bytes' context. Do not substitute the current chain tip.
