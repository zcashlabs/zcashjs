import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {initialize} from './wallet-support.mjs';
const bundle=process.argv[2], fixture=JSON.parse(fs.readFileSync(`${bundle}/tests/views-fixture.json`));
const show=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);
for(const k of ['parameters','genesis','priorTreeState'])fixture.import.birthday[k]=Uint8Array.from(fixture.import.birthday[k].match(/../g),b=>parseInt(b,16));
fixture.defaultAddress.index=BigInt(fixture.defaultAddress.index);
const root=fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/views-node-`);
function start(create=false,ownedRoot=root) {
  const worker=new Worker(pathToFileURL(`${bundle}/tests/wallet-views-worker.mjs`),{workerData:{root:ownedRoot,create},trackUnmanagedFds:true});
  let token,stopped=false; worker.on('exit',()=>{stopped=true;});
  return {
    async call(op,args={},override={}) {
      return new Promise((resolve,reject)=>{
        const done=(e,v)=>{clearTimeout(timer);worker.off('message',message);worker.off('error',error);worker.off('exit',exit);e?reject(e):resolve(v);};
        const timer=setTimeout(()=>{void worker.terminate();done(Error('deadline'));},30000);
        const message=v=>{if(v.ok&&v.instance)token=v;done(null,v);},error=e=>done(e),exit=n=>done(Error(`unexpected worker exit ${n}`));
        worker.once('message',message);worker.once('error',error);worker.once('exit',exit);
        worker.postMessage(op==='initialize'?{...initialize(),...override}:{op,args,generation:token?.generation,instance:token?.instance,...override});
      });
    },
    async destroy(){let timer;try{await Promise.race([worker.terminate(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('destruction deadline')),5000);})]);}finally{clearTimeout(timer);}assert.ok(stopped,'worker exit observed');},
  };
}
async function completeCreation(owner) {
  const target={height:99,hash:'07'.repeat(32)};
  const plan=await owner.call('scan_plan',{target});assert.equal(plan.ok,true,show(plan));
  const completed=await owner.call('scan_complete',{revision:plan.result.revision,target,treeState:fixture.import.birthday.priorTreeState});
  assert.equal(completed.ok,true,show(completed));
}
let owner=start(true), account,list,token,initialRevision;
const policyAccounts=[];
try {
  token=await owner.call('initialize');assert.equal(token.ok,true,show(token));
  const imported=await owner.call('account_import',fixture.import);assert.equal(imported.ok,true,show(imported));account=imported.result;
  assert.equal(account.viewOnly,false);assert.equal(account.signerAttached,false);
  for(const input of fixture.policyImports) {
    for(const k of ['parameters','genesis','priorTreeState'])input.birthday[k]=Uint8Array.from(input.birthday[k].match(/../g),b=>parseInt(b,16));
    const result=await owner.call('account_import',input);assert.equal(result.ok,true,show(result));
    assert.equal(result.result.viewOnly,input.viewOnly);assert.equal(result.result.signerAttached,false);policyAccounts.push(result.result);
  }

  const args={accountId:account.id};
  const unavailable=await owner.call('account_balance',{...args,confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:true}});
  assert.equal(unavailable.ok,true,show(unavailable));assert.equal(unavailable.result.accountId,account.id);assert.equal(unavailable.result.amounts,null);assert.equal(unavailable.writes,0);
  initialRevision=unavailable.result.scan.revision;assert.match(initialRevision,/^[0-9a-f]{32}:[0-9]+$/);
  assert.deepEqual(unavailable.result.scan,{revision:initialRevision,tipHeight:99,fullyScannedHeight:null,maxScannedHeight:null,scanComplete:null});
  const initial=await owner.call('address_list',args);assert.deepEqual(initial.result,[fixture.defaultAddress]);
  assert.equal((await owner.call('address_current',args)).result,fixture.defaultAddress.address);
  const next=await owner.call('address_next',args);assert.equal(next.ok,true,show(next));
  assert.notEqual(next.result.address,fixture.defaultAddress.address);
  const high=await owner.call('address_at',{...args,index:309485009821345068724781055n,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}});
  assert.equal(high.ok,true,show(high));assert.equal(high.result.index,309485009821345068724781055n);
  const transparent=await owner.call('address_next',{...args,request:{format:'transparent'}});assert.equal(transparent.ok,true,show(transparent));assert.deepEqual(transparent.result.receiverTypes,['p2pkh']);
  list=(await owner.call('address_list',args)).result;
  const aborted=await owner.call('address_next',args,{abort:'before'});assert.equal(aborted.error,'ABORTED');assert.equal(aborted.commit,'none');
  assert.deepEqual((await owner.call('address_list',args)).result,list);
  const failed=await owner.call('address_next',args,{fault:'quota'});assert.equal(failed.ok,false);
  assert.deepEqual((await owner.call('address_list',args)).result,list,'failed write no consumed address');
  const commitFailure=await owner.call('address_at',{...args,index:309485009821345068724781054n,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}},{fault:'commit'});assert.equal(commitFailure.ok,false);
  assert.deepEqual((await owner.call('address_list',args)).result,list,'failed commit sync no exposure');
  const post=await owner.call('address_next',args,{abort:'duringSync'});assert.equal(post.error,'ABORTED');assert.equal(post.commit,'committed');
  const after=(await owner.call('address_list',args)).result;assert.equal(after.length,list.length+1);list=after;
  assert.equal((await owner.call('account_import',{...fixture.import,viewingKey:fixture.uivk})).error,'INCOMING_ONLY_WALLET_UNSUPPORTED');
  assert.equal((await owner.call('account_list',{}, {generation:token.generation+1})).error,'STALE_HANDLE');
  assert.equal((await owner.call('account_list',{}, {instance:'wrong'})).error,'WRONG_INSTANCE');
  assert.equal((await owner.call('close')).ok,true);
  assert.equal((await owner.call('account_list')).error,'STALE_HANDLE');
}finally{await owner.destroy();}
owner=start();
try {
  assert.equal((await owner.call('initialize')).ok,true);
  assert.deepEqual((await owner.call('account_list')).result.map(a=>a.id).sort(),[account,...policyAccounts].map(a=>a.id).sort());
  for(const a of policyAccounts)assert.deepEqual((await owner.call('account_get',{accountId:a.id})).result,a);
  assert.deepEqual((await owner.call('address_list',{accountId:account.id})).result,list);
  const reopenedBalance=await owner.call('account_balance',{accountId:account.id,confirmations:{trusted:1,untrusted:1,allowZeroConfirmationShielding:true}});
  assert.equal(reopenedBalance.ok,true,show(reopenedBalance));assert.equal(reopenedBalance.result.amounts,null);
  assert.match(reopenedBalance.result.scan.revision,/^[0-9a-f]{32}:0$/);
  assert.notEqual(reopenedBalance.result.scan.revision.split(':')[0],initialRevision.split(':')[0]);
  assert.equal((await owner.call('account_list',{}, {instance:token.instance})).error,'WRONG_INSTANCE');
  assert.equal((await owner.call('close')).ok,true);
}finally{await owner.destroy();}
console.log(show({pass:true,case:'actual FS account UUID/address close/destroy/reopen; instance/generation',root}));

const entropyRoot=fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/views-entropy-`);
owner=start(true,entropyRoot);
try {
  assert.equal((await owner.call('initialize')).ok,true);
  assert.equal((await owner.call('account_import',fixture.import,{fault:'entropy'})).error,'DOMAIN_INVALID');
  assert.equal((await owner.call('account_list')).error,'DOMAIN_INVALID');
}finally{await owner.destroy();}
owner=start(false,entropyRoot);
try{assert.equal((await owner.call('initialize')).ok,true);assert.deepEqual((await owner.call('account_list')).result,[]);assert.equal((await owner.call('close')).ok,true);}
finally{await owner.destroy();}
console.log(JSON.stringify({pass:true,case:'entropy trap invalidates owner; destroyed owner reopens with no imported account',root:entropyRoot}));

