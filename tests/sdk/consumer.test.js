import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import webpack from 'webpack';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { build } from 'vite';

// File descriptors also work in sandboxes that deny socket-backed child pipes.
async function exec(command, args, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'zcash-sdk-command-'));
  const stdout = await open(join(folder, 'stdout'), 'w+');
  const stderr = await open(join(folder, 'stderr'), 'w+');
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(command, args, { ...options, stdio: ['ignore', stdout.fd, stderr.fd] });
      child.once('error', reject);
      child.once('close', resolve);
    });
    const output = { stdout: await readFile(join(folder, 'stdout'), 'utf8'), stderr: await readFile(join(folder, 'stderr'), 'utf8') };
    assert.equal(code, 0, `${command} ${args.join(' ')}\n${output.stdout}\n${output.stderr}`);
    return output;
  } finally {
    await stdout.close();
    await stderr.close();
    await rm(folder, { recursive: true, force: true });
  }
}
const implemented = ['accountFromViewingKey', 'accountIndex', 'addresses', 'blockHash', 'createCustomSigner', 'createLightClient', 'createPublicClient', 'createWalletClient', 'createZcashClient', 'defineNetwork', 'diversifierIndex', 'encodeNetworkParameters', 'formatZec', 'getConsensusContext', 'grpc', 'httpTransport', 'isZcashError', 'parseZec', 'pczt', 'readGenesisHash', 'resolveBirthday', 'txId', 'viewing'];

