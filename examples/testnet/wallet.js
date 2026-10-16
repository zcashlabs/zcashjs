// Testnet only. All wallet operations use the installed package's public root export.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { addresses, createLightClient, createWalletClient, formatZec, parseZec, resolveBirthday } from '@zcashlabs/zcash.js';
import { waitForConfirmation } from './confirmation.js';
import { initializeAccount } from './initialize.js';

const command = process.argv[2] ?? 'status';
assert.ok(['probe', 'init', 'addresses', 'status', 'send', 'receive', 'confirm'].includes(command), 'commands: probe | init | addresses | status | send A B AMOUNT REQUEST_ID | receive B TXID AMOUNT | confirm A OPERATION_ID');
const directory = resolve(process.env.TESTNET_WALLET_DIR ?? 'private');
const light = await createLightClient(process.env.TESTNET_ENDPOINT ?? 'https://testnet.zec.rocks:443', { network: 'testnet' });
const network = light.network;
const confirmations = { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false };
const common = { network, light, broadcaster: light, confirmations,
  observation: { pollIntervalMs: 5000, maxBufferedUpdates: 16 }, recovery: { mode: 'offline' },
  transactionPolicy: { spendPools: ['ironwood'], transparent: 'disallow', changePool: 'ironwood',
    feeRule: 'zip317-standard', confirmations, expiry: { kind: 'offset', blocks: 80 },
    lockExpiryBlocks: 20, shieldingThreshold: 10000n, freshness: { mode: 'require-synced', maxLagBlocks: 0 } } };
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const report = value => console.log(json(value));
const walletPath = label => { assert.ok(['A', 'B'].includes(label)); return join(directory, label); };
const statePath = join(directory, 'accounts.json');
const open = label => createWalletClient({ ...common, storage: { kind: 'node-filesystem', path: walletPath(label) } });
async function verifyAddress(address) {
  const decoded = await addresses.decode({ network, address });
  // Ironwood uses the Orchard receiver encoding; pool and receiver names differ.
  assert.deepEqual(decoded.knownReceivers, ['orchard']);
  assert.deepEqual(decoded.unknownTypecodes, []);
}
async function nextAddress(wallet, accountId) {
  const { address } = await wallet.addresses.next({ accountId,
    request: { format: 'unified', transparent: 'omit', sapling: 'omit', ironwood: 'require' } });
  await verifyAddress(address);
  return address;
}
async function sync(wallet) {
  const status = await wallet.sync({ signal: AbortSignal.timeout(180000) });
  assert.equal(status.targetReached, true, 'wallet did not reach its captured scan target');
  return status;
}
async function load() { return JSON.parse(await readFile(statePath, 'utf8')); }
async function save(state) {
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, json(state) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, statePath);
}
async function signerFor(wallet, state, label) {
  const bytes = new TextEncoder().encode(state[label].mnemonic);
  try {
    const signer = await wallet.accounts.restoreSigner({ accountId: state[label].accountId, mnemonic: bytes });
    try {
      const binding = await wallet.accounts.attachSigner({ accountId: state[label].accountId, signer });
      assert.equal(binding.state, 'ready');
      return { signer, binding };
    } catch (error) { await signer.dispose(); throw error; }
  } finally { bytes.fill(0); }
}

