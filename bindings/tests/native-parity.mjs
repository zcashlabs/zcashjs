// Native/WASM parity: the same inputs through the generated wasm-bindgen bindings and
// the native C ABI (via its JS shim) must give identical results and identical thrown
// values (string codes, Error messages). Run after `cargo xtask build`:
//
//   cargo build --release -p zakura-bindings-native --bin zakura-native-bridge
//   node tests/native-parity.mjs build/sdk target/release/zakura-native-bridge
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sdk, bridge] = process.argv.slice(2).map(value => resolve(value));
assert.ok(sdk && bridge, 'usage: node tests/native-parity.mjs SDK_OUTPUT BRIDGE');
const root = resolve(import.meta.dirname, '..');
const load = async (dir, module, wasm) => {
  const bindings = await import(pathToFileURL(join(dir, module)));
  bindings.initSync({ module: readFileSync(join(dir, wasm)) });
  return bindings;
};
const wasm = {
  ...await load(join(sdk, 'primitive'), 'bindings.js', 'bindings_bg.wasm'),
  ...await load(join(sdk, 'lightwire/wasm'), 'zakura_lightwire.js', 'zakura_lightwire_bg.wasm'),
  ...await load(join(sdk, 'transparent-address/wasm'), 'zakura_transparent_address.js', 'zakura_transparent_address_bg.wasm'),
};
const { createFifoTransport } = await import(pathToFileURL(join(root, 'crates/native/js/fifo-transport.mjs')));
const { createStatelessBindings, createRuntimeBindings } = await import(pathToFileURL(join(root, 'crates/native/js/bindings.mjs')));
const transport = createFifoTransport(bridge);
const native = createStatelessBindings(transport);

// Outcome of one call: value (bytes as hex, handles through describe) or thrown value.
const settle = (fn) => {
  try {
    const value = fn();
    return { ok: normalize(value) };
  } catch (error) {
    return typeof error === 'string' ? { code: error } : { error: String(error?.message ?? error) };
  }
};
function normalize(value) {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (value && typeof value === 'object' && typeof value.free === 'function') return '<object>';
  return value;
}
let compared = 0;
const failures = [];
function same(label, call) {
  const left = settle(() => call(wasm)), right = settle(() => call(native));
  compared++;
  try { assert.deepEqual(right, left); } catch { failures.push({ label, wasm: left, native: right }); }
  return left;
}

const enc = text => new TextEncoder().encode(text);
const fixture = JSON.parse(readFileSync(join(root, 'tests/parity-fixture.json'), 'utf8'));
const params = enc(fixture.parameters);
const nu7 = enc(fixture.parameters.replace('}', ',"Nu7":110}'));

// consensus_branch / transaction_id
for (const [format, doc] of [['zcash-js-network/1', params], ['zcash-js-network/2', nu7], ['zcash-js-network/1', nu7], ['zcash-js-network/3', params]]) {
  for (const height of [0, 9, 10, 19, 20, 59, 60, 99, 100, 109, 110, 0xffffffff]) same(`branch ${format} ${height}`, b => b.consensus_branch(format, doc, height));
}
same('branch invalid document', b => b.consensus_branch('zcash-js-network/1', enc('{}'), 1));
for (const vector of JSON.parse(readFileSync(join(root, 'tests/transaction-vectors.json'), 'utf8'))) {
  const bytes = Buffer.from(vector.hex, 'hex');
  same(`txid ${vector.name}`, b => b.transaction_id(bytes, vector.branch));
  same(`txid ${vector.name} wrong branch`, b => b.transaction_id(bytes, 0));
  same(`txid ${vector.name} truncated`, b => b.transaction_id(bytes.subarray(0, bytes.length - 1), vector.branch));
}
same('txid empty', b => b.transaction_id(new Uint8Array(), 0));