test('packed release imports and typechecks in an isolated Node consumer', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'zcash-sdk-consumer-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { stdout } = await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', folder]);
  const [packed] = JSON.parse(stdout);
  assert.ok(packed.files.some(file => file.path === 'dist/src/index.js'));
  assert.ok(packed.files.some(file => file.path === 'dist/src/types.d.ts'));
  assert.ok(packed.files.every(file => !file.path.startsWith('dist/docs/')), 'package declarations must be source-owned');
  assert.ok(packed.files.every(file => !file.path.startsWith('qualification/')));
  const topLevel = new Set(['README.md', 'CHANGELOG.md', 'LICENSE', 'package.json']);
  for (const { path } of packed.files) {
    assert.ok(topLevel.has(path) || path.startsWith('dist/src/') || path.startsWith('licenses/'),
      `unexpected packaged file: ${path}`);
    assert.doesNotMatch(path, /(?:^|\/)(?:private|\.local|\.env(?:\.[^/]*)?|[^/]+\.(?:db|sqlite|pczt|tgz))(?:\/|$)/);
  }
  const consumer = join(folder, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // Install the packed bytes with runtime dependencies already resolved by npm ci.
  // An empty registry cache must not force this isolated consumer online.
  const repository = resolve(import.meta.dirname, '../..');
  const lock = JSON.parse(await readFile(join(repository, 'package-lock.json'), 'utf8'));
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (!path.startsWith('node_modules/') || dependency.dev || dependency.devOptional) continue;
    await cp(join(repository, path), join(consumer, path), { recursive: true });
  }
  const installed = join(consumer, 'node_modules/@zcashlabs/zcash.js');
  await mkdir(installed, { recursive: true });
  await exec('tar', ['-xzf', join(folder, packed.filename), '--strip-components=1', '-C', installed]);
  const manifest = JSON.parse(await readFile(join(consumer, 'node_modules/@zcashlabs/zcash.js/package.json'), 'utf8'));
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.name, '@zcashlabs/zcash.js');
  assert.equal(manifest.version, lock.version);
  assert.equal(manifest.version, lock.packages[''].version);
  assert.equal(manifest.version, JSON.parse(await readFile(join(repository, 'examples/testnet/package.json'), 'utf8')).dependencies[manifest.name]);
  assert.deepEqual(manifest.publishConfig, { access: 'public', tag: 'latest', registry: 'https://registry.npmjs.org/' });
  assert.deepEqual(manifest.dependencies, { '@grpc/grpc-js': '1.14.4' });
  for (const hook of ['preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts[hook], undefined);
  const assetPrefix = 'dist/src/runtime/assets/';
  const inventory = JSON.parse(await readFile(join(installed, assetPrefix, 'inventory.json'), 'utf8'));
  const isNotice = name => name === 'LICENSE' || name.startsWith('licenses/');
  assert.deepEqual(packed.files.filter(file => file.path.startsWith(assetPrefix)).map(file => file.path.slice(assetPrefix.length)).sort(),
    [...Object.keys(inventory).filter(name => !isNotice(name)), 'inventory.json'].sort(),
    'runtime/proving files ship once; notices belong at the package root');
  for (const [name, expected] of Object.entries(inventory)) {
    const bytes = await readFile(join(installed, isNotice(name) ? '' : assetPrefix, name));
    assert.equal(bytes.length, expected.byteLength, name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
  }
  const readme = await readFile(join(installed, 'README.md'), 'utf8');
  for (const [, target] of readme.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
    assert.ok(packed.files.some(file => file.path === target.split('#')[0]), `README link missing from tarball: ${target}`);
  }
  await writeFile(join(consumer, 'runtime.mjs'), `
    import assert from 'node:assert/strict';
    const originalWasm = globalThis.WebAssembly;
    Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, get() { throw Error('WASM forbidden'); } });
    globalThis.fetch = () => { throw Error('Import/construction must be lazy'); };
    const sdk = await import('@zcashlabs/zcash.js');
    const native = await import('@zcashlabs/zcash.js/grpc-node');
    assert.deepEqual(Object.keys(native), ['createGrpcNodeTransport']);
    assert.equal(native.createGrpcNodeTransport('http://127.0.0.1:1', { sourceId: 'fixture', timeoutMs: 10 }).kind, 'custom-lightwallet');
    assert.equal(sdk.parseZec('9007199254740993.00000001'), 900719925474099300000001n);
    sdk.httpTransport('https://synthetic.invalid', { sourceId: 'fixture', timeoutMs: 10, readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 256 });
    await assert.rejects(import('@zcashlabs/zcash.js/dist/src/http.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, value: originalWasm });
    const network = await sdk.defineNetwork({identity:'bundled-consumer',genesisHash:'03'.repeat(32),parametersFormat:'zcash-js-network/1',parameters:new TextEncoder().encode(JSON.stringify({encoding:'regtest',Overwinter:10,Sapling:20,Blossom:30,Heartwood:40,Canopy:50,Nu5:60,Nu6:70,Nu6_1:80,Nu6_2:90,Nu6_3:100}))});
    const wallet = await sdk.createWalletClient({network,storage:{kind:'memory'},confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},observation:{pollIntervalMs:1000,maxBufferedUpdates:16},recovery:{mode:'offline'}});
    try { assert.deepEqual(await wallet.accounts.list(), []); } finally { await wallet.close(); }
    // Corrupt only this disposable installed copy, then restore it for bundler checks.
    const fs = await import('node:fs/promises');
    const wasmPath = new URL('./node_modules/@zcashlabs/zcash.js/dist/src/runtime/assets/wallet/bindings_bg.wasm', import.meta.url);
    const originalBytes = await fs.readFile(wasmPath);
    const options = {network,storage:{kind:'memory'},confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},observation:{pollIntervalMs:1000,maxBufferedUpdates:16},recovery:{mode:'offline'}};
    try {
      const corrupted = Buffer.from(originalBytes); corrupted[corrupted.length - 1] ^= 1;
      await fs.writeFile(wasmPath, corrupted);
      await assert.rejects(sdk.createWalletClient(options), {code:'RUNTIME_UNAVAILABLE'});
      await fs.unlink(wasmPath);
      await assert.rejects(sdk.createWalletClient(options), {code:'RUNTIME_UNAVAILABLE'});
    } finally { await fs.writeFile(wasmPath, originalBytes); }
    console.log(JSON.stringify(Object.keys(sdk).sort()));
  `);
  const runtime = await exec(process.execPath, [join(consumer, 'runtime.mjs')], { cwd: consumer });
  assert.deepEqual(JSON.parse(runtime.stdout), implemented);
  // Resolve the actual installed exports, without aliases into the repository.
  await writeFile(join(consumer,'webpack-entry.mjs'), `
    import * as sdk from '@zcashlabs/zcash.js';
    export const names=Object.keys(sdk).sort();
    export const wallet=sdk.createWalletClient;
    export const amount=sdk.formatZec(sdk.parseZec('1.00000001'));
    export const transport=sdk.httpTransport('https://synthetic.invalid',{sourceId:'webpack',timeoutMs:1000,maxResponseBytes:4096,readRetry:{attempts:1,delayMs:0}});
  `);
  for(const variant of ['full','query',...(process.env.WALLET_WEBPACK_OUTPUT?['wallet']:[])]){
    const queryOnly=variant==='query',walletOnly=variant==='wallet';
    if(walletOnly)await writeFile(join(consumer,'webpack-entry.mjs'),`
      import {createWalletClient,defineNetwork} from '@zcashlabs/zcash.js';
      export async function runWallet(options){const network=await defineNetwork(options.network);const wallet=await createWalletClient({...options,network,confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},observation:{pollIntervalMs:1000,maxBufferedUpdates:16},recovery:{mode:'offline'}});let count;try{count=(await wallet.accounts.list()).length;await wallet.getSyncStatus();}finally{await wallet.close();}if(count!==0)throw Error('fresh bundled wallet must be empty');return {closed:true,accounts:count};}
    `);
    if(queryOnly)await writeFile(join(consumer,'webpack-entry.mjs'),"import {parseZec,formatZec,createPublicClient,httpTransport} from '@zcashlabs/zcash.js'; export {createPublicClient,httpTransport}; export const amount=formatZec(parseZec('1.00000001'));\n");
    const compiler=webpack({mode:'production',context:consumer,target:['web','es2022'],entry:'./webpack-entry.mjs',devtool:false,...(walletOnly?{experiments:{outputModule:true}}:{}),
      performance:{hints:false},module:{parser:{javascript:{dynamicImportMode:'eager'}}},optimization:{minimize:false},output:{path:join(consumer,'webpack'),filename:'bundle.js',library:walletOnly?{type:'module'}:{name:'SDKProbe',type:'var'},...(walletOnly?{module:true}:{}),globalObject:'globalThis',publicPath:''}});
    let stats;try{stats=await new Promise((resolve,reject)=>compiler.run((error,result)=>error?reject(error):resolve(result)));}finally{await new Promise((resolve,reject)=>compiler.close(error=>error?reject(error):resolve()));}
    assert.equal(stats.hasErrors(),false,stats.toString({all:false,errors:true}));
    const details=stats.toJson({all:false,warnings:true,modules:true});
    // Variable imports are confined to Node-only branches; never execute in this web target.
    assert.deepEqual(details.warnings.map(warning=>({module:warning.moduleName,message:warning.message})),queryOnly?[]:[
      'grpc.js','wallet/host.js','wallet/host.js'
    ].map(name=>({module:'./node_modules/@zcashlabs/zcash.js/dist/src/'+name,message:'Critical dependency: the request of a dependency is an expression'})));
    const code=await readFile(join(consumer,'webpack/bundle.js'),'utf8');
    if(walletOnly){
      const output=resolve(process.env.WALLET_WEBPACK_OUTPUT);await mkdir(output,{recursive:true});
      const tarball=await readFile(join(folder,packed.filename)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(output,'wallet.mjs'),code);await writeFile(join(output,'package.tgz'),tarball);
      await writeFile(join(output,'receipt.json'),JSON.stringify({webpack:'5.110.3',bundleSha256:sha(code),tarballSha256:sha(tarball),consumerSha256:sha(await readFile(import.meta.filename)),lockSha256:sha(await readFile('package-lock.json'))},null,2)+'\n');continue;
    }
    const globals={URL,Headers,TextEncoder,TextDecoder,AbortController,AbortSignal,EventTarget,setTimeout,clearTimeout,performance};
    globals.self = globals;
    globals.location = { href: 'https://consumer.test/nested/index.html' };
    Object.defineProperty(globals,'WebAssembly',{get(){throw Error('native initialization forbidden');}});
    globals.fetch=()=>{throw Error('unexpected asset or endpoint request');};
    const context=vm.createContext(globals,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(code,context);
    assert.equal(context.SDKProbe.amount,'1.00000001');
    if(queryOnly){assert.doesNotMatch(code,/wallet-worker|SQLite|sapling-spend|openWalletRuntime/);assert.equal(typeof context.SDKProbe.createPublicClient,'function');assert.equal(typeof context.SDKProbe.httpTransport,'function');}
    else{assert.deepEqual([...context.SDKProbe.names],implemented);assert.equal(typeof context.SDKProbe.wallet,'function');}
  }

  if(process.env.WALLET_RUNTIME_PACKAGE){
    const packet=process.env.WALLET_RUNTIME_PACKAGE,manifestBytes=await readFile(join(packet,'manifest.json')),manifest=JSON.parse(manifestBytes);
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),assets=new Map([['manifest.json',{bytes:manifestBytes,type:'application/json'}]]);
    for(const file of manifest.files){const bytes=await readFile(join(packet,file.url));assert.equal(sha(bytes),file.sha256);assert.equal(bytes.length,file.byteLength);assets.set(file.url,{bytes,type:file.kind==='wasm'?'application/wasm':'text/javascript'});}
    const requests=[],server=createServer({cert:await readFile(process.env.WALLET_TLS_CERT),key:await readFile(process.env.WALLET_TLS_KEY)},(req,res)=>{
      requests.push(req.url);const asset=assets.get(req.url.slice(1));if(!asset||req.headers.authorization||req.headers.cookie){res.writeHead(400).end();return;}res.writeHead(200,{'content-type':asset.type});res.end(asset.bytes);
    });
    try{
      server.listen(0,'127.0.0.1');await once(server,'listening');
      await writeFile(join(consumer,'wallet.mjs'),`
        import assert from 'node:assert/strict';
        import {readdir} from 'node:fs/promises';
        import {tmpdir} from 'node:os';
        import {createWalletClient,defineNetwork} from '@zcashlabs/zcash.js';
        const before=(await readdir(tmpdir())).filter(x=>x.startsWith('zcash-wallet-runtime-')).sort();
        const network=await defineNetwork({identity:'fixture',genesisHash:'03'.repeat(32),parametersFormat:'zcash-js-network/1',parameters:new TextEncoder().encode(JSON.stringify({encoding:'regtest',Overwinter:10,Sapling:20,Blossom:30,Heartwood:40,Canopy:50,Nu5:60,Nu6:70,Nu6_1:80,Nu6_2:90,Nu6_3:100}))});
        const options={network,storage:{kind:'node-filesystem',path:process.env.CONSUMER_WALLET_PATH},runtime:{baseline:{manifestUrl:process.env.CONSUMER_MANIFEST_URL,manifestSha256:process.env.CONSUMER_MANIFEST_SHA},threading:{mode:'baseline'},maxMemoryBytes:512*1024*1024,maxQueuedBytes:65536,maxQueuedJobs:8,scanBatchSize:10,maxPcztBytes:1048576},confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:false},observation:{pollIntervalMs:1000,maxBufferedUpdates:16},recovery:{mode:'offline'}};
        for(let i=0;i<2;i++){const wallet=await createWalletClient(options);try{assert.deepEqual(await wallet.accounts.list(),[]);await wallet.getSyncStatus();assert.ok(wallet.recovery);}finally{await wallet.close();await wallet.close();}}
        assert.deepEqual((await readdir(tmpdir())).filter(x=>x.startsWith('zcash-wallet-runtime-')).sort(),before);
        console.log('installed public wallet: native filesystem open/read/close/reopen PASS');
      `);
      const result=await exec(process.execPath,['wallet.mjs'],{cwd:consumer,env:{...process.env,CONSUMER_WALLET_PATH:join(folder,'wallet'),CONSUMER_MANIFEST_URL:`https://127.0.0.1:${server.address().port}/manifest.json`,CONSUMER_MANIFEST_SHA:sha(manifestBytes)}});
      assert.match(result.stdout,/open\/read\/close\/reopen PASS/);assert.equal(requests.length,2*(manifest.files.length+1));t.diagnostic(result.stdout.trim());
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }else t.diagnostic('Actual installed wallet check requires WALLET_RUNTIME_PACKAGE and trusted WALLET_TLS_CERT/WALLET_TLS_KEY.');

  await writeFile(join(consumer, 'consumer.ts'), `
    import { parseZec, formatZec, txId, blockHash, accountIndex, diversifierIndex, httpTransport, grpc, createLightClient, createPublicClient, isZcashError, defineNetwork, getConsensusContext } from '@zcashlabs/zcash.js';
    import type { TxId, BlockHash, AccountIndex, DiversifierIndex, HttpTransport, LightClient, ZcashError, Network, NetworkDefinition } from '@zcashlabs/zcash.js';
    import type { AccountId, SecretInput, CompactBlock, HeightRange } from '@zcashlabs/zcash.js';
    // @ts-expect-error Account IDs retain their database identity brand.
    const rawAccountId: AccountId = 'not-a-database-account';
    const definition: NetworkDefinition = null!;
    const network: Promise<Network> = defineNetwork(definition);
    const context: import('@zcashlabs/zcash.js').ConsensusContext = getConsensusContext({ network: null! as Network, targetHeight: 20 });
    const light: LightClient = createLightClient({ network: null! as Network, transport: grpc('https://synthetic.invalid', {
      sourceId: 'fixture', timeoutMs: 1000, readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 4096,
    }) });
    const amount: bigint = parseZec('1.234');
    const text: string = formatZec(amount);
    const tx: TxId = txId('a'.repeat(64));
    const hash: BlockHash = blockHash('b'.repeat(64));
    const publicClient: import('@zcashlabs/zcash.js').PublicClient = createPublicClient({ network: null! as Network, transport: httpTransport('https://synthetic.invalid', { sourceId: 'public', timeoutMs: 1000, readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 4096 }), observation: { pollIntervalMs: 1000, maxBufferedUpdates: 4 } });
    const account: AccountIndex = accountIndex(0);
    const index: DiversifierIndex = diversifierIndex(0n);
    const transport: HttpTransport = httpTransport('https://synthetic.invalid', {
      sourceId: 'test', timeoutMs: 1000, readRetry: { attempts: 1, delayMs: 0 }, maxResponseBytes: 4096,
    });
    const caught: unknown = null;
    if (isZcashError(caught)) { const error: ZcashError = caught; error.paymentState?.steps; error.syncStatus?.scan; }
    import { createWalletClient, createZcashClient } from '@zcashlabs/zcash.js';
    import type { WalletClient, WalletOptions, ZcashClient } from '@zcashlabs/zcash.js';
    const wallet: Promise<WalletClient> = createWalletClient(null! as WalletOptions);
    const combined: ZcashClient = createZcashClient({public: publicClient, light, wallet: null! as WalletClient});
    // @ts-expect-error Transport has no public raw-request escape hatch.
    transport.request('getblockchaininfo');
    // @ts-expect-error No implicit number-to-bigint coercion.
    formatZec(1);
    // @ts-expect-error Display hashes have separate brands.
    const wrong: TxId = hash;
  `);
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'],
    strict: true, noEmit: true, types: [], exactOptionalPropertyTypes: true,
  }, include: ['consumer.ts'] }));
  await exec(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')]);
  // The same actual installed declarations must resolve for browser bundlers.
  await exec(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json'), '--module', 'ESNext', '--moduleResolution', 'Bundler']);
  // Native declarations resolve under NodeNext, while browser Bundler conditions exclude them.
  await writeFile(join(consumer, 'native.ts'), `
    import { createGrpcNodeTransport } from '@zcashlabs/zcash.js/grpc-node';
    import type { GrpcNodeOptions } from '@zcashlabs/zcash.js/grpc-node';
    const options: GrpcNodeOptions = { sourceId: 'fixture', timeoutMs: 10 };
    const transport = createGrpcNodeTransport('http://127.0.0.1:1', options);
    const result: Promise<Uint8Array> = transport.unary({ method: 'GetLatestBlock', request: new Uint8Array() });
    // @ts-expect-error Unary methods exclude streaming RPCs.
    transport.unary({ method: 'GetBlockRange', request: new Uint8Array() });
    // @ts-expect-error Native transport is absent from the root API.
    import { createGrpcNodeTransport as rootNative } from '@zcashlabs/zcash.js';
  `);
  await exec(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(consumer, 'native.ts')]);
  await writeFile(join(consumer, 'native.ts'), `
    // @ts-expect-error Node-only subpath is unavailable to browser bundlers.
    import { createGrpcNodeTransport } from '@zcashlabs/zcash.js/grpc-node';
  `);
  await exec(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noEmit', '--strict', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', join(consumer, 'native.ts')]);
});

