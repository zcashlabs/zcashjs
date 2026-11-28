// Device checks: viewing tools, memory and durable encrypted wallets, reopen, and the
// errors apps rely on. Synthetic regtest data only (shared with the SDK's own tests).
const fixture = {
  parameters: '{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}',
  ufvk: 'uviewregtest144wz2yp95kwgdp70ehmf0krq47ftkjqj5x4d66uxluw2fga0qg7ryd49yxzdm64uewephagsfz98uar3h73xa3zpl8d2wwykhwmxeu8w4ypff6nk23r9d706t9gxaqn5js8wpd7f3g2wgvm2xdf5t3kvwgd7u0ng45n7z9t7jwsru3tfpxm4r5csa20u3z8ys9gjh4hv5wjldlwf4f8uec5dhv7awvwjwrqcu96d85lyp836u7z6vksj62d5tarzzhl2ldeh7jf7zszy4g024frgdlyek8nw8k0dmjxnwtyky932qta7sfw7mwhx59kle0n9hfp25lpgtr3fg99snygqydz7qc3flmtuemn9vt30lzywx3uujw8jk8rt6hz6vtrelaywtzrxsmv600lnuwsw7hfcrvfvtumm2232zvk0y6neud887jaluzqrs9nppza8dfjl4dvk93lwndj6u5naf2cdke43f2d9xzmcn0w24d4c7s8xfrf0',
  address: 'uregtest195t0mwssv3uzyd59jjw98dlxs3fwdfc4gnnjxyxysmd0ffcskj5wt88m6cwrjp7ptwrg02xc8zcchlnzrajgdq05fkd0s7tzzxh6t56v8gmru2gemvlxckhvs2lthpnetye7446pegkjx4vnathhcvrm28vtr7rgxdgk3kjpqqul5q4u0kkfxkndssh7t4msmnwe7562vm8452rnqf4',
};
const check = (ok, label) => { if (!ok) throw new Error(label); };
async function rejects(promise, code) {
  try { await promise; } catch (error) { check(error.code === code, `${code} expected, got ${error.code}`); return; }
  throw new Error(`${code} expected`);
}

export async function checks(zcash, directory, log) {
  const definition = { identity: 'example-regtest', genesisHash: '03'.repeat(32), parametersFormat: 'zcash-js-network/1',
    parameters: new TextEncoder().encode(fixture.parameters) };
  const network = await zcash.defineNetwork(definition);
  const account = await zcash.accountFromViewingKey({ network, format: 'ufvk', encoded: fixture.ufvk,
    enabledPools: ['transparent', 'sapling', 'ironwood'] });
  const found = await zcash.addresses.find({ account, start: zcash.diversifierIndex(0n), maxAttempts: 100 });
  check(found.address === fixture.address, 'native address derivation');
  log('Viewing keys and addresses: ok');

  const memory = await zcash.createWalletClient('http://127.0.0.1:1', { network: 'testnet', storage: { kind: 'memory' } });
  try {
    check((await memory.accounts.list()).length === 0, 'empty memory wallet');
    await rejects(memory.propose({ accountId: 'x', to: 'x', amount: 1n }), 'SYNC_REQUIRED');
  } finally { await memory.close(); }
  log('Memory wallet: ok');

  const path = `${directory}/zcash-example-wallet-${Date.now()}`;
  const key = new Uint8Array(32).fill(7);
  const open = encryptionKey => zcash.createWalletClient('http://127.0.0.1:1', {
    network: definition, storage: { kind: 'native-filesystem', path, ...(encryptionKey ? { encryptionKey } : {}) },
  });
  const first = await open(key);
  let imported;
  try {
    await rejects(open(key), 'STORAGE_BUSY');
    imported = await first.accounts.import({ viewingKey: fixture.ufvk, birthday: 'fullScan' });
  } finally { await first.close(); }
  await rejects(open(new Uint8Array(32).fill(8)), 'STORAGE_KEY_MISMATCH');
  const reopened = await open(key);
  try {
    const accounts = await reopened.accounts.list();
    check(accounts.length === 1 && accounts[0].id === imported.id, 'account persisted across encrypted reopen');
  } finally { await reopened.close(); }
  log('Encrypted durable wallet and reopen: ok');

  const proving = zcash.nativeProving({ directory: `${directory}/zcash-params` });
  check(proving.assets.length === 2, 'native proving options');
  log('Proving parameter options: ok');
}