// viewing authority and addresses
const pools = JSON.stringify(['transparent', 'sapling', 'ironwood']);
for (const [format, encoded] of [['ufvk', fixture.ufvk], ['uivk', fixture.uivk], ['ufvk', fixture.uivk], ['ufvk', 'junk']]) {
  same(`viewing_open ${format}`, b => b.viewing_open(params, format, encoded, pools));
}
const handles = new Map([wasm, native].map(binding => [binding, binding.viewing_open(params, 'ufvk', fixture.ufvk, pools)]));
same('describe', b => handles.get(b).describe());
for (const fmt of ['ufvk', 'uivk', 'bad']) same(`export ${fmt}`, b => handles.get(b).export(fmt, 'discloses-viewing-authority'));
same('export unacknowledged', b => handles.get(b).export('ufvk', 'no'));
same('to_incoming describe', b => { const h = handles.get(b).to_incoming(); try { return h.describe(); } finally { h.free(); } });
for (const request of ['{"format":"unified","transparent":"require","sapling":"require","ironwood":"require"}', '{}', 'not json']) {
  for (const index of ['0', '1', '18446744073709551616', 'x']) same(`derive ${index} ${request}`, b => handles.get(b).derive(index, request));
  same(`find ${request}`, b => handles.get(b).find('0', request, 100));
}
for (const handle of handles.values()) handle.free();
same('use after free', b => handles.get(b).describe());
for (const address of [fixture.address, 'junk', fixture.ufvk]) {
  same(`decode_address ${address.slice(0, 12)}`, b => b.viewing_decode_address(params, address));
  for (const pool of ['transparent', 'sapling', 'ironwood', 'nope']) same(`select ${pool}`, b => b.viewing_select_receiver(params, address, pool, 100, 0xc8e71055));
}

// birthday
const tree = Buffer.from(fixture.birthday.tree, 'hex');
const genesis = new Uint8Array(32).fill(3);
const birthdayGenesis = Buffer.from(fixture.birthday.genesis, 'hex');
for (const [first, recover] of [[100, undefined], [100, 100], [100, 120], [1, undefined], [100, 99]]) {
  same(`birthday ${first} ${recover}`, b => b.validate_birthday(params, birthdayGenesis, first, tree, recover));
}
same('birthday short genesis', b => b.validate_birthday(params, genesis.subarray(1), 100, tree, undefined));
same('birthday empty tree', b => b.validate_birthday(params, genesis, 100, new Uint8Array(), undefined));

// standalone PCZT
const pczt = JSON.parse(readFileSync(join(root, 'tests/pczt-fixture.json'), 'utf8'));
const pcztParams = enc(pczt.parameters), pcztGenesis = Buffer.from(pczt.genesis, 'hex');
for (const key of ['v4', 'v2', 'pczt', 'redacted']) {
  if (typeof pczt[key] !== 'string') continue;
  const bytes = Buffer.from(pczt[key], 'base64url').length ? Buffer.from(pczt[key], /^[0-9a-f]+$/.test(pczt[key]) ? 'hex' : 'base64') : new Uint8Array();
  same(`pczt ${key} inspect`, b => { const p = b.parse_standalone_pczt(pcztParams, pcztGenesis, pczt.height, pczt.branch, bytes, 4194304); try { return p.inspect(); } finally { p.free(); } });
  same(`pczt ${key} serialize`, b => { const p = b.parse_standalone_pczt(pcztParams, pcztGenesis, pczt.height, pczt.branch, bytes, 4194304); try { return p.serialize(); } finally { p.free(); } });
  same(`pczt ${key} redact`, b => { const p = b.parse_standalone_pczt(pcztParams, pcztGenesis, pczt.height, pczt.branch, bytes, 4194304); try { const r = p.redact('{"profile":"none"}'); try { return r.serialize(); } finally { r.free(); } } finally { p.free(); } });
  same(`pczt ${key} combine`, b => { const p = b.parse_standalone_pczt(pcztParams, pcztGenesis, pczt.height, pczt.branch, bytes, 4194304); try { const c = p.combine(p); try { return c.serialize(); } finally { c.free(); } } finally { p.free(); } });
}
same('pczt junk', b => b.parse_standalone_pczt(pcztParams, pcztGenesis, pczt.height, pczt.branch, enc('junk'), 4194304));