test('browser bundle imports and executes reads without Node globals or native initialization', async () => {
  const result = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, minify: false, target: 'es2022',
    lib: { entry: resolve('tests/sdk/browser-entry.js'), name: 'SDKProbe', formats: ['iife'] },
  } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  assert.equal(outputs.length, 1);
  const code = outputs[0].code;
  assert.doesNotMatch(code, /__vite-browser-external|require\(/);
  let calls = 0;
  const globals = { URL, Headers, Response, ReadableStream, TextEncoder, TextDecoder,
    AbortController, AbortSignal, EventTarget, performance, setTimeout, clearTimeout,
    fetch: async (_url, init) => {
      calls++;
      assert.equal(init.credentials, 'omit');
      const { id } = JSON.parse(init.body);
      return new Response(`{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":{"value":9007199254740993}}`);
    },
  };
  Object.defineProperty(globals, 'WebAssembly', { get() { throw Error('WASM forbidden'); } });
  const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(code, context);
  assert.equal(calls, 0);
  const observed = await context.SDKProbe.run();
  assert.equal(observed.amount, '9007199254740993.00000001');
  assert.equal(observed.value, '9007199254740993');
  assert.equal(observed.errorCode, 'INVALID_ARGUMENT');
  assert.deepEqual([...observed.exports], implemented);
  assert.equal(calls, 1);
});
