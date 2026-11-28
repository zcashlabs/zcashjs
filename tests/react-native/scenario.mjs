// Runs inside the simulated React Native environment (see simulated.test.js).
import './hermes-environment.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const check = (ok, label) => { if (!ok) throw Error(label); };
const results = {};
const sdk = await import('../../dist/react-native/index.js');
try {
  check(typeof WebAssembly === 'undefined' && globalThis.crypto === undefined, 'simulated platform');
  check(typeof sdk.nativeProving === 'function' && typeof sdk.downloadProvingParameters === 'function', 'react-native exports');

  // Codec parity: the same public-API checks the Node/browser builds run.
  const { viewingChecks } = await import('../sdk/viewing-checks.js');
  const { birthdayChecks } = await import('../sdk/birthday-checks.js');
  const { pcztChecks } = await import('../sdk/pczt-checks.js');
  const { signerChecks } = await import('../sdk/signer-checks.js');
  results.viewing = await viewingChecks(sdk);
  results.birthday = await birthdayChecks(sdk);
  results.pczt = await pcztChecks(sdk);
  results.signer = await signerChecks(sdk);

  // Wallets: memory and durable, encrypted native storage on an owner thread.
  const reject = async (promise, code) => {
    try { await promise; } catch (error) { check(error.code === code, `${code}: ${error.code} ${error.message}`); return; }
    throw Error(`expected ${code}`);
  };
  const memory = await sdk.createWalletClient('http://127.0.0.1:1', { storage: { kind: 'memory' }, network: 'testnet' });
  try {
    check(memory.network.identity === 'zcash-testnet', 'testnet preset');
    check((await memory.accounts.list()).length === 0, 'empty memory wallet');
    await reject(memory.propose({ accountId: 'test', to: 'test', amount: 1n }), 'SYNC_REQUIRED');
  } finally { await memory.close(); }

  const root = mkdtempSync(join(tmpdir(), 'zcash-rn-'));
  const path = join(root, 'wallet');
  const key = new Uint8Array(32).fill(7);
  const { fixture } = await import('../sdk/viewing-fixture.js');
  // The viewing fixture is a regtest key: use its network definition.
  const regtest = { identity: 'rn-regtest', genesisHash: '03'.repeat(32), parametersFormat: 'zcash-js-network/1',
    parameters: new TextEncoder().encode(fixture.parameters) };
  const open = encryptionKey => sdk.createWalletClient('http://127.0.0.1:1', {
    network: regtest, storage: { kind: 'native-filesystem', path, ...(encryptionKey ? { encryptionKey } : {}) },
  });
  try {
    await reject(sdk.createWalletClient('http://127.0.0.1:1', { network: 'testnet', storage: { kind: 'node-filesystem', path } }), 'RUNTIME_UNAVAILABLE');
    const first = await open(key);
    let imported;
    try {
      await reject(open(key), 'STORAGE_BUSY');
      imported = await first.accounts.import({ viewingKey: fixture.ufvk, birthday: 'fullScan' });
    } finally { await first.close(); }
    await reject(open(new Uint8Array(32).fill(8)), 'STORAGE_KEY_MISMATCH');
    await reject(open(undefined), 'STORAGE_KEY_MISMATCH');
    const reopened = await open(key);
    try {
      const accounts = await reopened.accounts.list();
      check(accounts.length === 1 && accounts[0].id === imported.id, 'account persisted across encrypted reopen');
      results.durable = { reopenedAccounts: accounts.length };
    } finally { await reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }

  // Proving parameters: missing files are reported without touching JS bytes.
  const empty = mkdtempSync(join(tmpdir(), 'zcash-rn-params-'));
  try {
    const options = sdk.nativeProving({ directory: empty });
    check(options.kind === 'local' && options.assets.length === 2, 'native proving options');
  } finally { rmSync(empty, { recursive: true, force: true }); }

  // The example app's device checks, unchanged.
  const { checks } = await import('../../examples/react-native/checks.js');
  const exampleRoot = mkdtempSync(join(tmpdir(), 'zcash-rn-example-'));
  const lines = [];
  try { await checks(sdk, exampleRoot, line => lines.push(line)); } finally { rmSync(exampleRoot, { recursive: true, force: true }); }
  results.example = lines.length;

  console.log(JSON.stringify(results));
} finally {
  globalThis.__zakuraNativeClose?.();
}
