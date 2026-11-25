// One native transparent-to-Sapling shielding proof through createWalletClient's omitted proving option.
import { createWalletClient, createLightClient, defineNetwork, grpc, pczt } from '../../dist/src/index.js';
import { saplingAssets } from '../../dist/src/wallet/proving-assets.js';

const check = (ok, label) => { if (!ok) throw Error(label); };
const hex = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
const digestHex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

export async function runBrowser() {
  const { pczt: fixture } = await (await fetch('/fixture.json')).json();
  const data = fixture.publicWallet;
  const parameters = new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}');
  const network = await defineNetwork({ identity: 'synthetic-regtest', genesisHash: '03'.repeat(32), parametersFormat: 'zcash-js-network/1', parameters });
  const light = createLightClient({ network, transport: grpc(location.origin, { sourceId: 'public-wallet-grpc-web', timeoutMs: 5000,
    maxResponseBytes: 4 * 1024 * 1024, readRetry: { attempts: 1, delayMs: 0 } }) });
  const confirmations = { trusted: 1, untrusted: 1, allowZeroConfirmationShielding: false };
  const name = 'default-proving-' + crypto.randomUUID();
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(name, { create: true });
  const writer = await (await directory.getFileHandle('wallet.db', { create: true })).createWritable();
  await writer.write(hex(data.database));
  await writer.close();
  const common = { network, confirmations, observation: { pollIntervalMs: 1000, maxBufferedUpdates: 16 }, recovery: { mode: 'offline' } };
  const options = { ...common, light,
    storage: { kind: 'browser-opfs', name },
    transactionPolicy: { spendPools: ['transparent'], transparent: 'allow-owned', changePool: 'sapling',
      feeRule: 'zip317-standard', confirmations, expiry: { kind: 'offset', blocks: 40 }, lockExpiryBlocks: 20,
      shieldingThreshold: 10000n, freshness: { mode: 'require-synced', maxLagBlocks: 0 } } };
  const rejected = async (action, code) => {
    try { await action(); } catch (error) { check(error.code === code, `expected ${code}, received ${error.code}`); return; }
    throw Error(`missing ${code}`);
  };
  let wallet;
  const nativeFetch = globalThis.fetch;
  const subarray = Uint8Array.prototype.subarray;
  const digest = SubtleCrypto.prototype.digest;
  const requests = [], delivered = new Map(), verified = [];
  try {
    globalThis.walletPhase = 'funding';
    wallet = await createWalletClient(options);
    const synced = await wallet.sync({ target: data.target });
    check(synced.targetReached && synced.enhancement.actionable === 0, 'synthetic funded wallet synced');
    const proposal = await wallet.propose({ kind: 'shield', accountId: data.accountId, toPool: 'sapling',
      threshold: 10000n, idempotencyKey: 'default-proving' });
    const inputs = proposal.steps.flatMap(step => step.inputs);
    check(inputs.length > 0 && inputs.every(input => input.pool === 'transparent')
      && inputs.reduce((sum, input) => sum + input.value, 0n) === 40000n, 'actual transparent funding selected');
    check(proposal.steps.flatMap(step => step.outputs).some(output => output.pool === 'sapling'), 'proposal shields to Sapling');
    const built = await wallet.build({ proposal });
    check(!built.authorizationComplete && !built.proofsComplete, 'native artifact starts unsigned and unproven');

    globalThis.walletPhase = 'admission';
    const cancelled = new AbortController();
    let abortAtFetch = false, started;
    globalThis.fetch = function (url, options) {
      if (String(url).endsWith('.params')) {
        check(options.credentials === 'omit' && options.redirect === 'error', 'package fetch policy');
        if (abortAtFetch) cancelled.abort();
        else {
          requests.push(new URL(url).pathname.split('/').at(-1));
          started?.();
        }
      }
      return Reflect.apply(nativeFetch, this, arguments);
    };
    await rejected(() => wallet.prove({ pczt: built, signal: AbortSignal.abort() }), 'ABORTED');
    check(requests.length === 0, 'pre-abort precedes parameter fetch');
    abortAtFetch = true;
    await rejected(() => wallet.prove({ pczt: built, signal: cancelled.signal }), 'ABORTED');
    check(cancelled.signal.aborted, 'default package fetch cancellation observed');
    abortAtFetch = false;

    // Observe loader handoff and real SHA-256 without replacing either operation.
    Uint8Array.prototype.subarray = function () {
      const result = Reflect.apply(subarray, this, arguments);
      const asset = saplingAssets.find(asset => asset.byteLength === result.byteLength);
      if (asset && result.byteOffset === 0 && result.buffer.byteLength === result.byteLength) delivered.set(asset.assetId, result);
      return result;
    };
    SubtleCrypto.prototype.digest = async function (algorithm, bytes) {
      const result = await Reflect.apply(digest, this, arguments);
      const asset = saplingAssets.find(asset => asset.byteLength === bytes?.byteLength);
      if (asset) {
        check(bytes === delivered.get(asset.assetId), 'default loader buffer adopted at verification');
        check(digestHex(result) === asset.sha256, 'canonical parameter digest');
        verified.push(asset.assetId);
      }
      return result;
    };
    globalThis.walletPhase = 'native-proof';
    // Wait until the first proof holds its reservation before testing the second.
    const fetching = new Promise(resolve => { started = resolve; });
    const proof = wallet.prove({ pczt: built });
    await Promise.race([fetching, proof]);
    await rejected(() => wallet.prove({ pczt: built }), 'RESOURCE_LIMIT');
    const proved = await proof;
    check(!proved.authorizationComplete && proved.proofsComplete && proved.artifactId !== built.artifactId, 'proof creates a distinct native artifact');
    check(JSON.stringify(verified) === JSON.stringify(saplingAssets.map(asset => asset.assetId))
      && JSON.stringify(requests) === JSON.stringify(verified), 'one verified package fetch per parameter');
    const exported = await wallet.pczt.export({ pczt: proved });
    const parsed = await pczt.parse({ bytes: exported.bytes, context: proposal.context, maxBytes: 65536 });
    try {
      const info = await pczt.inspect({ pczt: parsed });
      check(info.proofsComplete && !info.authorizationComplete && info.pools.includes('sapling'), 'serialized native Sapling proof');
    } finally { await parsed.dispose(); }
    check((await wallet.prove({ pczt: proved })).artifactId === proved.artifactId
      && requests.length === saplingAssets.length && verified.length === saplingAssets.length,
      'already complete proof reuses its identity without reading parameters');
    return { defaultProving: true, preAbort: true, fetchAbort: true, concurrentLimit: true, adoptedAndVerified: requests,
      serializedSaplingProof: true, alreadyProvenReused: true };
  } finally {
    globalThis.fetch = nativeFetch;
    Uint8Array.prototype.subarray = subarray;
    SubtleCrypto.prototype.digest = digest;
    await wallet?.close();
    await root.removeEntry(name, { recursive: true });
  }
}
