# Errors, cancellation, and cleanup

SDK failures are structured errors. Use `isZcashError` to distinguish them from application errors and inspect the error code and any retained payment state.

```ts
import { isZcashError } from '@zcashlabs/zcash.js';

export async function attempt<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, value: await work() };
  } catch (error) {
    if (!isZcashError(error)) throw error;
    return {
      ok: false as const,
      code: error.code,
      recovery: error.recovery,
      operationId: error.operationId,
      paymentState: error.paymentState,
    };
  }
}
```

These returned details belong in the application's private UI/state, not generic telemetry. `retryable` is not permission to repeat an entire payment workflow.

| Code | Typical response |
| --- | --- |
| `INVALID_ARGUMENT` | Correct the supplied value or option |
| `NETWORK_MISMATCH` | Check network, endpoint, and runtime configuration |
| `METHOD_NOT_SUPPORTED` | Use a server/backend that implements the requested method |
| `SYNC_REQUIRED` | Revalidate/sync; if a finalized payment exists, recover that same operation rather than creating a replacement |
| `STALE_PROPOSAL` | Obtain a fresh proposal for review after resolving the retained intent |
| `SIGNER_REQUIRED` | Attach or supply an appropriate signer |
| `PROVING_MATERIAL_REQUIRED` | Configure matching local proof assets |
| `STORAGE_BUSY` | Release the other database owner |
| `RESOURCE_LIMIT` | Reduce concurrent work or adjust the relevant configured budget |
| `CURSOR_STALE` | For pagination, restart from its first page; during sync, retry a fresh sync after reducing concurrent mutations |
| `OBSERVATION_UNAVAILABLE` | Follow the recovery action; finite calls may exhaust coherent-read retries. Wallet payment events/wait keep polling through narrowly classified tip lag until cancellation or timeout |
| `ABORTED`, `TIMEOUT` | Inspect progress and retained payment state before retrying |
| `RECOVERY_REQUIRED` | Inspect recorded state and the indicated recovery action |

Setup failures identify endpoint requirements, transport policy fields, supported
network presets, and canonical custom-network parameter requirements. Messages
contain fixed SDK guidance, not supplied URLs, credentials, or secret values.
Branch on `code`; message wording is diagnostic text, not a stable API.

Viewing/address messages explain authority, receiver, consensus and search-limit
failures. Some causes share a code: check the alternatives named in the message.

Known wallet, PCZT and startup failures also provide fixed diagnostic guidance.
A specific code does not guarantee the wallet remains open: follow `recovery`
and inspect retained operation state. Node and gRPC-Web use `ABORTED`, `TIMEOUT`
and `RESOURCE_LIMIT` for server cancellation, deadline and resource exhaustion.

`STORAGE_QUOTA` identifies capacity failures recognized during storage acquisition;
later native database writes may report `STORAGE_ERROR` instead.
`ACCOUNT_BUSY`, `INVALID_AUTHORIZATION` and `REVIEW_MISMATCH` remain reserved for
compatibility and are not currently emitted by the bundled runtime.


## Cancel a read

```ts
import type { PublicClient } from '@zcashlabs/zcash.js';

export async function cancellableTip(client: PublicClient) {
  const controller = new AbortController();
  const request = client.getTip({ signal: controller.signal });
  controller.abort();
  return request; // rejects if cancellation wins
}
```

Pass genuine `AbortSignal` instances rather than object-shaped substitutes. Stop consuming streams with `break`, `return()`, or a signal. Cancellation after a write or dispatch may leave committed work, so use the operation journal to determine the next action.

Await `wallet.close()`. It stops admission and drains accepted work at safe boundaries. Dispose caller-owned signers, signer bindings, viewing handles, and PCZT handles separately. The [walkthrough](walkthrough.md) demonstrates cleanup even when an earlier cleanup step fails.
