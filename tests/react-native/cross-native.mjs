// Native half of the cross-format check (simulated React Native): open the wallet a
// Node process wrote, confirm its account, remove it, close.
import './hermes-environment.mjs';
const sdk = await import('../../dist/react-native/index.js');
const { fixture } = await import('../sdk/viewing-fixture.js');
const [path, keyHex, accountId] = process.argv.slice(2);
const network = { identity: 'cross-regtest', genesisHash: '03'.repeat(32), parametersFormat: 'zcash-js-network/1',
  parameters: new TextEncoder().encode(fixture.parameters) };
try {
  const key = Uint8Array.from(keyHex.match(/../g), byte => parseInt(byte, 16));
  const wallet = await sdk.createWalletClient('http://127.0.0.1:1', { network, storage: { kind: 'native-filesystem', path, encryptionKey: key } });
  try {
    const accounts = await wallet.accounts.list();
    if (accounts.length !== 1 || accounts[0].id !== accountId) throw Error(`native read ${JSON.stringify(accounts)}`);
    await wallet.accounts.remove({ accountId, acknowledge: 'deletes-local-history' });
  } finally { await wallet.close(); }
  console.log('native ok');
} finally { globalThis.__zakuraNativeClose?.(); }
