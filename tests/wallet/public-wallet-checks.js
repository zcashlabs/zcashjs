import {createWalletClient,defineNetwork} from '../../dist/src/index.js';
import {initialize as wireCodec} from '../../dist/src/runtime/lightwire-capsule.mjs';
import {blockBytes,bytesField,concat,scalar} from '../clients/light-chain-reads-fixtures.js';
const hex=value=>Uint8Array.from(value.match(/../g)??[],byte=>parseInt(byte,16));
const check=(ok,label)=>{if(!ok)throw Error(label);};

// Shared Node FS / Firefox OPFS workflow. Funding is native-emitted synthetic state;
// this does not claim public synchronization of the compact-only funding fixture.
// options(name) supplies the existing qualified runtime/storage and actual light route;
// seed(name,bytes) uses the existing closed-database fixture staging. submitted() returns
// immutable {txid,hex} records from the existing synthetic transport's actual dispatches.
export async function publicWalletChecks(options,seed,fixture,definition,submitted) {
  const network=await defineNetwork(definition),data=fixture.publicWallet;
  const confirmations={trusted:1,untrusted:1,allowZeroConfirmationShielding:false};
  const observation={pollIntervalMs:1000,maxBufferedUpdates:16};
  const common={network,confirmations,observation};
  await publicAbandonChecks(options,seed,data,common);
  for(const mode of ['transfer','shield','tex',...(fixture.ironwoodFunding?['ironwood']:[])]) {
    const name=`public-${mode==='shield'?'transfer':mode}`;
    if(mode!=='shield')await seed(name,hex(data.database));
    let authorityWallet,wallet,signer;
    try {
      authorityWallet=await createWalletClient({...options(`${name}-authority`),...common,storage:{kind:'memory'},recovery:{mode:'offline'}});
      const imported=await authorityWallet.accounts.import({mnemonic:new TextEncoder().encode(fixture.mnemonic),accountIndex:data.accountIndex,
        birthday:{network,source:'checkpoint',firstScanHeight:data.import.birthday.firstScanHeight,priorTreeState:hex(data.import.birthday.priorTreeState)}});
      signer=imported.signer;await authorityWallet.close();authorityWallet=undefined;
      const configured={...options(name),...common,transactionPolicy:{spendPools:mode==='ironwood'?['ironwood']:mode==='shield'?['transparent']:['sapling'],transparent:mode==='shield'?'allow-owned':'disallow',changePool:mode==='ironwood'?'ironwood':'sapling',feeRule:'zip317-standard',confirmations,expiry:{kind:'offset',blocks:40},lockExpiryBlocks:20,shieldingThreshold:10000n,freshness:{mode:'require-synced',maxLagBlocks:0}}};
      const {proving,...withoutProving}=configured;
      wallet=await createWalletClient(configured);
      check((await wallet.accounts.list()).some(account=>account.id===data.accountId),'public native-funded account discovery');
      await wallet.accounts.attachSigner({accountId:data.accountId,signer});
      const synced=await wallet.sync({target:data.target});check(synced.targetReached&&synced.enhancement.actionable===0,'public sync resolves native unspent evidence');
      const balance=await wallet.getBalance({accountId:data.accountId});
      check(balance.amounts?.transparent.regular.spendable===40000n&&(mode==='shield'||balance.amounts.sapling.spendable===40000n),'public balance retains independent transparent funding');
      check((await wallet.getHistory({accountId:data.accountId})).items.length>0,'public history retains native funding');
      if(mode==='transfer')await publicEmptyForkChecks(withoutProving,seed,name+'-fork',data);
      const destination=mode==='tex'?data.tex:(await wallet.addresses.next({accountId:data.accountId,request:mode==='ironwood'?{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}:{format:'transparent'}})).address;
      const intent=mode==='shield'?{accountId:data.accountId,toPool:'sapling',threshold:10000n,idempotencyKey:`public-${mode}`}:{accountId:data.accountId,to:destination,amount:10000n,idempotencyKey:`public-${mode}`};
      const operationCount=mode==='shield'?2:1;
      const before=(await submitted()).length;
      if(mode==='transfer') {
        const transfer=await wallet.propose(intent);
        check(transfer.steps.flatMap(step=>step.inputs).every(input=>input.pool==='sapling')&&transfer.steps.flatMap(step=>step.inputs).reduce((sum,input)=>sum+input.value,0n)===40000n,'transfer selects actual Sapling funding');
        check(transfer.steps.flatMap(step=>step.outputs).some(output=>output.kind==='payment'&&output.address===destination&&output.amount===10000n),'transfer recipient and amount remain exact');
        const controller=new AbortController(),post=MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage=function(value,...rest){const result=Reflect.apply(post,this,[value,...rest]);if(value?.command==='fused_send')controller.abort();return result;};
        try {await wallet.send({proposal:transfer,signal:controller.signal});throw Error('missing committed public send cancellation');}
        catch(error){check(error.code==='ABORTED'&&typeof error.operationId==='string','committed send cancellation retains public operation identity');}
        finally {MessagePort.prototype.postMessage=post;}
        const discovered=await wallet.operations.list();
        check(discovered.items.length===1&&discovered.items.filter(item=>item.steps.every(step=>step.txid!==null)).length===1,'canceled native send retains complete outbox');
        check((await submitted()).length===before,'canceled fused completion does not dispatch');
        await wallet.close();wallet=undefined;
        wallet=await createWalletClient({...withoutProving,recovery:{mode:'online',timeoutMs:15000,rebroadcast:{mode:'previously-dispatched',maxAttempts:1,minIntervalMs:1}}});
        check(wallet.recovery.local==='complete'&&wallet.recovery.operations===operationCount&&wallet.recovery.observedOperations===1&&wallet.recovery.deferredOperations===0&&wallet.recovery.lastError===null,'startup discovers and observes canceled finalized operation');
        check((await submitted()).length===before&&(await wallet.operations.list()).items.every(item=>item.steps.every(step=>step.attempts.length===0)),'startup policy never grants first dispatch');
        await wallet.accounts.attachSigner({accountId:data.accountId,signer});
      }
      if(mode==='ironwood'){
        check(balance.amounts.ironwood.spendable===40000n,'native Ironwood funding is spendable');
        const proposal=await wallet.propose(intent),inputs=proposal.steps.flatMap(step=>step.inputs);
        check(inputs.length>0&&inputs.every(input=>input.pool==='ironwood')&&inputs.reduce((sum,input)=>sum+input.value,0n)===40000n,'public send selects only real Ironwood funds');
        check(proposal.steps.flatMap(step=>step.outputs).some(output=>output.kind==='payment'&&output.address===destination&&output.amount===10000n),'Ironwood recipient and amount remain exact');
      }
      const pending=await (mode==='shield'?wallet.shield(intent):wallet.send(intent));
      const first=await pending.snapshot(),expected=mode==='tex'?2:1;
      check(first.steps.length===expected&&first.steps.every(step=>step.txid!==null&&step.exactBytesSha256!==null),'public local execution persists every native transaction');
      check(first.steps.every(step=>step.attempts.length===1&&step.attempts[0].outcome==='acknowledged'),'public initial dispatch accounts for every step');
      if(mode==='tex')check(first.steps[1].dependsOn.length===1&&first.steps[1].dependsOn[0]===0,'real native TEX dependency');
      const original=(await submitted()).slice(before);
      check(original.length===expected&&original.every((row,index)=>row.txid===first.steps[index].txid),'native transaction bytes dispatched in parent order');
      await signer.dispose();signer=undefined;
      const beforeRetry=(await submitted()).length;
      const retry=await (mode==='shield'?wallet.shield(intent):wallet.send(intent));
      check(retry.operationId===pending.operationId,'idempotent send needs no disposed signer or rebuilt transaction');
      const repeated=(await submitted()).slice(beforeRetry);check(repeated.length===expected&&repeated.every((row,index)=>row.txid===original[index].txid&&row.hex===original[index].hex),'retries dispatch every exact native transaction');
      await wallet.close();wallet=undefined;
      // Discover from the authoritative database, without an application-saved ID.
      const sentBeforeOpen=(await submitted()).length;
      wallet=await createWalletClient({...withoutProving,recovery:{mode:'offline'}});
      check((await submitted()).length===sentBeforeOpen,'offline reopen never submits');
      const page=await wallet.operations.list({limit:1});
      const inventory=[...page.items];let cursor=page.nextCursor;
      while(cursor!==null){const next=await wallet.operations.list({limit:1,cursor});check(next.items.length===1,'each inventory page contains one real operation');inventory.push(...next.items);cursor=next.nextCursor;check(inventory.length<=operationCount,'inventory terminates at captured operations');}
      check(inventory.length===operationCount&&new Set(inventory.map(item=>item.operationId)).size===operationCount,'all database operations discovered across pages');
      check(wallet.recovery.operations===operationCount&&wallet.recovery.observedOperations===0&&wallet.recovery.deferredOperations===operationCount,'offline recovery counts every finalized observation candidate');
      const finalized=inventory.filter(item=>item.steps.some(step=>step.txid!==null));check(finalized.length===operationCount,'all discovered operations are finalized');
      const selected=finalized.find(item=>item.steps[0].txid===first.steps[0].txid);check(selected,'current payment discovered among finalized operations');
      const older=finalized.filter(item=>item!==selected).map(item=>({operationId:item.operationId,steps:item.steps.map(step=>({txid:step.txid,hash:step.exactBytesSha256,attempts:step.attempts.length}))}));
      const restored=await wallet.operations.resume({operationId:selected.operationId});
      const state=await restored.snapshot();
      check(state.steps.length===expected&&state.steps.every((step,index)=>step.txid===original[index].txid&&step.exactBytesSha256===first.steps[index].exactBytesSha256),'all exact transaction identities survive reopen');
      const controller=new AbortController();controller.abort();
      try {await restored.broadcast({signal:controller.signal});throw Error('missing public broadcast cancellation');}catch(error){check(error.code==='ABORTED','public cancellation preserves typed identity');}
      check((await submitted()).length===sentBeforeOpen,'canceled broadcast never dispatches');
      await restored.broadcast();
      const resumed=(await submitted()).slice(sentBeforeOpen);check(resumed.length===expected&&resumed.every((row,index)=>row.txid===original[index].txid&&row.hex===original[index].hex),'resumed dispatch sends every original transaction without authority or proving');
      const attemptCounts=(await restored.snapshot()).steps.map(step=>step.attempts.length);
      for(const maxAttempts of [undefined,1,2]) {
        await wallet.close();wallet=undefined;
        const beforeRecovery=(await submitted()).length;
        wallet=await createWalletClient({...withoutProving,recovery:{mode:'online',timeoutMs:15000,...(maxAttempts===undefined?{}:{rebroadcast:{mode:'previously-dispatched',maxAttempts,minIntervalMs:1}})}});
        const report=wallet.recovery;
        check(report.local==='complete'&&report.operations===operationCount&&report.observation==='complete'&&report.observedOperations===operationCount&&report.deferredOperations===0&&report.lastError===null,'online startup reconciles and observes the database operation');
        const sent=(await submitted()).slice(beforeRecovery);
        check(sent.length===(maxAttempts===1?expected:0)&&sent.every((row,index)=>row.txid===original[index].txid&&row.hex===original[index].hex),'startup retries exact ordered bytes only within persisted consent and budget');
        const recovered=(await wallet.operations.list()).items;
        const final=recovered.filter(item=>item.steps.some(step=>step.txid!==null)),current=final.find(item=>item.steps[0].txid===first.steps[0].txid);
        check(recovered.length===operationCount&&final.length===operationCount&&current&&current.steps.length===expected&&current.steps.every((step,index)=>step.attempts.length===attemptCounts[index]+Number(maxAttempts!==undefined)),'looser reopen policy cannot replenish the automatic retry budget');
        for(const prior of older){const row=recovered.find(item=>item.operationId===prior.operationId);check(row&&row.steps.every((step,index)=>step.txid===prior.steps[index].txid&&step.exactBytesSha256===prior.steps[index].hash&&step.attempts.length===prior.steps[index].attempts),'observing both finalized operations cannot refresh older exhausted retry budget');}
      }
    }finally{await wallet?.close();await authorityWallet?.close();await signer?.dispose();}
  }
  return {publicAbandon:true,localIronwood:fixture.ironwoodFunding===true,publicWallet:true,localTransfer:true,localShield:true,localTex:true,startupRecovery:true,allOperationsRecovery:true,twoFinalizedRecovery:true,publicForkReplay:true,retryBudget:true};
}

