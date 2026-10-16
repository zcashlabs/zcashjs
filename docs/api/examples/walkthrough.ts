import { waitForConfirmation } from './confirmation.js';
import {
  createLightClient, createPublicClient, createWalletClient, defineNetwork, formatZec,
  grpc, httpTransport, isZcashError, parseZec,
} from "@zcashlabs/zcash.js";
import type {
  ErrorCode, LocalProvingOptions, MemorySigner, NetworkDefinition, PaymentState,
  Proposal, SecretInput, SignerBinding, WalletOptions,
} from "@zcashlabs/zcash.js";

// Compile-only: the application supplies validated network/proof data and private inputs.
declare const networkDefinition: NetworkDefinition;
declare const appProving: LocalProvingOptions;
declare const mnemonic: SecretInput; // application BIP39 tooling owns generation and backup
declare const recipient: string;
declare const amountInput: string; // decimal ZEC from the payment form, e.g. "0.00125"
declare function showBalance(totalZec: string): void; // private application UI
declare function review(proposal: Proposal): Promise<boolean>;
declare function showOperation(state: PaymentState): void;
declare function showRecovery(code: ErrorCode, state: PaymentState | undefined): void;

// Explicit application configuration; fixture URLs/pins are not usable release assets.
const appTransportOptions = {
  sourceId: 'walkthrough-light', timeoutMs: 15_000,
  readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 4_000_000,
};
const appObservation = { pollIntervalMs: 5_000, maxBufferedUpdates: 32 };
const confirmations = { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false };
const appWalletConfiguration: Pick<WalletOptions,
  'proving' | 'confirmations' | 'observation' | 'runtime' | 'transactionPolicy'> = {
  proving: appProving, confirmations, observation: appObservation,
  runtime: {
    baseline: {
      manifestUrl: 'https://assets.example.invalid/baseline/manifest.json',
      manifestSha256: '0'.repeat(64), // placeholder, not a valid release pin
    },
    threading: { mode: 'baseline' }, maxMemoryBytes: 512 * 1024 * 1024,
    maxQueuedBytes: 16 * 1024 * 1024, maxQueuedJobs: 8,
    scanBatchSize: 100, maxPcztBytes: 4 * 1024 * 1024,
  },
  transactionPolicy: {
    spendPools: ['sapling', 'ironwood'], transparent: 'disallow', changePool: 'ironwood',
    feeRule: 'zip317-standard', confirmations, expiry: { kind: 'offset', blocks: 40 },
    lockExpiryBlocks: 20, shieldingThreshold: 100_000n,
    freshness: { mode: 'require-synced', maxLagBlocks: 0 },
  },
};

// #region setup
const network = await defineNetwork(networkDefinition);
const publicClient = createPublicClient({
  network, observation: appObservation,
  transport: httpTransport('https://rpc.example.invalid', {
    ...appTransportOptions, sourceId: 'walkthrough-rpc',
  }),
});
const light = createLightClient({
  network, transport: grpc('https://light.example.invalid', appTransportOptions),
});
const options: WalletOptions = {
  network, light, broadcaster: publicClient,
  storage: { kind: 'node-filesystem', path: './walkthrough-wallet.sqlite' },
  ...appWalletConfiguration,
};
const wallet = await createWalletClient(options);
// #endregion setup
let signer: MemorySigner | undefined;
let binding: SignerBinding | undefined;
try {
  // #region onboarding
  const synced = await wallet.sync(); // establish local chain/tree state before creation
  if (!synced.targetReached) throw new Error('Sync must reach its target before account creation');
  const created = await wallet.accounts.create({ mnemonic });
  const accountId = created.account.id;
  signer = created.signer; // caller-owned and initially unattached
  binding = await wallet.accounts.attachSigner({ accountId, signer });
  if (binding.state !== 'ready') throw new Error('Signer binding requires recovery');
  // #endregion onboarding

  // #region receive
  const scanned = await wallet.sync();
  if (!scanned.targetReached) throw new Error('Account sync has not reached its target');
  const issued = await wallet.addresses.next({
    accountId,
    request: { format: 'unified', transparent: 'omit', sapling: 'omit', ironwood: 'require' },
  });
  // Display issued.address privately in the receive UI. Sync does not fund this account.
  // Sending requires a separate incoming payment; this specification supplies none.
  await wallet.sync();
  const balance = await wallet.getBalance({ accountId });
  const history = await wallet.getHistory({ accountId, limit: 50 });
  // Display balance/history privately; unavailable amounts are different from zero.
  if (balance.amounts === null || !balance.scan.scanComplete) throw new Error('Balance is not ready');
  showBalance(formatZec(balance.amounts.total));
  // Rust proposal selection determines sufficient funds and eligibility.
  // #endregion receive

  // #region send
  const proposal = await wallet.propose({
    accountId, to: recipient, amount: parseZec(amountInput), idempotencyKey: 'walkthrough-payment-1',
  }); // use a unique application key for each intended payment
  // Review every step, recipient, amount, fee and expiry without modifying the proposal.
  if (await review(proposal)) {
    const pending = await wallet.send({ proposal }); // execute this exact immutable proposal
    await waitForConfirmation(wallet, pending);
  } else {
    await wallet.operations.abandon({ operationId: proposal.operationId });
  }
  // #endregion send
} catch (error: unknown) {
  if (!isZcashError(error)) throw error;
  showRecovery(error.code, error.paymentState); // private UI; never log raw errors
} finally {
  try { await binding?.dispose(); }
  finally {
    try { await wallet.close(); }
    finally { await signer?.dispose(); }
  }
}

// #region restart
// In a later session, reopen the same database. No separately saved ID or signer.
const reopened = await createWalletClient(options); // bounded observation; no auto rebroadcast
try {
  // ALL operations are already locally recovered, even if network observation timed out.
  let cursor: string | undefined;
  do {
    const page = await reopened.operations.list({ ...(cursor ? { cursor } : {}), limit: 50 });
    for (const state of page.items) showOperation(state);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  // If concurrent explicit work invalidates a UI cursor, refresh the listing.
  // A selected operationId can rebind a handle via operations.resume.
  // Broadcast is a separate explicit consent action; opening never finishes unsigned work.
} catch (error: unknown) {
  if (!isZcashError(error)) throw error;
  showRecovery(error.code, error.paymentState);
} finally {
  await reopened.close();
}
// #endregion restart
