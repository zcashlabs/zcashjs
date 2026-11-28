// Encrypted wallets move between Node (encrypted-storage.ts over the WASM VFS) and
// React Native (the zakura-enc native VFS): Node writes, native reads and writes,
// Node reads again.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pin = JSON.parse(readFileSync(join(root, 'scripts/native-source.json'), 'utf8'));
const mobile = join(root, '.cache/native', pin.revision ?? pin.release, 'mobile-host');

test('an encrypted wallet written by Node opens natively and back', { timeout: 600000 }, async () => {
  const sdk = await import('../../dist/src/index.js');
  const { fixture } = await import('../sdk/viewing-fixture.js');
  const network = { identity: 'cross-regtest', genesisHash: '03'.repeat(32), parametersFormat: 'zcash-js-network/1',
    parameters: new TextEncoder().encode(fixture.parameters) };
  const scratch = mkdtempSync(join(tmpdir(), 'zcash-cross-'));
  const path = join(scratch, 'wallet');
  const key = new Uint8Array(32).map((_, i) => i * 7 + 1);
  const open = () => sdk.createWalletClient('http://127.0.0.1:1', {
    network, storage: { kind: 'node-filesystem', path, encryptionKey: key },
  });
  try {
    const node = await open();
    let accountId;
    try { accountId = (await node.accounts.import({ viewingKey: fixture.ufvk, birthday: 'fullScan' })).id; }
    finally { await node.close(); }
    assert.equal(readFileSync(join(path, 'wallet.db')).subarray(0, 8).toString(), 'ZJSWENC1');
    const output = execFileSync(process.execPath, ['--import', './register.mjs', 'cross-native.mjs', path,
      Buffer.from(key).toString('hex'), accountId], {
      cwd: import.meta.dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, ZAKURA_NATIVE_BRIDGE: join(mobile, 'host/zakura-native-bridge'),
        ZAKURA_FIFO_TRANSPORT: join(mobile, 'js/fifo-transport.mjs') },
    });
    assert.match(output, /native ok/);
    const again = await open();
    try { assert.deepEqual(await again.accounts.list(), []); }
    finally { await again.close(); }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