// lightwire
for (const vector of JSON.parse(readFileSync(join(root, 'lightwire/tests/golden.json'), 'utf8'))) {
  if (vector.direction === 'request') same(`lightwire encode ${vector.method}`, b => b.lightwire_encode(vector.method, JSON.stringify(vector.dto)));
  else for (const item of [false, true]) same(`lightwire decode ${vector.method} ${item}`, b => b.lightwire_decode(vector.method, Buffer.from(vector.hex, 'hex'), item));
}
for (const vector of JSON.parse(readFileSync(join(root, 'lightwire/tests/malformed.json'), 'utf8')).slice(0, 40)) {
  for (const cut of (vector.cuts ?? []).slice(0, 6)) same(`lightwire malformed ${vector.method} ${cut}`, b => b.lightwire_decode(vector.method, Buffer.from(vector.hex, 'hex').subarray(0, cut), false));
}
same('lightwire unknown method', b => b.lightwire_encode('Nope', '{}'));
same('tree state', b => b.lightwire_encode_tree_state(JSON.stringify(fixture.treeState)));

// transparent addresses
for (const token of fixture.transparent) for (const family of ['main', 'test', 'regtest', 'nope']) {
  same(`taddr ${token.slice(0, 8)} ${family}`, b => b.transparent_address_decode(token, family));
}

// Wallet boundary: owner-bound calls on a native runtime match the WASM runtime.
const { initializeWalletRuntime } = await import(pathToFileURL(join(sdk, 'bundle/wallet.mjs')));
const { initializeNativeWalletRuntime } = await import(pathToFileURL(join(sdk, 'bundle/wallet.mjs')));
const { viewsForStorage } = await import(pathToFileURL(join(sdk, 'bundle/views.mjs')));
const runtimeId = transport.createRuntime();
const runtimes = {
  wasm: initializeWalletRuntime(readFileSync(join(sdk, 'bundle/bindings_bg.wasm'))),
  native: initializeNativeWalletRuntime(createRuntimeBindings(transport, runtimeId)),
};
const views = Object.fromEntries(Object.entries(runtimes).map(([name, rt]) => [name, viewsForStorage(rt.openMemory('zcash-js-network/1', params, genesis))]));
// Normalize identifiers and revisions, which are random per wallet.
const scrub = value => JSON.parse(JSON.stringify(value, (key, v) => typeof v === 'bigint' ? `${v}n` : v)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/"revision":"[^"]+"/g, '"revision":"<revision>"'));
const walletCompare = async (label, op, args) => {
  const outcome = async v => { try { return { ok: scrub(await v.call(v.generation, v.instance, op, args)) }; } catch (e) { return { error: `${e?.message}` }; } };
  const [left, right] = [await outcome(views.wasm), await outcome(views.native)];
  compared++;
  try { assert.deepEqual(right, left); } catch { failures.push({ label, wasm: left, native: right }); }
  return left;
};
await walletCompare('account_list empty', 'account_list', {});
const imported = await walletCompare('account_import', 'account_import', { viewingKey: fixture.ufvk, birthday: 'fullScan', name: 'parity' });
await walletCompare('account_import duplicate', 'account_import', { viewingKey: fixture.ufvk, birthday: 'fullScan' });
await walletCompare('account_list', 'account_list', {});
await walletCompare('scan_state', 'scan_state', {});
await walletCompare('account_get missing', 'account_get', { accountId: '00000000-0000-4000-8000-000000000000' });
await walletCompare('proposal_list', 'proposal_list', { afterSequence: '0', limit: 10 });
await walletCompare('payment_list', 'payment_list', { afterSequence: '0', limit: 10 });
await walletCompare('invalid op', 'nope', {});
for (const [name, rt] of Object.entries(runtimes)) {
  const view = views[name];
  view.close(view.generation, view.instance);
  void rt;
}
transport.destroyRuntime(runtimeId);
transport.close();

console.log(JSON.stringify({ compared, failures: failures.length, imported: imported.ok ? 'ok' : imported.error }));
if (failures.length) {
  for (const failure of failures.slice(0, 20)) console.error(JSON.stringify(failure));
  process.exitCode = 1;
}