// Payload handler for the existing native gRPC / gRPC-Web test servers. Framing,
// TLS and status delivery stay with those servers; status 5 is real NOT_FOUND.
export async function publicWalletResponses(fixture,definition) {
  const {initialize:wire}=await import('../../dist/src/runtime/lightwire-capsule.mjs');
  const native=await import('../../dist/src/runtime/primitive-capsule.mjs');
  const {scalar,bytesField,concat}=await import('../clients/light-chain-reads-fixtures.js');
  native.initialize();const codec=wire(),target=fixture.publicWallet.target;
  const branch=native.consensusContext(definition.parametersFormat,definition.parameters,target.height).branchId;
  const encoded=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  const text=(field,value)=>bytesField(field,new TextEncoder().encode(value));
  const request=(method,input)=>encoded(codec.encodeRequest(method,JSON.stringify(input)));
  const sent=[],known=new Map();
  for(const row of [fixture.publicWallet,fixture.publicWallet.parent])if(row)known.set(request('GetTransaction',{hash:encoded(hex(row.txid).reverse())}),{raw:hex(row.raw),height:row.minedHeight??target.height});
  return {submitted:()=>sent.map(row=>({...row})),response(method,payload){
    const key=encoded(payload);
    if(method==='GetBlockRange'){check(key==='0a02080112020801','exact genesis handshake range');return {payload:concat(scalar(2,1),bytesField(3,new Uint8Array(32).fill(1)),bytesField(4,hex(definition.genesisHash).reverse()))};}
    if(method==='GetLightdInfo')return {payload:concat(text(1,'fixture'),text(2,'synthetic'),text(4,'regtest'),scalar(5,20),text(6,branch.toString(16).padStart(8,'0')),scalar(7,target.height),text(18,'v0.5.0'))};
    if(method==='GetLatestBlock')return {payload:concat(scalar(1,target.height),bytesField(2,hex(target.hash).reverse()))};
    if(method==='GetTreeState') {
      const genesis=key===request(method,{hash:definition.genesisHash})||key===request(method,{height:'0'});
      check(genesis||key===request(method,{height:String(target.height)}),'known public wallet tree request');
      return {payload:genesis?concat(text(1,'regtest'),scalar(2,0),text(3,definition.genesisHash),text(5,'000000'),text(6,'000000'),text(7,'000000')):hex(fixture.publicWallet.treeState)};
    }
    if(method==='SendTransaction') {
      const dto=codec.decodeResponse('GetTransaction',payload),raw=hex(dto.data);
      const tx=native.decodeTransaction(raw,branch),row={txid:tx.display,hex:encoded(raw)};
      sent.push(row);known.set(request('GetTransaction',{hash:encoded(tx.txid)}),{raw,height:0});
      return {payload:text(2,JSON.stringify(tx.display))};
    }
    if(method==='GetAddressUtxos'){
      // Validate repeated address fields, then compare the exact height/entry bound.
      const addresses=[],knownAddresses=new Set(fixture.publicWallet.unspentAddresses);
      const decoder=new TextDecoder();
      let offset=0;
      while(payload[offset]===10){
        const end=offset+2+payload[offset+1];
        const address=decoder.decode(payload.subarray(offset+2,end));
        check(knownAddresses.delete(address),'known, unique unfunded ephemeral address');
        addresses.push(address);offset=end;
      }
      check(addresses.length>0&&key===request(method,{addresses,start_height:'0',max_entries:1001}),'exact unfunded ephemeral address request');
      return {payload:new Uint8Array()};
    }
    if(method==='GetTransaction') {
      const row=known.get(key);return row?{payload:concat(bytesField(1,row.raw),scalar(2,row.height))}:{status:5};
    }
    throw Error(`unexpected public wallet fixture method ${method}`);
  }};
}