if (command === 'probe') {
  report({ network: 'testnet', server: await light.getServerInfo(), tip: await light.getTip() });
} else if (command === 'init') {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let state;
  try { state = await load(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const tip = await light.getTip();
    state = { firstScanHeight: Math.max(280000, tip.height - 10),
      A: { mnemonic: generateMnemonic(wordlist, 256) }, B: { mnemonic: generateMnemonic(wordlist, 256) } };
    // Exclusive creation never replaces an existing wallet's recovery material.
    await writeFile(statePath, json(state) + '\n', { flag: 'wx', mode: 0o600 });
  }
  for (const label of ['A', 'B']) {
    const wallet = await open(label);
    try {
      state[label] = await initializeAccount(wallet, state[label],
        () => resolveBirthday({ light, firstScanHeight: state.firstScanHeight }));
      await verifyAddress(state[label].address);
      await save(state);
    } finally { await wallet.close(); }
  }
  report({ network: 'testnet', receiveA: state.A.address, receiveB: state.B.address, firstScanHeight: state.firstScanHeight });
} else if (command === 'addresses') {
  const state = await load();
  for (const label of ['A', 'B']) {
    const wallet = await open(label);
    try {
      const address = await nextAddress(wallet, state[label].accountId);
      (state[label].previousAddresses ??= []).push(state[label].address);
      state[label].address = address;
      await save(state);
    } finally { await wallet.close(); }
  }
  report({ network: 'testnet', receivers: ['ironwood'], receiveA: state.A.address, receiveB: state.B.address });
} else if (command === 'status') {
  const state = await load();
  for (const label of ['A', 'B']) {
    const wallet = await open(label);
    try { await sync(wallet); report({ wallet: label, balance: await wallet.getBalance({ accountId: state[label].accountId }), operations: await wallet.operations.list() }); }
    finally { await wallet.close(); }
  }
} else if (command === 'send') {
  const [, , , from, to, amountText, requestId] = process.argv;
  walletPath(from); walletPath(to); assert.notEqual(from, to);
  assert.match(requestId ?? '', /^[a-zA-Z0-9_-]{1,80}$/, 'stable filename-safe request ID required');
  const amount = parseZec(amountText); assert.ok(amount > 0n && amount <= parseZec('0.01'), 'test payment must be between zero and 0.01 TAZ');
  const state = await load(), wallet = await open(from);
  let authority;
  try {
    await verifyAddress(state[to].address);
    const path = join(directory, `${requestId}.json`);
    let receipt;
    try { receipt = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      receipt = { from, to, amount: amount.toString(), operationId: null };
      await writeFile(path, json(receipt) + '\n', { flag: 'wx', mode: 0o600 });
    }
    assert.deepEqual({ from: receipt.from, to: receipt.to, amount: receipt.amount }, { from, to, amount: amount.toString() }, 'request ID is already bound to another payment');
    await sync(wallet);
    let pending, retained = receipt.operationId ? await wallet.operations.get({ operationId: receipt.operationId }) : null;
    if (retained?.steps.length && retained.steps.every(step => step.txid !== null)) {
      pending = await wallet.operations.resume({ operationId: receipt.operationId });
      // An acknowledged/uncertain attempt is observed, never blindly repeated.
      if (retained.steps.every(step => step.attempts.length === 0)) await pending.broadcast();
    } else {
      authority = await signerFor(wallet, state, from);
      const proposal = await wallet.propose({ accountId: state[from].accountId, to: state[to].address, amount, idempotencyKey: requestId });
      report({ review: { from, to, amount: formatZec(amount), proposal } });
      receipt.operationId = proposal.operationId;
      await writeFile(path, json(receipt) + '\n', { mode: 0o600 });
      pending = await wallet.send({ proposal });
    }
    await writeFile(path, json({ ...receipt, snapshot: await pending.snapshot() }) + '\n', { mode: 0o600 });
    const confirmed = await waitForConfirmation(wallet, pending);
    report({ confirmed });
    await writeFile(join(directory, `${requestId}-confirmed.json`), json(confirmed) + '\n', { mode: 0o600 });
  } finally {
    try { await authority?.binding.dispose(); }
    finally { try { await wallet.close(); } finally { await authority?.signer.dispose(); } }
  }
} else if (command === 'confirm') {
  const [, , , label, operationId] = process.argv;
  walletPath(label); assert.match(operationId, /^[a-f0-9]{64}$/);
  const wallet = await open(label);
  try {
    // Observe the original operation; this command never submits or reconstructs it.
    const pending = await wallet.operations.resume({ operationId });
    const confirmed = await waitForConfirmation(wallet, pending);
    await writeFile(join(directory, `confirmed-${operationId}.json`), json(confirmed) + '\n', { mode: 0o600 });
    report({ confirmed });
  } finally { await wallet.close(); }
} else if (command === 'receive') {
  const [, , , label, txid, amountText] = process.argv;
  walletPath(label); assert.match(txid, /^[a-f0-9]{64}$/);
  const amount = parseZec(amountText), state = await load();
  for (const reopen of [false, true]) {
    const wallet = await open(label);
    try {
      await sync(wallet);
      const history = await wallet.getHistory({ accountId: state[label].accountId });
      const received = history.items.find(item => item.txid === txid);
      assert.ok(received, 'expected received transaction missing');
      assert.equal(received.balanceDelta, amount, 'received amount mismatch');
      const balance = await wallet.getBalance({ accountId: state[label].accountId });
      assert.ok(balance.amounts && balance.amounts.ironwood.spendable >= amount, 'received Ironwood funds not spendable');
      report({ wallet: label, reopen, txid, amount: amount.toString(), balance });
    } finally { await wallet.close(); }
  }
}
