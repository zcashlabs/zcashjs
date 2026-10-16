import type { WalletClient, PendingPayment } from '@zcashlabs/zcash.js';

export async function waitForConfirmation(wallet: WalletClient, pending: PendingPayment) {
  const timeoutMs = 900_000;
  const stop = new AbortController();
  const signal = stop.signal;
  const watching = (async () => {
    for await (const _status of wallet.watchSync({ signal })) { /* Drain every status. */ }
    throw Error('Sync watcher ended before confirmation.');
  })();
  const waiting = pending.wait({ confirmations: 3, timeoutMs, signal });
  try {
    return await Promise.race([watching, waiting]);
  } finally {
    stop.abort();
    await Promise.allSettled([watching, waiting]);
  }
}