async function publicAbandonChecks(options,seed,data,common) {
  const name='public-abandon';await seed(name,hex(data.database));
  const {proving,light,broadcaster,...base}=options(name);
  const configured={...base,...common,recovery:{mode:'offline'},transactionPolicy:{spendPools:['sapling'],transparent:'disallow',changePool:'sapling',feeRule:'zip317-standard',confirmations:common.confirmations,expiry:{kind:'offset',blocks:40},lockExpiryBlocks:20,shieldingThreshold:10000n,freshness:{mode:'require-synced',maxLagBlocks:0}}};
  const rejects=async(action,code)=>{try{await action();throw Error(`missing ${code}`);}catch(error){check(error.code===code,`abandon expected ${code}, got ${error.code??error.message}`);}};
  let wallet;
  try {
    wallet=await createWalletClient({...configured,light});await wallet.sync({target:data.target});
    const to=(await wallet.addresses.next({accountId:data.accountId,request:{format:'transparent'}})).address;
    const intent={accountId:data.accountId,to,amount:10000n,idempotencyKey:'abandon-original'};
    const original=await wallet.propose(intent),operationId=original.operationId;
    await wallet.close();wallet=await createWalletClient(configured);
    const canceled=new AbortController();canceled.abort();
    await rejects(()=>wallet.operations.abandon({operationId,signal:canceled.signal}),'ABORTED');
    check((await wallet.operations.get({operationId})).phase!=='abandoned','pre-admission cancellation retains proposal');
    const controller=new AbortController(),post=MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage=function(value,...rest){const result=Reflect.apply(post,this,[value,...rest]);if(value?.command==='payment_abandon')controller.abort();return result;};
    try {await rejects(()=>wallet.operations.abandon({operationId,signal:controller.signal}),'ABORTED');}
    finally {MessagePort.prototype.postMessage=post;}
    await wallet.close();wallet=await createWalletClient({...configured,light});
    const state=await wallet.operations.get({operationId});
    check(state.phase==='abandoned'&&state.missing.length===0,'committed abandonment survives close and reopen');
    check((await wallet.operations.abandon({operationId})).revision===state.revision,'repeated abandonment does not mutate revision');
    check((await wallet.operations.list()).items.some(row=>row.operationId===operationId&&row.phase==='abandoned'),'abandoned operation remains discoverable');
    const handle=await wallet.operations.resume({operationId}),events=handle.events();
    check((await events.next()).value.phase==='abandoned'&&(await events.next()).done,'abandoned event stream terminates');
    await rejects(()=>handle.wait(),'ROLE_PRECONDITION');await rejects(()=>handle.broadcast(),'ROLE_PRECONDITION');
    await rejects(()=>wallet.propose(intent),'ROLE_PRECONDITION');
    await rejects(()=>wallet.operations.abandon({operationId:'ff'.repeat(32)}),'OPERATION_NOT_FOUND');
    await wallet.sync({target:data.target});
    const replacement=await wallet.propose({...intent,idempotencyKey:'abandon-replacement'});
    check(replacement.operationId!==operationId&&replacement.steps[0].inputs.length>0,'released funds support a new proposal');
    await wallet.operations.abandon({operationId:replacement.operationId});
    await rejects(()=>wallet.build({proposal:replacement}),'ROLE_PRECONDITION');
    const built=await wallet.propose({...intent,idempotencyKey:'abandon-built'});await wallet.build({proposal:built});
    await rejects(()=>wallet.operations.abandon({operationId:built.operationId}),'ROLE_PRECONDITION');
  } finally {await wallet?.close();}
}

