import * as sdk from '@zcashlabs/zcash.js';
import { readRpc } from '../../dist/src/http.js';

export async function run() {
  const transport = sdk.httpTransport('https://synthetic.invalid', {
    sourceId: 'browser-fixture', timeoutMs: 1000,
    readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 4096,
  });
  const result = await readRpc(transport, 'getblockchaininfo', []);
  let errorCode;
  try { sdk.txId('invalid'); } catch (error) { if (sdk.isZcashError(error)) errorCode = error.code; }
  return {
    amount: sdk.formatZec(sdk.parseZec('9007199254740993.00000001')),
    value: result.value.text, errorCode, exports: Object.keys(sdk).sort(),
  };
}
