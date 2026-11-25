import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient } from '../../dist/src/public.js';
import { defineNetwork } from '../../dist/src/network.js';
import { httpTransport } from '../../dist/src/http.js';
import { initialize as wire } from '../../dist/src/runtime/lightwire-capsule.mjs';
import { initialize as addressCodec } from '../../dist/src/runtime/transparent-address-capsule.mjs';
import { fixture, result, genesis, blockOne, transportOptions } from '../clients/public-chain-reads-fixtures.js';
import { verifiedPacket } from '../clients/public-transaction-reads-packet.js';
import { publicNetworkDefinition } from './public-client-fixture.js';
import { address } from './light-client-fixture.js';
const { vectors } = await verifiedPacket();
const vector = vectors.filter(v=>v.branch===0x76b809bb).sort((a,b)=>a.hex.length-b.hex.length)[0];
const network = await defineNetwork(publicNetworkDefinition());
const observation = {pollIntervalMs:10,maxBufferedUpdates:4};
const rpcError = code => `"error":{"code":${code},"message":"SECRET"}`;

test('complete internal PublicClient composes all eleven methods with native codecs and actual HTTP', async () => {
  let state = 'mined', tipHeight=1, tipHash=blockOne.verbose.hash;
  const server = await fixture(call => {
    if(call.method==='getblockchaininfo') return result({blocks:tipHeight,bestblockhash:tipHash});
    if(call.method==='getblockheader') {
      const block=call.params[0]==='0'||call.params[0]===genesis.verbose.hash?genesis:blockOne;
      return result(call.params[1]?block.verbose:block.raw);
    }
    if(call.method==='getblock') return result({...blockOne.verbose,nTx:1,tx:[vector.display]});
    if(call.method==='getrawtransaction') return state==='absent'?rpcError(-5):result({txid:vector.display,hex:vector.hex,in_active_chain:state==='mined',
      ...(state==='mined'?{height:1,blockhash:blockOne.verbose.hash,confirmations:1}:{})});
    if(call.method==='getaddressutxos') {
      assert.deepEqual(call.params,[{addresses:[address],chainInfo:true}]);
      const decoded=addressCodec().decode(address,'main');
      return result({hash:blockOne.verbose.hash,height:1,utxos:[{address,txid:vector.display,outputIndex:0,satoshis:42,height:1,script:`76a914${Buffer.from(decoded.payload).toString('hex')}88ac`}]});
    }
    if(call.method==='z_gettreestate') return result({hash:blockOne.verbose.hash,height:1,time:blockOne.verbose.time,
      sapling:{commitments:{finalState:'000000'}},orchard:{commitments:{finalState:'000000'}},ironwood:{commitments:{finalState:'000000'}}});
    if(call.method==='z_getsubtreesbyindex') return result({pool:'sapling',start_index:0,subtrees:[{root:'01'.repeat(32),end_height:1}]});
    if(call.method==='sendrawtransaction') { assert.equal(call.params[0],vector.hex); return result(vector.display); }
    throw Error(call.method);
  });
  try {
    const client=createPublicClient({network,transport:httpTransport(`${server.origin}/rpc`,transportOptions),observation});
    assert.equal(server.calls.length,0);
    assert.equal((await client.getTip()).height,1);
    assert.equal((await client.getBlock({height:1})).txids[0],vector.display);
    assert.equal((await client.getBlockHeader({height:1})).point.hash,blockOne.verbose.hash);
    assert.equal((await client.getTransaction({txid:vector.display})).raw.length,vector.hex.length/2);
    assert.equal((await client.getTransactionStatus({txid:vector.display})).inclusion.confirmations,1);
    for(const [height,hash]of[[0,genesis.verbose.hash],[1,genesis.verbose.hash]]) {
      tipHeight=height;tipHash=hash;
      assert.equal((await client.getTransactionStatus({txid:vector.display})).state,'unknown');
      await assert.rejects(async()=>{for await(const _ of client.getSubtreeRoots({pool:'sapling',startIndex:0n,limit:1})){}},{code:'PROTOCOL_MISMATCH'});
    }
    tipHeight=1;tipHash=blockOne.verbose.hash;

    const addresses = [address];
    const lookup = client.getUtxos({ addresses });
    addresses[0] = 'mutated-address';
    assert.equal((await lookup).items[0].value, 42n);
    const tree=await client.getTreeState({height:1});
    assert.equal(wire().decodeResponse('GetTreeState',tree.encoded).orchard_tree,'000000');
    const roots=[];for await(const root of client.getSubtreeRoots({pool:'sapling',startIndex:0n,limit:1}))roots.push(root);
    assert.equal(roots[0].completingBlock.hash,blockOne.verbose.hash);
    const raw = Uint8Array.from(Buffer.from(vector.hex, 'hex'));
    const broadcast = client.broadcastTransaction({ bytes: raw });
    raw.fill(0);
    assert.equal((await broadcast).outcome, 'acknowledged');
    assert.equal((await client.waitForTransaction({txid:vector.display,timeoutMs:1000})).confirmations,1);
    const watch=client.watchTransaction({txid:vector.display})[Symbol.asyncIterator]();
    const initial=(await watch.next()).value;assert.equal(initial.state,'mined');
    initial.inclusion.blockHash='ab'.repeat(32);initial.inclusion.height=999;
    state='mempool';
    const changed=(await watch.next()).value;
    assert.equal(changed.state,'mempool');assert.equal(changed.priorInclusion.blockHash,blockOne.verbose.hash);await watch.return();
    state='absent';assert.equal(await client.getTransaction({txid:vector.display}),null);
    assert.equal((await client.getTransactionStatus({txid:vector.display})).state,'notSeen');
    await assert.rejects(client.waitForTransaction({txid:vector.display,timeoutMs:30}),{code:'TIMEOUT'});
    assert.deepEqual(server.unexpected,[]);
  } finally {await server.close();}
});