// Empty competing suffixes preserve the native funding commitments and full-tx evidence.
// This checks public sync rewind/replay, not removal or re-mining of a funded note.
async function publicEmptyForkChecks(options,seed,name,data){
  const codec=wireCodec(),base=options.light,height=data.target.height,fundingRaw=hex(data.raw);
  const nativeTree=codec.decodeResponse('GetTreeState',hex(data.treeState));
  const metadata=codec.decodeItem('GetBlockRange',hex(data.block)).chain_metadata;
  const treeSizes=bytesField(8,concat(scalar(1,metadata.sapling_commitment_tree_size),scalar(2,metadata.orchard_commitment_tree_size),scalar(3,metadata.ironwood_commitment_tree_size)));
  let branch=0,active=false,sourceId,fundingAddress;const reads=[],delivered=[];
  const hash=(h)=>h===height?data.target.hash:(branch===0?'31':'42').repeat(31)+(h-height).toString(16).padStart(2,'0');
  const source={...base,
    async getTip(args){if(!active)return base.getTip(args);const tip=await base.getTip(args);return {...tip,height:height+2,hash:hash(height+2)};},
    async getTreeState(args){
      if(!active||args.height===undefined||args.height<=height)return base.getTreeState(args);
      check(args.height<=height+2,'bounded empty fork tree request');reads.push(args.height);
      const original=await base.getTreeState({height,...(args.signal?{signal:args.signal}:{})});sourceId=original.sourceId;
      return {...original,point:{height:args.height,hash:hash(args.height)},encoded:codec.encodeTreeState(JSON.stringify({...nativeTree,height:String(args.height),hash:hash(args.height)}))};
    },
    async *streamAddressTransactions(args){
      if(!active){yield*base.streamAddressTransactions(args);return;}
      check(args.address===fundingAddress||data.unspentAddresses.includes(args.address),'known native fork address');
      // This fixture account has no history before its one native funding transaction.
      // LightClient ranges are inclusive; enhancement lowers native endExclusive by one.
      check(Number.isInteger(args.fromHeight)&&Number.isInteger(args.toHeight)&&args.fromHeight>=0&&args.toHeight>=args.fromHeight&&args.toHeight<=height+2,'bounded funding or empty suffix history');
      args.signal?.throwIfAborted();
      if(args.address===fundingAddress&&args.fromHeight<=height&&args.toHeight>=height){
        const transaction=await base.getTransaction({txid:data.txid,...(args.signal?{signal:args.signal}:{})});
        check(transaction&&transaction.txid===data.txid&&transaction.raw.length===fundingRaw.length&&transaction.raw.every((byte,index)=>byte===fundingRaw[index]),'preserve exact native funding transaction');
        yield transaction;
      }
    },
    async *streamCompactBlocks(args){
      if(!active){yield*base.streamCompactBlocks(args);return;}
      check(args.fromHeight>height&&args.toHeight<=height+2,'only empty successors replay');
      for(let h=args.fromHeight;h<=args.toHeight;h++){
        args.signal?.throwIfAborted();delivered.push({branch,height:h});
        const reverse=value=>hex(value).reverse();
        yield {point:{height:h,hash:hash(h)},previousHash:hash(h-1),sourceId,observedAt:new Date().toISOString(),encoded:blockBytes(h,reverse(hash(h)),reverse(hash(h-1)),treeSizes)};
      }
    }
  };
  await seed(name,hex(data.database));
  const configured={...options,light:source,storage:{...options.storage,...(options.storage.kind==='browser-opfs'?{name:options.storage.name+'-fork'}:{path:options.storage.path+'-fork'})},recovery:{mode:'offline'}};
  let wallet;
  try{
    wallet=await createWalletClient(configured);await wallet.sync({target:data.target});
    const utxos=await wallet.listUtxos({accountId:data.accountId});
    const funding=utxos.items.find(item=>item.txid===data.txid);check(funding?.address,'native funding address for bounded fork history');fundingAddress=funding.address;active=true;
    const first=await wallet.sync({target:{height:height+2,hash:hash(height+2)}});
    check(first.targetReached&&delivered.length===2,'public sync scans initial empty suffix');
    branch=1;reads.length=0;delivered.length=0;
    const replacement=await wallet.sync({target:{height:height+2,hash:hash(height+2)}});
    check(replacement.targetReached&&replacement.scan.scanComplete&&replacement.scan.revision!==first.scan.revision,'public fork completes native state transition');
    check(reads.includes(height+1)&&delivered.length===2&&delivered.every((row,index)=>row.branch===1&&row.height===height+index+1),'public fork finds ancestor and replays both replacement blocks');
    await wallet.close();wallet=undefined;wallet=await createWalletClient(configured);
    const reopened=await wallet.getSyncStatus();check(reopened.scan.maxScannedHeight===height+2&&reopened.scan.scanComplete,'fork scan state survives public reopen');
    delivered.length=0;const checked=await wallet.sync({target:{height:height+2,hash:hash(height+2)}});
    check(checked.targetReached&&delivered.length===0,'reopened native hashes match replacement without replay');
    const balance=await wallet.getBalance({accountId:data.accountId});
    check(balance.amounts.transparent.regular.spendable===40000n&&balance.amounts.sapling.spendable===40000n,'empty fork preserves known native funding');
  }finally{await wallet?.close();}
}
