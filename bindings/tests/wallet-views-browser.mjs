// Ordinary page-owned module; WebDriver only observes this test.
const active = new Set(), results = [];
const diagnostics = [], ownedScripts = [];
const root = `private-views-test-${crypto.randomUUID()}`;
const parameters = new TextEncoder().encode('{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}');
const initialize = create => ({ op: 'initialize', root, create, format: 'zcash-js-network/1', parameters, genesis: new Uint8Array(32).fill(3) });
function check(value, message) { if (!value) throw Error(message); }
async function observe(body) {
  const response = await fetch('/lifecycle', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw Error(JSON.stringify(data));
  return data;
}
function start() {
  const token = crypto.randomUUID();
  const script = `/tests/wallet-views-worker.mjs?owner=${token}`;
  ownedScripts.push(script);
  diagnostics.push({script,phase:'constructed',pageMs:performance.now()});
  const worker = new Worker(script, { type: 'module' }); active.add(worker);
  let error, instance, sequence=0, cancelPending;
  worker.addEventListener('error', e => { error = Error(`${e.message} (${e.filename}:${e.lineno}:${e.colno})`); diagnostics.push({script,phase:'page-worker-error',message:error.message,pageMs:performance.now()}); });
  worker.addEventListener('message', e => { if(e.data.diagnostic)diagnostics.push({script,pageMs:performance.now(),...e.data.diagnostic}); });
  return {
    async call(request) {
      if (error) throw error;
      if(cancelPending)throw Error('worker request already pending');
      const id=++sequence;
      return new Promise((resolve, reject) => {
        const done = (error, value) => {
          cancelPending=undefined;
          clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', failed);
          error ? reject(error) : resolve(value);
        };
        const timer = setTimeout(() => { error=Error(`worker deadline: ${request.op}; last phase=${diagnostics.filter(d=>d.script===script).at(-1)?.phase}`); worker.terminate(); done(error); }, 30000);
        const message = e => {
          if(e.data.diagnostic) { if(['module-error','worker-error','unhandled-rejection'].includes(e.data.diagnostic.phase))done(Error(JSON.stringify(e.data.diagnostic))); return; }
          if(e.data.id!==id)return;
          if (e.data.ok && e.data.instance) instance = e.data.instance; done(null, e.data);
        };
        const failed = e => done(Error(e.message));
        cancelPending=()=>done(Error('worker terminated during request'));
        diagnostics.push({script,id,phase:`post:${request.op}`,pageMs:performance.now()});
        worker.addEventListener('message', message); worker.addEventListener('error', failed); worker.postMessage({ ...('instance' in request ? request : { ...request, instance }), id });
      });
    },
    async destroy() {
      error=Error('worker terminated');cancelPending?.();
      const creation = await observe({ script, state: 'created' });
      worker.terminate();
      const destruction = await observe({ script, state: 'destroyed', realm: creation.realm });
      active.delete(worker); results.push(destruction);
    },
  };
}
let outcome;
try {
  const first = start();
  const opened = await first.call(initialize(true));
  check(opened.ok, JSON.stringify(opened));
  check(opened.secure, 'secure dedicated OPFS worker');
  const fixture=await (await fetch('/tests/views-fixture.json')).json();
  const input=fixture.import;
  for(const k of ['parameters','genesis','priorTreeState'])input.birthday[k]=Uint8Array.from(input.birthday[k].match(/../g),b=>parseInt(b,16));
  const imported=await first.call({op:'account_import',generation:opened.generation,args:input});check(imported.ok,JSON.stringify(imported));
  const account=imported.result, args={accountId:account.id};
  const balanceArgs={...args,confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:true}};
  const balanceRequest={op:'account_balance',generation:opened.generation,args:balanceArgs};
  const balance=await first.call(balanceRequest);
  check(balance.ok&&balance.result.accountId===account.id&&balance.result.amounts===null&&balance.writes===0,'unavailable native balance is null without writes');
  check(Object.keys(balance.result).sort().join() === 'accountId,amounts,scan','native balance includes scan snapshot');
  check(/^[0-9a-f]{32}:[0-9]+$/.test(balance.result.scan.revision),'native revision shape');
  check(balance.result.scan.tipHeight===99&&balance.result.scan.fullyScannedHeight===null&&balance.result.scan.maxScannedHeight===null&&balance.result.scan.scanComplete===null,'native checkpoint tip and unknown scan coverage');
  const balanceAbort=await first.call({...balanceRequest,abort:'before'});
  check(balanceAbort.error==='ABORTED'&&balanceAbort.commit==='none'&&balanceAbort.writes===0,'balance preabort no writes');
  check((await first.call({...balanceRequest,instance:'wrong'})).error==='WRONG_INSTANCE','balance wrong instance');
  check((await first.call({...balanceRequest,generation:opened.generation+1})).error==='STALE_HANDLE','balance stale generation');
  check((await first.call({...balanceRequest,args:{...balanceArgs,accountId:'00000000-0000-0000-0000-000000000000'}})).error==='ACCOUNT_NOT_FOUND','balance unknown account');
  const policyAccounts=[];
  for(const input of fixture.policyImports) {
    for(const k of ['parameters','genesis','priorTreeState'])input.birthday[k]=Uint8Array.from(input.birthday[k].match(/../g),b=>parseInt(b,16));
    const result=await first.call({op:'account_import',generation:opened.generation,args:input});
    check(result.ok && result.result.viewOnly===input.viewOnly && !result.result.signerAttached,'explicit native import policy');policyAccounts.push(result.result);
  }

  const listed=await first.call({op:'address_list',generation:opened.generation,args});check(listed.ok && listed.result[0].address===fixture.defaultAddress.address,'native default address');
  const allocated=await first.call({op:'address_next',generation:opened.generation,args});check(allocated.ok,JSON.stringify(allocated,(_,v)=>typeof v==='bigint'?v.toString():v));
  const exact=await first.call({op:'address_at',generation:opened.generation,args:{...args,index:309485009821345068724781055n,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}}});check(exact.ok && exact.result.index===309485009821345068724781055n,'88 bit exact index');
  const transparent=await first.call({op:'address_next',generation:opened.generation,args:{...args,request:{format:'transparent'}}});check(transparent.ok && transparent.result.receiverTypes.join()==='p2pkh','transparent only');
  const records=(await first.call({op:'address_list',generation:opened.generation,args})).result;
  const encode=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);
  results.push({case:'account import and unified/transparent address allocation',accountId:account.id,addresses:records.length});
  const hdBefore=(await first.call({op:'account_list',generation:opened.generation})).result;
  for(const length of [0,16,31,33,48,63,65,252,253]) {
    const seed=new Uint8Array(length).fill(42);
    for(const op of ['account_import_hd','account_create_hd']) {
      const args={birthday:input.birthday,...(op==='account_import_hd'?{accountIndex:3}:{})};
      const rejected=await first.call({op,generation:opened.generation,args,seed});
      check(rejected.error==='INVALID_ARGUMENT','invalid HD seed length '+length);
      check(seed.every(b=>b===42),'rejected caller seed unchanged');
      check(encode((await first.call({op:'account_list',generation:opened.generation})).result)===encode(hdBefore),'invalid HD seed leaves accounts unchanged');
    }
  }
  const hdSeeds=[32,64].map(n=>new Uint8Array(n).fill(40)), hdCases=[];
  for(const hdSeed of hdSeeds) {
  const hd=await first.call({op:'account_import_hd',generation:opened.generation,args:{birthday:input.birthday,accountIndex:3,name:'private HD'},seed:hdSeed});
  check(hd.ok&&hd.result.accountIndex===3&&!hd.result.signerAttached,'native HD explicit provenance');
  const hdArgs={accountId:hd.result.id};
  const hdAddress=await first.call({op:'address_next',generation:opened.generation,args:hdArgs});check(hdAddress.ok,'HD address exposure');
  const hdRecords=(await first.call({op:'address_list',generation:opened.generation,args:hdArgs})).result;
  check(hdSeed.every(b=>b===40),'accepted caller seed unchanged');
  hdCases.push({hdSeed,hd,hdArgs,hdRecords});
  }
  const mnemonicCases=[];
  const phrase12='abandon '.repeat(11)+'about',encoder=new TextEncoder();
  const mnemonicVectors=[...[[12,'about'],[15,'address'],[18,'agent'],[21,'admit'],[24,'art']].map(([n,last])=>['abandon '.repeat(n-1)+last,'TREZOR']),[phrase12,''],[phrase12,'é'],[phrase12,'㍍ガバヴァぱばぐゞちぢ十人十色']];
  for(const [phrase,pass] of mnemonicVectors) {
    const mnemonic=encoder.encode(phrase),passphrase=encoder.encode(pass);
    const material=await crypto.subtle.importKey('raw',encoder.encode(phrase.normalize('NFKD')),'PBKDF2',false,['deriveBits']);
    const seed=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-512',iterations:2048,salt:encoder.encode('mnemonic'+pass.normalize('NFKD'))},material,512));
    const request={op:'account_import_mnemonic',generation:opened.generation,args:{birthday:input.birthday,accountIndex:3},mnemonic,passphrase};
    const before=(await first.call({op:'account_list',generation:opened.generation})).result;
    const pre=await first.call({...request,abort:'before'});check(pre.error==='ABORTED'&&pre.commit==='none','mnemonic preabort');
    check(encode((await first.call({op:'account_list',generation:opened.generation})).result)===encode(before),'mnemonic preabort no write');
    check((await first.call({...request,instance:'wrong'})).error==='WRONG_INSTANCE','mnemonic instance');
    check((await first.call({...request,generation:opened.generation+1})).error==='STALE_HANDLE','mnemonic generation');
    const failed=await first.call({...request,fault:'commit'});check(!failed.ok,'mnemonic commit failure');
    check(encode((await first.call({op:'account_list',generation:opened.generation})).result)===encode(before),'mnemonic rollback');
    const recovered=await first.call(request);check(recovered.ok&&recovered.result.accountIndex===3&&!recovered.result.signerAttached,'mnemonic recovery');
    check((await first.call({op:'account_import_hd',generation:opened.generation,args:request.args,seed})).error==='ACCOUNT_COLLISION','browser independent KDF authority');
    const args={accountId:recovered.result.id};
    check((await first.call({...request})).error==='ACCOUNT_COLLISION','mnemonic duplicate');
    if(pass==='')check((await first.call({...request,passphrase:undefined})).error==='ACCOUNT_COLLISION','omitted equals empty');
    if(pass==='é')check((await first.call({...request,passphrase:encoder.encode('e\u0301')})).error==='ACCOUNT_COLLISION','NFKD passphrase');
    if(phrase===phrase12&&pass==='TREZOR')check((await first.call({...request,mnemonic:encoder.encode(phrase.replace(/[a-z]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0)))})).error==='ACCOUNT_COLLISION','NFKD mnemonic');
    check(typeof (await first.call({op:'address_current',generation:opened.generation,args})).result==='string','mnemonic current');
    check((await first.call({op:'address_next',generation:opened.generation,args:{...args,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}}})).ok,'mnemonic next');
    check((await first.call({op:'address_at',generation:opened.generation,args:{...args,index:309485009821345068724781055n,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}}})).ok,'mnemonic at');
    const records=(await first.call({op:'address_list',generation:opened.generation,args})).result;
    check(mnemonic.every((b,i)=>b===encoder.encode(phrase)[i])&&passphrase.every((b,i)=>b===encoder.encode(pass)[i]),'mnemonic caller bytes');
    mnemonicCases.push({request,account:recovered.result,args,records,seed});
  }
  const contender = start();
  const busy = await contender.call(initialize(false));
  check(!busy.ok && busy.error === 'STORAGE_BUSY', `contention: ${JSON.stringify(busy)}`);
  await contender.destroy();
  const creationTarget={height:99,hash:'07'.repeat(32)};
  const creationPlan=await first.call({op:'scan_plan',generation:opened.generation,args:{target:creationTarget}});
  check(creationPlan.ok,'explicit creation target');
  const completed=await first.call({op:'scan_complete',generation:opened.generation,args:{revision:creationPlan.result.revision,target:creationTarget,treeState:input.birthday.priorTreeState}});
  check(completed.ok,'explicit creation tree snapshot');
  check((await first.call({ op: 'close', generation: opened.generation })).ok, 'close');
  check(!(await first.call({ op: 'account_list', generation: opened.generation })).ok, 'stale operation');
  check((await first.call(balanceRequest)).error==='STALE_HANDLE','balance after close');
  await first.destroy();
  // No replacement until the server observed the original BiDi realm destroyed.
  const wrong = start(), wrongRequest = initialize(false); wrongRequest.genesis[0] = 4;
  check((await wrong.call(wrongRequest)).error === 'NETWORK_MISMATCH', 'wrong network');
  await wrong.destroy();
  const reopened = start();
  const again = await reopened.call(initialize(false)); check(again.ok, JSON.stringify(again));
  const balanceAgain=await reopened.call({...balanceRequest,generation:again.generation});
  check(balanceAgain.ok&&balanceAgain.result.accountId===account.id&&balanceAgain.result.amounts===null&&balanceAgain.writes===0,'balance survives OPFS destruction/reopen');
  check(/^[0-9a-f]{32}:0$/.test(balanceAgain.result.scan.revision)&&balanceAgain.result.scan.revision.split(':')[0]!==balance.result.scan.revision.split(':')[0],'reopen persists fresh native epoch');
  check((await reopened.call({...balanceRequest,generation:again.generation,instance:opened.instance})).error==='WRONG_INSTANCE','balance old owner after reopen');
  results.push({case:'private native balance OPFS read/preabort/close/destruction/reopen',accountId:account.id});
  const stored=await reopened.call({op:'account_get',generation:again.generation,args:{accountId:account.id}});check(stored.ok&&encode(stored.result)===encode(account),'persistent UUID/account');
  for(const a of policyAccounts) {
    const result=await reopened.call({op:'account_get',generation:again.generation,args:{accountId:a.id}});
    check(result.ok && encode(result.result)===encode(a),'explicit import policy survives OPFS reopen');
  }
  const addresses=await reopened.call({op:'address_list',generation:again.generation,args});check(addresses.ok&&encode(addresses.result)===encode(records),'persistent verified address list');
  check((await reopened.call({op:'account_list',generation:again.generation,instance:opened.instance})).error==='WRONG_INSTANCE','cross-worker handle');
  results.push({case:'same DB account/address after observed destruction',accountId:account.id,addresses:addresses.result.length});
  for(const {hdSeed,hd,hdArgs,hdRecords} of hdCases) {
  const storedHd=await reopened.call({op:'account_get',generation:again.generation,args:hdArgs});
  check(storedHd.ok&&encode(storedHd.result)===encode(hd.result),'HD UUID/index/name/birthday survives OPFS owner destruction');
  const storedHdAddresses=await reopened.call({op:'address_list',generation:again.generation,args:hdArgs});
  check(storedHdAddresses.ok&&encode(storedHdAddresses.result)===encode(hdRecords),'HD addresses survive OPFS reopen');
  const hdNext=await reopened.call({op:'account_create_hd',generation:again.generation,args:{},seed:hdSeed});
  check(hdNext.ok&&hdNext.result.accountIndex===4&&!hdNext.result.signerAttached,'native HD next index after OPFS reopen');
  results.push({case:'private native HD OPFS import/address/destruction/reopen/next',accountId:hd.result.id,index:hd.result.accountIndex,seedLength:hdSeed.length});
  check(hdSeed.every(b=>b===40),'reopened caller seed unchanged');
  }
  for(const {request,account,args,records,seed} of mnemonicCases) {
    check(encode((await reopened.call({op:'account_get',generation:again.generation,args})).result)===encode(account),'mnemonic persistent account');
    check(encode((await reopened.call({op:'address_list',generation:again.generation,args})).result)===encode(records),'mnemonic persistent addresses');
    const next=await reopened.call({op:'account_create_hd',generation:again.generation,args:{},seed});
    check(next.ok&&next.result.accountIndex===4,'mnemonic native next index after OPFS reopen');
    const post=await reopened.call({...request,generation:again.generation,args:{...request.args,accountIndex:5},abort:'duringSync'});
    check(post.error==='ABORTED'&&post.commit==='committed','mnemonic committed abort');
  }
  results.push({case:'mnemonic all counts/NFKD/empty/rollback/abort/OPFS destruction/reopen',cases:mnemonicCases.length});
  check((await reopened.call({ op: 'close', generation: again.generation })).ok, 'reopened close');
  await reopened.destroy();
  // Reuse native scanner databases and the original observed worker lifecycle.
  const liftAmounts=v=>typeof v==='string'&&/^[0-9]+$/.test(v)?BigInt(v):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,liftAmounts(x)])):v;
  const exactBalance=(actual,expected,label)=> {
    if(expected&&typeof expected==='object') {
      check(actual&&typeof actual==='object'&&Object.keys(actual).sort().join()===Object.keys(expected).sort().join(),label+' keys');
      for(const key of Object.keys(expected))exactBalance(actual[key],expected[key],label+'.'+key);
    } else check(actual===expected,label+' value/type');
  };
  check(fixture.balanceCases.length>=4,'populated native fixtures required');
  for(const scenario of ['coinbase-before-maturity','coinbase-at-maturity'])
    check(fixture.balanceCases.some(test=>test.scenario===scenario),'scanned maturity fixture required: '+scenario);
  for(const [index,test] of fixture.balanceCases.entries()) {
    const balanceRoot=`${root}-balance-${index}`;
    let oldToken, previousRevision;
    for(let reopen=0;reopen<2;reopen++) {
      const owner=start();
      const opened=await owner.call({...initialize(reopen===0),root:balanceRoot,...(reopen===0?{database:Uint8Array.from(test.database.match(/../g),b=>parseInt(b,16))}:{})});
      check(opened.ok&&opened.secure,'populated OPFS initialize');
      const snapshot=await owner.call({op:'fixture_snapshot'});check(snapshot.ok,'fixture snapshot');
      const before=snapshot.result;
      // Opening writes a fresh epoch; query reads must still preserve all bytes below.
      let revision;
      for(const {args,expected,scan} of test.queries) {
        const saved=structuredClone(args),request={op:'account_balance',generation:opened.generation,args};
        const result=await owner.call(request);
        check(result.ok&&result.writes===0,'populated balance read without writes');
        check(/^[0-9a-f]{32}:0$/.test(result.result.scan.revision),'populated native revision shape');
        if(revision)check(result.result.scan.revision===revision,'reads retain one native revision');
        revision=result.result.scan.revision;
        exactBalance(result.result,{accountId:expected.accountId,amounts:liftAmounts(expected.amounts),scan:{...scan,revision}},'native balance and scan');
        exactBalance(args,saved,'caller policy');
        const pre=await owner.call({...request,abort:'before'});
        check(pre.error==='ABORTED'&&pre.commit==='none'&&pre.reads===0&&pre.writes===0,'populated preabort no IO');
        check((await owner.call({...request,instance:'wrong'})).error==='WRONG_INSTANCE','populated wrong owner');
        check((await owner.call({...request,generation:opened.generation+1})).error==='STALE_HANDLE','populated stale generation');
        if(oldToken)check((await owner.call({...request,instance:oldToken.instance})).error==='WRONG_INSTANCE','populated old owner');
        for(const confirmations of [null,{}, {...args.confirmations,trusted:0},{...args.confirmations,untrusted:4294967296},{...args.confirmations,trusted:2,untrusted:1},{...args.confirmations,allowZeroConfirmationShielding:1}]) {
          const rejected=await owner.call({...request,args:{accountId:args.accountId,confirmations}});
          check(rejected.error==='INVALID_ARGUMENT'&&rejected.writes===0,'populated invalid policy');
        }
      }
      const request={op:'account_balance',generation:opened.generation,args:test.queries[0].args};
      check((await owner.call({...request,args:{...request.args,accountId:'00000000-0000-0000-0000-000000000000'}})).error==='ACCOUNT_NOT_FOUND','populated unknown account');
      const after=await owner.call({op:'fixture_snapshot'});check(after.ok&&after.result.length===before.length&&after.result.every((b,i)=>b===before[i]),'balance queries preserve OPFS bytes');
      if(previousRevision)check(revision.split(':')[0]!==previousRevision.split(':')[0],'new owner persists fresh epoch');
      previousRevision=revision;
      check((await owner.call({op:'close',generation:opened.generation})).ok,'populated close');
      check((await owner.call(request)).error==='STALE_HANDLE','populated balance after close');
      oldToken=opened;
      await owner.destroy();
    }
    results.push({case:'native populated OPFS exact bigint/policy/purpose/abort/no mutation/destruction/reopen',index,scenario:test.scenario??(test.locked?'locked':'purpose'),queries:test.queries.length});
  }
  outcome = { pass: true, root, results, userAgent: navigator.userAgent, actualQuotaExhaustion: false, uaEviction: false };
} catch (e) { outcome = { pass: false, root, results, error: { name: e.name, message: e.message, stack: e.stack } }; }
finally { for (const worker of active) worker.terminate(); }
Object.assign(outcome,{diagnostics,ownedScripts});
document.querySelector('#result').textContent = JSON.stringify(outcome, null, 2);
await fetch('/result', { method: 'POST', body: JSON.stringify(outcome) });