for(const seedLength of [32,64]) {
const hdRoot=fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/views-hd-`);
const seed=new Uint8Array(seedLength).fill(40), hdInput={birthday:fixture.import.birthday,accountIndex:0,name:'private HD'};
let hdAccount,hdAddresses,hdGap,hdPost;
owner=start(true,hdRoot);
try {
  const opened=await owner.call('initialize');assert.equal(opened.ok,true);
  assert.equal((await owner.call('account_import_hd',hdInput,{seed,abort:'before'})).commit,'none');
  assert.deepEqual((await owner.call('account_list')).result,[]);
  for(const invalid of [...[0,16,31,33,48,63,65,252,253].map(n=>new Uint8Array(n).fill(42)),[1,2,3]]) {
    const saved=invalid.slice();
    for(const op of ['account_import_hd','account_create_hd']) {
      assert.equal((await owner.call(op,op==='account_import_hd'?hdInput:{birthday:hdInput.birthday},{seed:invalid})).error,'INVALID_ARGUMENT');
      assert.deepEqual(invalid,saved,'rejected caller bytes unchanged');
      assert.deepEqual((await owner.call('account_list')).result,[],'invalid seed leaves no account');
    }
  }
  assert.equal((await owner.call('account_import_hd',{...hdInput,enabledPools:['sapling']},{seed})).error,'UNSUPPORTED_HD_POOLS');
  assert.equal((await owner.call('account_import_hd',hdInput,{seed,instance:'wrong'})).error,'WRONG_INSTANCE');
  assert.equal((await owner.call('account_import_hd',hdInput,{seed,generation:opened.generation+1})).error,'STALE_HANDLE');
  const imported=await owner.call('account_import_hd',hdInput,{seed});assert.equal(imported.ok,true,show(imported));hdAccount=imported.result;
  assert.equal(hdAccount.accountIndex,0);assert.equal(hdAccount.signerAttached,false);assert.equal(hdAccount.viewOnly,false);
  assert.deepEqual(seed,new Uint8Array(seedLength).fill(40),'application-owned bytes unchanged');
  assert.equal((await owner.call('account_import_hd',hdInput,{seed})).error,'ACCOUNT_COLLISION');
  const gap=await owner.call('account_import_hd',{...hdInput,accountIndex:3,enabledPools:['ironwood','transparent','sapling']},{seed});assert.equal(gap.ok,true,show(gap));hdGap=gap.result;
  const args={accountId:hdAccount.id};
  assert.equal(typeof (await owner.call('address_current',args)).result,'string');
  assert.equal((await owner.call('address_next',args)).ok,true);
  assert.equal((await owner.call('address_at',{...args,index:309485009821345068724781055n,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}})).ok,true);
  hdAddresses=(await owner.call('address_list',args)).result;
  const before=(await owner.call('account_list')).result;
  await completeCreation(owner);
  const failed=await owner.call('account_create_hd',{},{seed,fault:'commit'});assert.equal(failed.ok,false);
  assert.deepEqual((await owner.call('account_list')).result,before,'failed native HD commit consumes no index/account');
  const post=await owner.call('account_create_hd',{},{seed,abort:'duringSync'});assert.equal(post.error,'ABORTED');assert.equal(post.commit,'committed');assert.equal('result' in post,false);
  hdPost=(await owner.call('account_list')).result.find(a=>a.accountIndex===4);assert.ok(hdPost);assert.equal(hdPost.signerAttached,false);
  assert.equal((await owner.call('close')).ok,true);
}finally{await owner.destroy();}
owner=start(false,hdRoot);
try {
  assert.equal((await owner.call('initialize')).ok,true);
  for(const account of [hdAccount,hdGap,hdPost])assert.deepEqual((await owner.call('account_get',{accountId:account.id})).result,account);
  assert.deepEqual((await owner.call('address_list',{accountId:hdAccount.id})).result,hdAddresses);
  const next=await owner.call('account_create_hd',{},{seed});assert.equal(next.ok,true,show(next));assert.equal(next.result.accountIndex,5);
  assert.equal((await owner.call('close')).ok,true);
}finally{await owner.destroy();}
for(const file of fs.readdirSync(hdRoot,{recursive:true})) {
  const path=`${hdRoot}/${file}`;if(!fs.statSync(path).isFile())continue;
  const bytes=fs.readFileSync(path);assert.equal(bytes.includes(Buffer.from(seed)),false,'synthetic seed absent from persisted files');assert.equal(bytes.includes(Buffer.from(seed).toString('hex')),false);
}
console.log(JSON.stringify({pass:true,case:'private HD explicit/gap/native next; commit rollback; abort semantics; all addresses; destroyed owner reopen; seed byte absence',root:hdRoot,seedLength}));
}

// Independent standard-library KDF oracle; synthetic inputs stay out of diagnostics.
const {pbkdf2Sync}=await import('node:crypto');
const {copyBytes}=await import('../bytes.mjs');
assert.equal(copyBytes(new Uint8Array(),65536,'INVALID_ARGUMENT',0).length,0);
assert.throws(()=>copyBytes(new Uint8Array(),65536,'INVALID_ARGUMENT'));
const encoder=new TextEncoder();
const mnemonicAddressRequest={format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'};
const phrase12='abandon '.repeat(11)+'about';
const vectors=[...[[12,'about'],[15,'address'],[18,'agent'],[21,'admit'],[24,'art']].map(([n,last])=>['abandon '.repeat(n-1)+last,'TREZOR']),
  [phrase12,undefined],[phrase12,''],[phrase12,'é'],[phrase12,'e\u0301'],[phrase12,'㍍ガバヴァぱばぐゞちぢ十人十色'],[phrase12,'TREZOR '],[phrase12,'TREZOR\0'],
  [phrase12.replace(/[a-z]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0)),'TREZOR'],['\u2003'+phrase12.replaceAll(' ','\u2003\t')+'\n','TREZOR']];
async function checkMnemonic(number,[phrase,pass]) {
  const mnemonic=encoder.encode(phrase),passphrase=pass===undefined?undefined:encoder.encode(pass);
  const canonical=phrase.normalize('NFKD').split(/\s+/u).filter(Boolean).join(' ');
  const seed=new Uint8Array(pbkdf2Sync(canonical,'mnemonic'+(pass??'').normalize('NFKD'),2048,64,'sha512'));
  const mnemonicRoot=fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/views-mnemonic-`);
  const oracleRoot=fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/views-oracle-`);
  const input={birthday:fixture.import.birthday,accountIndex:3};
  let owner,saved,addresses,nextIndex;
  owner=start(true,mnemonicRoot);
  try {
    const opened=await owner.call('initialize');assert.equal(opened.ok,true);
    const before=(await owner.call('account_list')).result;
    assert.equal((await owner.call('account_import_mnemonic',input,{mnemonic,passphrase,abort:'before'})).commit,'none');
    assert.deepEqual((await owner.call('account_list')).result,before);
    if(number===0) {
      for(const bad of [null,'',new Uint16Array(12),new DataView(new ArrayBuffer(12)),new Uint8Array(new SharedArrayBuffer(12)),new Uint8Array(),new Uint8Array([255]),encoder.encode('a'.repeat(4097)),encoder.encode('㍍'.repeat(1000))]) {
        if(bad instanceof Uint8Array && bad.buffer instanceof SharedArrayBuffer)bad.fill(77);
        const savedBad=bad instanceof Uint8Array?bad.slice():undefined;
        const rejected=await owner.call('account_import_mnemonic',input,{mnemonic:bad,passphrase});assert.equal(rejected.error,'INVALID_ARGUMENT');assert.equal(rejected.writes,0);
        if(savedBad)assert.ok(Buffer.from(bad).equals(Buffer.from(savedBad)),'rejected caller bytes preserved');
        assert.deepEqual((await owner.call('account_list')).result,before);
      }
      for(const bad of ['abandon '.repeat(12),'abandon '.repeat(11),'abandon '.repeat(13),'abandon '.repeat(25),'unknown '.repeat(12),phrase12.toUpperCase(),phrase12.replaceAll('abandon','aban'),'あいこくしん '.repeat(12)]) {
        const rejected=await owner.call('account_import_mnemonic',input,{mnemonic:encoder.encode(bad),passphrase});
        assert.equal(rejected.error,'INVALID_MNEMONIC');assert.equal(rejected.writes,0);
        assert.deepEqual((await owner.call('account_list')).result,before);
      }
      for(const bad of [null,'',new Uint16Array(),new Uint8Array([255]),new Uint8Array(65537),encoder.encode('㍍'.repeat(15000))]) {
        const rejected=await owner.call('account_import_mnemonic',input,{mnemonic,passphrase:bad});assert.equal(rejected.error,'INVALID_ARGUMENT');assert.equal(rejected.writes,0);
        assert.deepEqual((await owner.call('account_list')).result,before);
      }
      assert.equal((await owner.call('account_list',{}, {mnemonic})).error,'INVALID_ARGUMENT');
      assert.equal((await owner.call('account_import_mnemonic',input,{mnemonic,passphrase,seed})).error,'INVALID_ARGUMENT');
      assert.equal((await owner.call('account_import_mnemonic',input,{mnemonic,passphrase,instance:'wrong'})).error,'WRONG_INSTANCE');
      assert.equal((await owner.call('account_import_mnemonic',input,{mnemonic,passphrase,generation:opened.generation+1})).error,'STALE_HANDLE');
      assert.equal((await owner.call('account_import_mnemonic',input,{mnemonic,passphrase,fault:'commit'})).ok,false);
      assert.deepEqual((await owner.call('account_list')).result,before);
    }
    const result=await owner.call('account_import_mnemonic',input,{mnemonic,passphrase});assert.equal(result.ok,true,show(result));saved=result.result;
    assert.equal(saved.accountIndex,3);assert.equal(saved.signerAttached,false);
    assert.equal((await owner.call('account_import_hd',input,{seed})).error,'ACCOUNT_COLLISION');
    assert.equal((await owner.call('account_import_mnemonic',input,{mnemonic,passphrase})).error,'ACCOUNT_COLLISION');
    const args={accountId:saved.id};
    assert.equal(typeof (await owner.call('address_current',args)).result,'string');
    const next=await owner.call('address_next',{...args,request:mnemonicAddressRequest});assert.equal(next.ok,true);nextIndex=next.result.index;
    assert.equal((await owner.call('address_at',{...args,index:309485009821345068724781055n,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}})).ok,true);
    addresses=(await owner.call('address_list',args)).result;
    assert.equal((await owner.call('close')).ok,true);
    assert.equal((await owner.call('account_import_mnemonic',input,{mnemonic,passphrase})).error,'STALE_HANDLE');
  }finally{await owner.destroy();}
  owner=start(false,mnemonicRoot);
  try {
    assert.equal((await owner.call('initialize')).ok,true);
    assert.deepEqual((await owner.call('account_get',{accountId:saved.id})).result,saved);
    assert.deepEqual((await owner.call('address_list',{accountId:saved.id})).result,addresses);
    await completeCreation(owner);
    assert.equal((await owner.call('account_create_hd',{},{seed})).result.accountIndex,4);
    const post=await owner.call('account_import_mnemonic',{...input,accountIndex:5},{mnemonic,passphrase,abort:'duringSync'});
    assert.equal(post.error,'ABORTED');assert.equal(post.commit,'committed');
    assert.equal((await owner.call('account_list')).result.some(a=>a.accountIndex===5),true);
    assert.equal((await owner.call('close')).ok,true);
  }finally{await owner.destroy();}
  owner=start(true,oracleRoot);
  try {
    assert.equal((await owner.call('initialize')).ok,true);
    const result=await owner.call('account_import_hd',input,{seed});assert.equal(result.ok,true);
    const {id:ignore,...expected}=result.result,{id:ignored,...actual}=saved;assert.deepEqual(actual,expected);
    const args={accountId:result.result.id};
    // Shielded next allocation uses wall time; compare authority at the same native index.
    assert.equal((await owner.call('address_at',{...args,index:nextIndex,request:mnemonicAddressRequest})).ok,true);
    assert.equal((await owner.call('address_at',{...args,index:309485009821345068724781055n,request:{format:'unified',transparent:'omit',sapling:'omit',ironwood:'require'}})).ok,true);
    assert.deepEqual((await owner.call('address_list',args)).result,addresses);
    assert.equal((await owner.call('close')).ok,true);
  }finally{await owner.destroy();}
  assert.ok(Buffer.from(mnemonic).equals(Buffer.from(encoder.encode(phrase))),'caller mnemonic preserved');
  if(passphrase)assert.ok(Buffer.from(passphrase).equals(Buffer.from(encoder.encode(pass))),'caller passphrase preserved');
  for(const file of fs.readdirSync(mnemonicRoot,{recursive:true})) {
    const path=`${mnemonicRoot}/${file}`;if(!fs.statSync(path).isFile())continue;
    const bytes=fs.readFileSync(path);
    for(const secret of [Buffer.from(mnemonic),Buffer.from(phrase.normalize('NFKD')),Buffer.from(seed),Buffer.from(seed).toString('hex')])assert.equal(bytes.includes(secret),false,'synthetic authority absent from files');
  }
  console.log(JSON.stringify({pass:true,case:'mnemonic independent KDF/native authority/address/reopen',vector:number,root:mnemonicRoot}));
}
// Two isolated wallets at a time; settle both cases so destruction finishes on failure.
for(let first=0;first<vectors.length;first+=2) {
  const results=await Promise.allSettled(vectors.slice(first,first+2).map((vector,offset)=>checkMnemonic(first+offset,vector)));
  for(const result of results)if(result.status==='rejected')throw result.reason;
}

// The native scanner emits populated databases plus getter truth into the existing fixture.
for(const scenario of ['coinbase-before-maturity','coinbase-at-maturity'])
  assert.ok(fixture.balanceCases.some(test=>test.scenario===scenario),'scanned maturity fixture required: '+scenario);
for(const [index,test] of fixture.balanceCases.entries()) {
  const balanceRoot=fs.mkdtempSync(`${process.env.WALLET_TEST_ROOT}/views-balance-`);
  fs.writeFileSync(`${balanceRoot}/wallet.db`,Buffer.from(test.database,'hex'),{mode:0o600});
  let oldToken,previousRevision;
  const liftAmounts=v=>typeof v==='string'&&/^[0-9]+$/.test(v)?BigInt(v):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,liftAmounts(x)])):v;
  for(let reopen=0;reopen<2;reopen++) {
    const balanceOwner=start(false,balanceRoot);
    try {
      const opened=await balanceOwner.call('initialize');assert.equal(opened.ok,true,show(opened));
      const before=fs.readFileSync(`${balanceRoot}/wallet.db`);
      let revision;
      for(const {args,expected,scan} of test.queries) {
        const saved=structuredClone(args);
        const result=await balanceOwner.call('account_balance',args);
        assert.equal(result.ok,true,show(result));assert.equal(result.writes,0);
        assert.match(result.result.scan.revision,/^[0-9a-f]{32}:0$/);
        if(revision)assert.equal(result.result.scan.revision,revision,'reads retain one revision');
        revision=result.result.scan.revision;
        assert.deepEqual(result.result,{accountId:expected.accountId,amounts:liftAmounts(expected.amounts),scan:{...scan,revision}});
        assert.deepEqual(args,saved,'caller policy unchanged');
        const pre=await balanceOwner.call('account_balance',args,{abort:'before'});
        assert.equal(pre.error,'ABORTED');assert.equal(pre.commit,'none');assert.equal(pre.writes,0);assert.equal(pre.reads,0);
        assert.equal((await balanceOwner.call('account_balance',args,{instance:'wrong'})).error,'WRONG_INSTANCE');
        assert.equal((await balanceOwner.call('account_balance',args,{generation:opened.generation+1})).error,'STALE_HANDLE');
        if(oldToken)assert.equal((await balanceOwner.call('account_balance',args,{instance:oldToken.instance})).error,'WRONG_INSTANCE');
        for(const confirmations of [undefined,null,{}, {...args.confirmations,trusted:0},{...args.confirmations,untrusted:4294967296},{...args.confirmations,trusted:2,untrusted:1},{...args.confirmations,allowZeroConfirmationShielding:1}]) {
          const invalid={accountId:args.accountId,...(confirmations===undefined?{}:{confirmations})};
          const rejected=await balanceOwner.call('account_balance',invalid);
          assert.equal(rejected.error,'INVALID_ARGUMENT');assert.equal(rejected.writes,0);
        }
      }
      const unknown=await balanceOwner.call('account_balance',{...test.queries[0].args,accountId:'00000000-0000-0000-0000-000000000000'});
      assert.equal(unknown.error,'ACCOUNT_NOT_FOUND');assert.equal(unknown.writes,0);
      assert.deepEqual(fs.readFileSync(`${balanceRoot}/wallet.db`),before);
      if(previousRevision)assert.notEqual(revision.split(':')[0],previousRevision.split(':')[0],'new owner persists fresh epoch');
      previousRevision=revision;
      assert.equal((await balanceOwner.call('close')).ok,true);
      assert.equal((await balanceOwner.call('account_balance',test.queries[0].args)).error,'STALE_HANDLE');
      oldToken=opened;
    }finally{await balanceOwner.destroy();}
  }
  console.log(show({pass:true,case:'native balance truth through generated WASM; no writes; policy; abort; destruction/reopen',index,scenario:test.scenario??(test.locked?'locked':'purpose'),queries:test.queries.length,root:balanceRoot}));
}
