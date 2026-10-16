import { createLightClient, createWalletClient, defineNetwork, isZcashError } from '@zcashlabs/zcash.js';

const form = document.querySelector('#client');
const result = document.querySelector('#result');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const readTip = event.submitter.value === 'tip';
  if (!(readTip ? form.elements.endpoint : form.elements.walletName).reportValidity()) return;
  const values = new FormData(form);
  const endpoint = String(values.get('endpoint'));
  const network = String(values.get('network'));
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  result.dataset.state = 'pending';
  result.textContent = 'Working…';
  try {
    let value;
    if (readTip) {
      const light = await createLightClient(endpoint, { network });
      value = await light.getTip({ signal: AbortSignal.timeout(30_000) });
    } else {
      const wallet = await createWalletClient({
        network: await defineNetwork(network), storage: { kind: 'browser-opfs', name: String(values.get('walletName')) },
        confirmations: { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false },
        observation: { pollIntervalMs: 5000, maxBufferedUpdates: 16 },
        recovery: { mode: 'offline' },
      });
      try { value = await wallet.accounts.list(); }
      finally { await wallet.close(); }
    }
    result.textContent = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
    result.dataset.state = 'complete';
  } catch (error) {
    result.textContent = isZcashError(error) ? `${error.code}: ${error.message}` : 'Unable to complete the request.';
    result.dataset.state = 'error';
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});