test('public observation cancellation, overlap, overflow and dispatched broadcast remain bounded', async () => {
  let mode='stall', notify;
  const server=await fixture((call,_req,res)=>{
    if(call.method==='getblockheader')return result(call.params[1]?genesis.verbose:genesis.raw);
    if(call.method==='getblockchaininfo')return result({blocks:1,bestblockhash:blockOne.verbose.hash});
    if(call.method==='getrawtransaction') {
      if(mode==='stall'){res.writeHead(200);res.write('{');notify?.();return;}
      return rpcError(-5);
    }
    if(call.method==='sendrawtransaction') {
      if(mode==='send-stall'){res.writeHead(200);res.write('{');notify?.();return;}
      return mode==='malformed'?result('00'.repeat(32)):rpcError(mode==='rejected'?-25:-32603);
    }
    throw Error(call.method);
  });
  try {
    const client=createPublicClient({network,transport:httpTransport(`${server.origin}/rpc`,{...transportOptions,readRetry:{attempts:3,delayMs:0}}),observation:{pollIntervalMs:5,maxBufferedUpdates:1}});
    const controller=new AbortController();controller.signal.addEventListener('abort',e=>e.stopImmediatePropagation());
    const watch=client.watchTransaction({txid:vector.display,signal:controller.signal})[Symbol.asyncIterator]();
    const reached=new Promise(resolve=>{notify=resolve;});const first=watch.next();
    await assert.rejects(watch.next(),{code:'INVALID_ARGUMENT'});await reached;
    controller.signal.dispatchEvent(new Event('abort'));controller.abort();await assert.rejects(first,{code:'ABORTED'});await watch.return();
    mode='absent';const slow=client.watchTransaction({txid:vector.display})[Symbol.asyncIterator]();
    await slow.next();await new Promise(resolve=>setTimeout(resolve,60));await assert.rejects(slow.next(),{code:'RESOURCE_LIMIT'});await slow.return();
    const raw=Uint8Array.from(Buffer.from(vector.hex,'hex'));
    for(const [next,outcome]of[['rejected','rejected'],['internal','unknown'],['malformed','unknown']]){
      mode=next;assert.equal((await client.broadcastTransaction({bytes:raw})).outcome,outcome);
    }
    mode='send-stall';const sendCancel=new AbortController();const sent=new Promise(resolve=>{notify=resolve;});
    const sending=client.broadcastTransaction({bytes:raw,signal:sendCancel.signal});await sent;sendCancel.abort();
    assert.equal((await sending).outcome,'unknown');
    assert.equal(server.calls.filter(v=>v.method==='sendrawtransaction').length,4);
    const empty=client.watchTransaction({txid:vector.display})[Symbol.asyncIterator]();await empty.return();assert.equal((await empty.next()).done,true);
    assert.deepEqual(server.unexpected,[]);
  }finally{await server.close();}
});

