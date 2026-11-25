// Run under Bun: a wallet whose worker dies without an orderly close must reopen in the
// same process (zcashlabs/zcashjs#34). Prints "reopened" on success.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createWalletClient, defineNetwork, encodeNetworkParameters } from '../../dist/src/index.js';

const schedule = { encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1, Heartwood: 1,
  Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1, Nu7: 1 };
const path = await mkdtemp(join(tmpdir(), 'bun-lease-'));
try {
  const network = await defineNetwork({ identity: 'bun-lease', genesisHash: '03'.repeat(32), ...encodeNetworkParameters(schedule) });
  const options = { network, storage: { kind: 'node-filesystem', path }, recovery: { mode: 'offline' } };
  let captured;
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.type === 'initialize') captured = this;
    return Reflect.apply(post, this, [message, ...rest]);
  };
  let wallet;
  try { wallet = await createWalletClient('http://127.0.0.1:1', options); }
  finally { Worker.prototype.postMessage = post; }
  assert.ok(captured, 'wallet worker captured');
  await wallet.accounts.list();
  // Kill the owner without release(); Bun keeps its descriptors (and the flock) open.
  await captured.terminate();
  await assert.rejects(async () => wallet.accounts.list(), error => ['WORKER_CRASHED', 'CLOSED'].includes(error.code));
  await (async () => wallet.close())().catch(error => { if (!['WORKER_CRASHED', 'CLOSED'].includes(error.code)) throw error; });
  const reopened = await createWalletClient('http://127.0.0.1:1', options);
  await reopened.accounts.list();
  await reopened.close();
  console.log('reopened');
} finally {
  await rm(path, { recursive: true, force: true });
}
