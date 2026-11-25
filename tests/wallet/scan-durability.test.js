import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessagePort } from 'node:worker_threads';
import { createLightClient, createWalletClient, defineNetwork, encodeNetworkParameters } from '@zcashlabs/zcash.js';
import { blockBytes, tipBytes, bytesField, scalar, concat, revision } from '../clients/light-chain-reads-fixtures.js';
import { networkBinding } from '../../dist/src/network.js';

// Real bundled native owner and filesystem database; only the empty chain is synthetic.
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const network = await defineNetwork({ identity: 'scan-durability', genesisHash: '03'.repeat(32),
  ...encodeNetworkParameters({ encoding: 'regtest', Overwinter: 1, Sapling: 1, Blossom: 1,
    Heartwood: 1, Canopy: 1, Nu5: 1, Nu6: 1, Nu6_1: 1, Nu6_2: 1, Nu6_3: 1 }) });
const { definition, codec } = networkBinding(network);
const tip = 40, hashAt = height => new Uint8Array(32).fill(height === 0 ? 3 : 0x40 + height);
const text = (field, value) => bytesField(field, new TextEncoder().encode(value));
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
// BlockRange { start: BlockID { height }, end: BlockID { height } } with single-byte heights.
const range = request => { assert.equal(request[0], 0x0a); const end = 2 + request[1]; return [request[3], request[end + 3]]; };

function chain(control) {
  return createLightClient({ network, transport: {
    kind: 'custom-lightwallet', sourceId: 'scan-durability', protocolRevision: revision,
    async unary({ method, request }) {
      if (method === 'GetLightdInfo') return concat(text(1, 'fixture'), text(2, 'synthetic'), text(4, 'regtest'), scalar(5, 1),
        text(6, codec.consensusContext(definition.parametersFormat, definition.parameters.bytes, 1).branchId.toString(16).padStart(8, '0')),
        scalar(7, tip), text(18, 'v0.5.0'));
      if (method === 'GetLatestBlock') return tipBytes(tip, hashAt(tip));
      if (method === 'GetTreeState') {
        const height = request[0] === 8 ? request[1] : 0;
        return concat(text(1, 'regtest'), ...(height ? [scalar(2, height)] : []), text(3, hex(hashAt(height))), scalar(4, height + 1),
          text(5, '000000'), text(6, '000000'), text(7, '000000'));
      }
      if (method === 'GetAddressUtxos') return new Uint8Array();
      throw Error(`Unexpected fixture method: ${method}`);
    },
    async *stream({ method, request }) {
      if (method !== 'GetBlockRange') { assert.ok(['GetTaddressTransactions', 'GetSubtreeRoots'].includes(method), method); return; }
      const [start, end] = range(request);
      control.ranges.push([start, end]);
      for (let h = start; h <= end; h++) yield blockBytes(h, hashAt(h), hashAt(h - 1), concat(scalar(5, 2), bytesField(8, new Uint8Array())));
      control.onRange?.();
    },
  } });
}

test('real native scan batches transfer to the worker, survive committed cancellation and reopen', async t => {
  const path = await mkdtemp(join(tmpdir(), 'zcash-scan-durability-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const post = MessagePort.prototype.postMessage, ingests = [];
  let dispatched;
  MessagePort.prototype.postMessage = function (value, transfer) {
    const result = post.call(this, value, transfer);
    if (value?.command === 'scan_ingest_batch') {
      ingests.push({ blocks: value.args.blocks.length, transferred: transfer?.length ?? 0,
        detached: value.args.blocks.every(block => block.byteLength === 0) });
      dispatched?.();
    }
    return result;
  };
  t.after(() => { MessagePort.prototype.postMessage = post; });
  const control = { ranges: [] };
  const open = () => createWalletClient({ network, light: chain(control), recovery: { mode: 'offline' },
    confirmations: { trusted: 1, untrusted: 1, allowZeroConfirmationShielding: true },
    observation: { pollIntervalMs: 1000, maxBufferedUpdates: 16 }, storage: { kind: 'node-filesystem', path } });
  let wallet = await open(), interrupted;
  try {
    const mnemonic = new TextEncoder().encode(phrase);
    const { signer } = await wallet.accounts.import({ mnemonic, accountIndex: 0, birthday: 'fullScan' });
    await signer.dispose();
    // Abort while the first native ingest is in flight: it commits, the caller sees cancellation.
    const controller = new AbortController();
    dispatched = () => { dispatched = undefined; controller.abort(); };
    const stopped = await wallet.sync({ signal: controller.signal });
    assert.equal(stopped.activity, 'stopped');
    assert.equal(stopped.targetReached, false);
    interrupted = (await wallet.getSyncStatus()).scan;
  } finally { await wallet.close(); }
  assert.equal(ingests.length, 1, 'cancellation stops after the in-flight ingest');
  assert.equal(interrupted.maxScannedHeight, ingests[0].blocks, 'in-flight ingest committed despite cancellation');

  wallet = await open();
  try {
    const reopened = (await wallet.getSyncStatus()).scan;
    assert.equal(reopened.maxScannedHeight, interrupted.maxScannedHeight, 'committed batch survives reopen');
    const status = await wallet.sync({ signal: AbortSignal.timeout(120000) });
    assert.equal(status.targetReached, true);
    assert.equal(status.scan.fullyScannedHeight, tip);
  } finally { await wallet.close(); }
  const scannedBlocks = ingests.reduce((n, i) => n + i.blocks, 0);
  assert.ok(ingests.length >= 3, `multiple batches: ${JSON.stringify(ingests)}`);
  assert.ok(ingests.every(i => i.transferred === i.blocks + 1 && i.detached), `owned copies transferred: ${JSON.stringify(ingests)}`);

  const before = ingests.length;
  wallet = await open();
  try {
    const state = (await wallet.getSyncStatus()).scan;
    assert.equal(state.fullyScannedHeight, tip, 'completed scan survives reopen');
    assert.equal((await wallet.sync({ signal: AbortSignal.timeout(60000) })).targetReached, true);
  } finally { await wallet.close(); }
  assert.equal(ingests.length, before, 'reopened complete wallet does not rescan committed blocks');
  t.diagnostic(JSON.stringify({ ingests, scannedBlocks, interruptedAt: interrupted.maxScannedHeight }));
});