test('unconsumed subtree iterator owns no dependent signal or request', () => {
  const client=createPublicClient({network,transport:httpTransport('https://synthetic.invalid',transportOptions),observation});
  const controller=new AbortController();
  const original=AbortSignal.any;let calls=0;
  AbortSignal.any=function(...args){calls++;return Reflect.apply(original,this,args);};
  try {
    const iterator=client.getSubtreeRoots({pool:'sapling',startIndex:0n,limit:1,signal:controller.signal})[Symbol.asyncIterator]();
    assert.equal(calls,0);void iterator.return();assert.equal(calls,0);
  } finally {AbortSignal.any=original;}
});

test('getUtxos matches each row to the expected script of its own requested address', async () => {
  const { createHash } = await import('node:crypto');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const sha = value => createHash('sha256').update(value).digest();
  const synthetic = (i, p2sh) => {
    const payload = Buffer.alloc(20); payload.writeUInt32BE(i);
    const body = Buffer.concat([Buffer.from([0x1c, p2sh ? 0xbd : 0xb8]), payload]);
    let n = BigInt('0x' + Buffer.concat([body, sha(sha(body)).subarray(0, 4)]).toString('hex')), text = '';
    while (n) { text = alphabet[Number(n % 58n)] + text; n /= 58n; }
    return { address: text, script: p2sh ? `a914${payload.toString('hex')}87` : `76a914${payload.toString('hex')}88ac` };
  };
  const pkh = synthetic(1, false), sh = synthetic(2, true), foreign = synthetic(3, false);
  const shSamePayload = { script: `a914${pkh.script.slice(6, 46)}87` };
  const row = (owner, index, script = owner.script) => ({ address: owner.address, txid: vector.display, outputIndex: index, satoshis: index + 1, height: 1, script });
  let utxos = [];
  const server = await fixture(call => {
    if (call.method === 'getblockheader') return result(call.params[1] ? genesis.verbose : genesis.raw);
    if (call.method === 'getaddressutxos') {
      assert.deepEqual(call.params, [{ addresses: [pkh.address, sh.address, pkh.address], chainInfo: true }]);
      return result({ hash: blockOne.verbose.hash, height: 1, utxos });
    }
    throw Error(call.method);
  });
  try {
    const client = createPublicClient({ network, transport: httpTransport(`${server.origin}/rpc`, transportOptions), observation });
    const addresses = [pkh.address, sh.address, pkh.address];
    utxos = [row(pkh, 0), row(sh, 1), row(pkh, 2), row(sh, 3)];
    const { items } = await client.getUtxos({ addresses });
    assert.deepEqual(items.map(v => [v.address, v.outputIndex, v.value, Buffer.from(v.script).toString('hex')]),
      utxos.map(v => [v.address, v.outputIndex, BigInt(v.satoshis), v.script]));
    assert.notEqual(items[0].script, items[2].script);
    items[0].script.fill(0);
    assert.equal(Buffer.from(items[2].script).toString('hex'), pkh.script);
    for (const bad of [
      [row(pkh, 0, sh.script)],
      [row(sh, 0, pkh.script)],
      [row(pkh, 0, shSamePayload.script)],
      [row(foreign, 0)],
      [{ ...row(pkh, 0), address: 7 }],
      [row(pkh, 0), row(pkh, 0)],
    ]) {
      utxos = bad;
      await assert.rejects(client.getUtxos({ addresses }), { code: 'PROTOCOL_MISMATCH' });
    }
    assert.deepEqual(server.unexpected, []);
  } finally { await server.close(); }
});

test('mined transaction decoding uses its registered historical branch', async () => {
  const future=vectors.find(v=>v.hex.startsWith('05000080'));
  assert.ok(future);
  const server=await fixture(call=>call.method==='getblockheader'?result(call.params[1]?genesis.verbose:genesis.raw):result({txid:future.display,hex:future.hex,in_active_chain:true,height:1,blockhash:blockOne.verbose.hash,confirmations:1}));
  try {
    const client=createPublicClient({network,transport:httpTransport(server.origin+'/rpc',transportOptions),observation});
    await assert.rejects(client.getTransaction({txid:future.display}),{code:'PROTOCOL_MISMATCH'});
    assert.equal(server.calls.filter(call=>call.method==='getblock').length,0);
  }finally{await server.close();}
});
