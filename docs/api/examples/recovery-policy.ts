// Specification assertions only: no SDK implementation or runtime execution.
import { createWalletClient } from "@zcashlabs/zcash.js";
import type { WalletOptions, RecoveryPolicy, RecoveryReport } from "@zcashlabs/zcash.js";

declare const options: WalletOptions;
const offline = { mode: 'offline' } satisfies RecoveryPolicy;
// This 15s pass cannot satisfy a fresh 60s current-session monotonic interval.
// If elapsed time is untrusted, automatic dispatch is deferred; observation may complete.
const online = {
  mode: 'online', timeoutMs: 15_000,
  rebroadcast: { mode: 'previously-dispatched', maxAttempts: 3, minIntervalMs: 60_000 },
} satisfies RecoveryPolicy;
// No operation ID, signer, mnemonic or application recovery store is required.
const local = await createWalletClient({ ...options, recovery: offline });
const observed = await createWalletClient({ ...options, recovery: online });
const defaultOpen = await createWalletClient(options);
const report: RecoveryReport = local.recovery;
const complete: 'complete' = report.local;
void complete;
void observed.recovery.deferredOperations;
const firstPage = await local.operations.list();
const selected = firstPage.items[0];
if (selected) {
  const handle = await local.operations.resume({ operationId: selected.operationId });
  await handle.snapshot(); // optional handle selection after automatic recovery
}
await defaultOpen.close();
await local.close();
await observed.close();

// @ts-expect-error TS2322: Offline startup cannot authorize network rebroadcast.
const offlineSend: RecoveryPolicy = { mode: 'offline', rebroadcast: { mode: 'previously-dispatched', maxAttempts: 3, minIntervalMs: 60_000 } };
// @ts-expect-error TS2322: Online startup requires a finite deadline.
const unbounded: RecoveryPolicy = { mode: 'online' };
// @ts-expect-error TS2322: Opening cannot automatically dispatch never-submitted finalized work.
const newSubmission: RecoveryPolicy = { mode: 'online', timeoutMs: 1, rebroadcast: { mode: 'all-finalized', maxAttempts: 3, minIntervalMs: 1 } };
// @ts-expect-error TS2739: Automatic retry requires a durable total attempt ceiling and spacing.
const unboundedRetry: RecoveryPolicy = { mode: 'online', timeoutMs: 1, rebroadcast: { mode: 'previously-dispatched' } };
// @ts-expect-error TS2353: Opening cannot request signing authority.
await createWalletClient({ ...options, mnemonic: new Uint8Array(32) });
// @ts-expect-error TS2353: operationId is not a factory recovery prerequisite or selector.
await createWalletClient({ ...options, operationId: 'synthetic-operation' });
// @ts-expect-error TS2339: No public worker job ID recovery API.
await local.getJobID();
// @ts-expect-error TS2353: Resume selects one journal operation; it cannot authorize a new send.
await local.operations.resume({ operationId: 'synthetic-operation', broadcast: true });
// @ts-expect-error TS2345: Resume still requires an operation selector.
await local.operations.resume({});
