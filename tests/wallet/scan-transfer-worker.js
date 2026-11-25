// Test entry: production worker bridge with a synthetic owner that reports received scan bytes.
import { installWalletWorker } from '../../dist/src/wallet/worker.js';
const owner = { generation: 1, instance: 'transfer', close() {}, call(_g, _i, operation, args) {
  if (operation !== 'scan_ingest_batch') throw Object.assign(Error('UNSUPPORTED'), { commit: 'none' });
  return { revision: [...args.priorTreeState, ...args.blocks.flatMap(block => [...block])].join(','),
    start: 100, endExclusive: 101, blocks: args.blocks.length };
} };
if (typeof process !== 'undefined' && process.versions?.node) {
  const { parentPort, workerData } = await import('node:worker_threads');
  installWalletWorker(owner, workerData.port);
  parentPort.postMessage('ready');
} else self.onmessage = ({ data }) => {
  self.onmessage = null;
  installWalletWorker(owner, data.port);
  self.postMessage('ready');
};
