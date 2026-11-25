// Private worker-local account/address primitive. The enclosing host authenticates
// this packaged executable closure; this is not the public WalletClient factory.
import { initializeStorage } from './wallet.mjs';
import * as binding from './bindings.js';
import { copyBytes } from './bytes.mjs';
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const operations = new Set(['account_balance','account_import','account_import_hd','account_create_hd','account_import_mnemonic','account_import_mnemonic_signer','account_restore_mnemonic_signer','account_create_mnemonic_signer','account_list','account_get','address_current','address_next','address_list','address_at']);
const queries = new Set(['wallet_history','wallet_transaction','wallet_notes','wallet_utxos']);
const syncs = new Set(['scan_state','scan_block_hash','scan_rewind','scan_complete']);
const enhancements = new Set(['enhancement_requests','enhancement_apply']);
const proposals = new Set(['proposal_create','proposal_get','proposal_list','proposal_lookup_intent','payment_request_parse']);
const pczt = new Set(['fused_send','pczt_finalize','finalized_get','pczt_prove','pczt_build','pczt_get_artifact','pczt_import']);
const lifecycle = new Set(['account_remove','account_check_key','account_viewing_key']);
const payments = new Set(['payment_abandon','payment_get','payment_list','payment_reconcile','payment_observe','payment_attempt_begin','payment_attempt_finish','payment_recovery_position']);
const scans = new Set([...payments,...pczt,...lifecycle,...proposals,'scan_plan','scan_ingest_batch',...syncs,...enhancements,...queries]);
const writes = new Set(['payment_abandon','fused_send','payment_reconcile','payment_observe','payment_attempt_begin','payment_attempt_finish','payment_recovery_position','pczt_finalize','pczt_prove','pczt_import','pczt_build','account_remove','proposal_create','scan_plan','scan_ingest_batch','scan_rewind','scan_complete','enhancement_apply','account_import','account_import_hd','account_create_hd','account_import_mnemonic','account_import_mnemonic_signer','account_create_mnemonic_signer','address_next','address_at']);
function abort(signal, commit) {
  if (signal !== undefined && aborted.call(signal)) throw Object.assign(Error('ABORTED'), { commit });
}
function lower(value, name = '', depth = 0) {
  if (depth > 5) throw TypeError('INVALID_ARGUMENT');
  if (['parameters','genesis','priorTreeState'].includes(name)) {
    const bytes=copyBytes(value,name==='parameters'?256:name==='genesis'?32:65536,'INVALID_ARGUMENT');
    return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }
  if (name==='index') {
    if (typeof value!=='bigint'||value<0n||value>=(1n<<88n))throw TypeError('INVALID_ARGUMENT');
    return value.toString();
  }
  if(typeof value==='string'&&value.length>140000)throw TypeError('INVALID_ARGUMENT');
  if (value===null||typeof value==='boolean'||typeof value==='string') return value;
  if (typeof value==='number'&&Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) {if(name!=='enabledPools'||value.length<1||value.length>3)throw TypeError('INVALID_ARGUMENT');return value.map(v=>lower(v,'',depth+1));}
  if (!value||Object.getPrototypeOf(value)!==Object.prototype) throw TypeError('INVALID_ARGUMENT');
  const allowed=depth===0?['confirmations','accountIndex','accountId','viewingKey','birthday','name','viewOnly','enabledPools','request','index','signal']:name==='confirmations'?['trusted','untrusted','allowZeroConfirmationShielding']:name==='birthday'?['parameters','genesis','firstScanHeight','priorTreeState','recoverUntilExclusive','source']:name==='request'?['format','transparent','sapling','ironwood']:[];
  const result=Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key!=='string'||!allowed.includes(key))throw TypeError('INVALID_ARGUMENT');
    const property=Object.getOwnPropertyDescriptor(value,key);
    if (!property||!('value' in property))throw TypeError('INVALID_ARGUMENT');
    if (depth===0&&key==='signal')continue;
    result[key]=lower(property.value,key,depth+1);
  }
  return result;
}
// Scan protobufs are copied and hex encoded only; Rust owns their interpretation.
function scanFields(value, allowed) {
    if (!value || Object.getPrototypeOf(value)!==Object.prototype) throw TypeError('INVALID_ARGUMENT');
    const result=Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const property=Object.getOwnPropertyDescriptor(value,key);
      if (!allowed.includes(key)||!property||!('value' in property)) throw TypeError('INVALID_ARGUMENT');
      result[key]=property.value;
    }
    return result;
}
function scanHeight(value) {
  if (!Number.isInteger(value)||value<0||value>0xffffffff) throw TypeError('INVALID_ARGUMENT');
  return value;
}
function scanPoint(value) {
  const target=scanFields(value,['height','hash']);
  if (!Number.isInteger(target.height)||target.height<0||target.height>=0xffffffff) throw TypeError('INVALID_ARGUMENT');
  if (typeof target.hash!=='string'||! /^[0-9a-f]{64}$/.test(target.hash)) throw TypeError('INVALID_ARGUMENT');
  return target;
}
function scanHex(bytes) {
    const ascii=new Uint8Array(bytes.length*2);
    for(let i=0;i<bytes.length;i++) {
      const high=bytes[i]>>>4, low=bytes[i]&15;
      ascii[2*i]=high+(high<10?48:87);
      ascii[2*i+1]=low+(low<10?48:87);
    }
    return new TextDecoder().decode(ascii);
}
function lowerProposal(args, operation) {
  const input=scanFields(args,[...((operation==='proposal_create'||operation==='proposal_lookup_intent')?['revision','accountId','payments','amounts','policy','maxFee','kind','threshold','fromAddresses','idempotencyKey']:operation==='proposal_get'?['operationId']:operation==='payment_request_parse'?['uri']:['afterSequence','highWater','limit']),'signal']);delete input.signal;
  const text=(value,max)=>{if(typeof value!=='string'||value.length>max)throw TypeError('INVALID_ARGUMENT');return value;};
  if(operation==='payment_request_parse') {text(input.uri,8192);return input;}
  const decimal=value=>{text(value,20);if(!/^(0|[1-9][0-9]*)$/.test(value))throw TypeError('INVALID_ARGUMENT');return value;};
  const money=value=>{if(typeof value!=='bigint'||value<0n||value>2100000000000000n)throw TypeError('INVALID_ARGUMENT');return value.toString();};
  const list=(value,max,project,min=1)=>{
    if(!Array.isArray(value))throw TypeError('INVALID_ARGUMENT');
    const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
    if(!Number.isInteger(length)||length<min||length>max||Reflect.ownKeys(value).length!==length+1)throw TypeError('RESOURCE_LIMIT');
    return Array.from({length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!('value'in d))throw TypeError('INVALID_ARGUMENT');return project(d.value);});
  };
  if(operation==='proposal_get') {if(!/^[0-9a-f]{64}$/.test(text(input.operationId,64)))throw TypeError('INVALID_ARGUMENT');return input;}
  if(operation==='proposal_list') {decimal(input.afterSequence);if(Object.hasOwn(input,'highWater'))decimal(input.highWater);if(!Number.isInteger(input.limit)||input.limit<1||input.limit>200)throw TypeError('INVALID_ARGUMENT');return input;}
  if(operation==='proposal_create'||Object.hasOwn(input,'revision'))text(input.revision,128);
  if(operation==='proposal_lookup_intent'&&!Object.hasOwn(input,'idempotencyKey'))throw TypeError('INVALID_ARGUMENT');
  text(input.accountId,36);
  if(Object.hasOwn(input,'idempotencyKey')&&text(input.idempotencyKey,1024).length===0)throw TypeError('INVALID_ARGUMENT');
  if(input.kind==='shield') {
    if(Object.hasOwn(input,'payments')||Object.hasOwn(input,'amounts'))throw TypeError('INVALID_ARGUMENT');
    input.threshold=money(input.threshold);
    if(Object.hasOwn(input,'fromAddresses'))input.fromAddresses=list(input.fromAddresses,256,value=>text(value,2048),0);
  }else {
    if(Object.hasOwn(input,'kind')||Object.hasOwn(input,'threshold')||Object.hasOwn(input,'fromAddresses'))throw TypeError('INVALID_ARGUMENT');
    input.payments=typeof input.payments==='string'?text(input.payments,8192):list(input.payments,16,value=>{
    const payment=scanFields(value,['to','amount','memo']);text(payment.to,2048);payment.amount=money(payment.amount);
    if(Object.hasOwn(payment,'memo')&&payment.memo!==null)payment.memo=scanHex(copyBytes(payment.memo,512,'INVALID_ARGUMENT',0));
    return payment;
  });
    // Amounts for the URI's payments that omit one, keyed by ZIP-321 payment index.
    if(Object.hasOwn(input,'amounts')) {
      if(typeof input.payments!=='string')throw TypeError('INVALID_ARGUMENT');
      const amounts=scanFields(input.amounts,Reflect.ownKeys(Object(input.amounts)).filter(key=>typeof key==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(key)));
      if(Object.keys(amounts).length>16)throw TypeError('RESOURCE_LIMIT');
      for(const key of Object.keys(amounts))amounts[key]=money(amounts[key]);
      input.amounts=amounts;
    }
  }
  if(Object.hasOwn(input,'maxFee'))input.maxFee=money(input.maxFee);
  const policy=scanFields(input.policy,['spendPools','transparent','changePool','feeRule','confirmations','expiry','lockExpiryBlocks']);
  policy.spendPools=list(policy.spendPools,3,value=>text(value,16));
  for(const key of ['transparent','changePool','feeRule'])text(policy[key],32);
  policy.confirmations=scanFields(policy.confirmations,['trusted','untrusted','allowZeroConfirmationShielding']);
  scanHeight(policy.confirmations.trusted);scanHeight(policy.confirmations.untrusted);
  if(typeof policy.confirmations.allowZeroConfirmationShielding!=='boolean')throw TypeError('INVALID_ARGUMENT');
  policy.expiry=scanFields(policy.expiry,['kind','blocks']);text(policy.expiry.kind,16);
  if(Object.hasOwn(policy.expiry,'blocks'))scanHeight(policy.expiry.blocks);
  scanHeight(policy.lockExpiryBlocks);input.policy=policy;return input;
}
function lowerPayment(args, operation) {
  const keys={payment_abandon:['operationId'],payment_get:['operationId'],payment_list:['afterSequence','highWater','limit','accountId'],payment_reconcile:['operationId','wallTimeMs','policy'],payment_observe:['operationId','stepIndex','observation','wallTimeMs'],payment_attempt_begin:['operationId','stepIndex','sourceId','routeBinding','mode','origin','wallTimeMs','monotonicElapsedMs','observationSequence','policy','maximum'],payment_attempt_finish:['operationId','attemptId','outcome','txid','wallTimeMs','diagnosticCode'],payment_recovery_position:['afterSequence']}[operation];
  const input=scanFields(args,[...keys,'signal']);delete input.signal;
  const owned=(value,depth=0)=>{
    if(depth>3)throw TypeError('INVALID_ARGUMENT');
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='string'){if(value.length>256)throw TypeError('RESOURCE_LIMIT');return value;}
    if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value;
    if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw TypeError('INVALID_ARGUMENT');
    const keys=Reflect.ownKeys(value);if(keys.length>16)throw TypeError('RESOURCE_LIMIT');
    const result=Object.create(null);
    for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!d||!('value'in d))throw TypeError('INVALID_ARGUMENT');result[key]=owned(d.value,depth+1);}
    return result;
  };
  for(const key of Object.keys(input))input[key]=owned(input[key]);
  if(operation==='payment_attempt_begin'&&(!Number.isInteger(input.maximum)||input.maximum<1||input.maximum>2097152))throw TypeError('RESOURCE_LIMIT');
  return input;
}
function lowerScan(args, operation) {
  if(payments.has(operation))return lowerPayment(args,operation);
  if(pczt.has(operation)) {
    const keys=operation==='fused_send'?['operationId','proposalId','reviewCommitment','token','spend','output','maximum']:operation==='pczt_build'?['operationId','proposalId','reviewCommitment']:operation==='pczt_import'?['operationId','bytes','maximum']:(operation==='pczt_prove'||operation==='pczt_finalize')?['operationId','artifactId','spend','output','maximum']:operation==='finalized_get'?['operationId']:['operationId','artifactId'];
    const input=scanFields(args,[...keys,'signal']);delete input.signal;
    for(const key of keys)if(!['bytes','maximum','spend','output','token'].includes(key)&&(key!=='artifactId'||operation!=='pczt_get_artifact'||Object.hasOwn(input,key))&&(typeof input[key]!=='string'||! /^[0-9a-f]{64}$/.test(input[key])))throw TypeError('INVALID_ARGUMENT');
    if(operation==='fused_send'||operation==='pczt_prove'||operation==='pczt_finalize') {
      if(!Number.isInteger(input.maximum)||input.maximum<1||input.maximum>4194304)throw TypeError('RESOURCE_LIMIT');
      for(const [key,size] of [['spend',47958396],['output',3592860]]) {
        let length;try{length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get.call(input[key]);}catch{throw TypeError('INVALID_ARGUMENT');}
        if(length!==0&&length!==size)throw TypeError('INVALID_ARGUMENT');
        input[key]=copyBytes(input[key],size,'INVALID_ARGUMENT',0);
      }
    }
    if(operation==='fused_send'&&(!Number.isInteger(input.token)||input.token<0||input.token>0xffffffff))throw TypeError('INVALID_ARGUMENT');
    if(operation==='pczt_import') {
      if(!Number.isInteger(input.maximum)||input.maximum<1||input.maximum>4194304)throw TypeError('RESOURCE_LIMIT');
      let length;try{length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get.call(input.bytes);}catch{throw TypeError('INVALID_PCZT');}
      if(length>input.maximum)throw TypeError('RESOURCE_LIMIT');
      input.bytes=copyBytes(input.bytes,input.maximum,'INVALID_PCZT');
    }
    return input;
  }
  if(lifecycle.has(operation)){
    const input=scanFields(args,operation==='account_remove'?['accountId','acknowledge','signal']:operation==='account_viewing_key'?['accountId','signal']:['accountId','viewingKey','signal']);
    delete input.signal;
    for(const value of Object.values(input))if(typeof value!=='string'||value.length>140000)throw TypeError('INVALID_ARGUMENT');
    return input;
  }
  if (proposals.has(operation)) return lowerProposal(args,operation);
  if (queries.has(operation)) {
    const inventory=operation==='wallet_notes'||operation==='wallet_utxos';
    const input=scanFields(args,inventory?['accountId','cursor','limit','spendState','locked','uneconomic','signal',...(operation==='wallet_notes'?['pool']:[])]:operation==='wallet_history'?['accountId','cursor','limit','signal']:['txid','signal']);delete input.signal;
    if(operation==='wallet_history'||inventory) {
      if(typeof input.accountId!=='string'||input.accountId.length!==36)throw TypeError('INVALID_ARGUMENT');
      if(Object.hasOwn(input,'cursor')&&(typeof input.cursor!=='string'||input.cursor.length>(inventory?2048:1024)))throw TypeError('INVALID_ARGUMENT');
      if(Object.hasOwn(input,'limit')&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>200))throw TypeError('INVALID_ARGUMENT');
    }else if(typeof input.txid!=='string'||! /^[0-9a-f]{64}$/.test(input.txid))throw TypeError('INVALID_ARGUMENT');
    if(inventory) {
      for(const key of ['locked','uneconomic'])if(Object.hasOwn(input,key)&&typeof input[key]!=='boolean')throw TypeError('INVALID_ARGUMENT');
      if(Object.hasOwn(input,'spendState')&&!['unspent','pendingSpend','spent','unknown'].includes(input.spendState))throw TypeError('INVALID_ARGUMENT');
      if(Object.hasOwn(input,'pool')&&!['sapling','ironwood'].includes(input.pool))throw TypeError('INVALID_ARGUMENT');
    }
    return input;
  }
  if (enhancements.has(operation)) return lowerEnhancement(args,operation);
  if (operation==='scan_complete') {
    const input=scanFields(args,['revision','target','treeState','signal']);delete input.signal;
    if(typeof input.revision!=='string'||input.revision.length>128)throw TypeError('INVALID_ARGUMENT');
    input.target=scanPoint(input.target);input.treeState=scanHex(copyBytes(input.treeState,65536,'RESOURCE_LIMIT'));
    return input;
  }
  const keys=operation==='scan_state'?[]:operation==='scan_block_hash'?['height']:operation==='scan_rewind'?['revision','requestedPoint']:
    operation==='scan_plan'?['target']:['target','revision','priorTreeState','blocks'];
  const input=scanFields(args,[...keys,'signal']);delete input.signal;
  if (operation==='scan_state') return input;
  if (operation==='scan_block_hash') {input.height=scanHeight(input.height);return input;}
  if (operation!=='scan_plan'&&(typeof input.revision!=='string'||input.revision.length>128)) throw TypeError('INVALID_ARGUMENT');
  if (operation==='scan_rewind') {input.requestedPoint=scanPoint(input.requestedPoint);return input;}
  input.target=scanPoint(input.target);
  if (operation==='scan_ingest_batch') {
    input.priorTreeState=scanHex(copyBytes(input.priorTreeState,65536,'INVALID_ARGUMENT'));
    const blocks=input.blocks;
    if (!Array.isArray(blocks)||blocks.length<1||blocks.length>16) throw TypeError('RESOURCE_LIMIT');
    if (Reflect.ownKeys(blocks).length!==blocks.length+1) throw TypeError('INVALID_ARGUMENT');
    let remaining=2*1024*1024;
    input.blocks=[];
    for (let i=0;i<blocks.length;i++) {
      const property=Object.getOwnPropertyDescriptor(blocks,String(i));
      if (!property||!('value' in property)) throw TypeError('INVALID_ARGUMENT');
      const bytes=copyBytes(property.value,remaining,'RESOURCE_LIMIT');
      remaining-=bytes.length;
      input.blocks.push(scanHex(bytes));
    }
  }
  return input;
}
function lowerEnhancement(args, operation) {
  const input=scanFields(args,operation==='enhancement_requests'?['signal']:['revision','request','result','signal']);delete input.signal;
  if (operation==='enhancement_requests') return input;
  if (typeof input.revision!=='string'||input.revision.length>128) throw TypeError('INVALID_ARGUMENT');
  const request=scanFields(input.request,['kind','txid','address','start','endExclusive','requestAt','txStatus','outputStatus']);
  if (request.kind==='address') {
    scanFields(input.request,['kind','address','start','endExclusive','requestAt','txStatus','outputStatus']);
    if (typeof request.address!=='string'||request.address.length>128||!request.address.length
      || !['mined','mempool','all'].includes(request.txStatus)||!['unspent','all'].includes(request.outputStatus)) throw TypeError('INVALID_ARGUMENT');
    scanHeight(request.start);if(request.endExclusive!==null)scanHeight(request.endExclusive);
    if(request.requestAt!==null&&(!Number.isSafeInteger(request.requestAt)||request.requestAt<0))throw TypeError('INVALID_ARGUMENT');
  } else {
    scanFields(input.request,['kind','txid']);
    if (!['enhancement','status'].includes(request.kind)||typeof request.txid!=='string'||! /^[0-9a-f]{64}$/.test(request.txid)) throw TypeError('INVALID_ARGUMENT');
  }
  input.request=request;
  const result=scanFields(input.result,['transactions','asOfHeight','asOfHash','complete','status','height']);
  if (Object.hasOwn(result,'status')) {
    scanFields(input.result,['status','height']);
    if (!['notRecognized','notInMainChain','mined'].includes(result.status)) throw TypeError('INVALID_ARGUMENT');
    if(result.status==='mined')scanHeight(result.height);else if(Object.hasOwn(result,'height'))throw TypeError('INVALID_ARGUMENT');
  } else {
    scanFields(input.result,request.kind==='address'?['transactions','asOfHeight','asOfHash','complete']:['transactions']);
    if(request.kind==='address'&&typeof result.complete!=='boolean')throw TypeError('INVALID_ARGUMENT');
    if(Object.hasOwn(result,'asOfHeight'))scanHeight(result.asOfHeight);
    if(Object.hasOwn(result,'asOfHash')&&(typeof result.asOfHash!=='string'||! /^[0-9a-f]{64}$/.test(result.asOfHash)))throw TypeError('INVALID_ARGUMENT');
    const unspent=request.kind==='address'&&request.txStatus==='all'&&request.outputStatus==='unspent'&&request.endExclusive===null;
    if(unspent&&result.complete!==true)throw TypeError('INVALID_ARGUMENT');
    const items=result.transactions;
    if(!Array.isArray(items)||items.length>(unspent?1000:16)||Reflect.ownKeys(items).length!==items.length+1)throw TypeError('RESOURCE_LIMIT');
    let remaining=2*1024*1024,outputCount=0;
    result.transactions=[];
    for(let i=0;i<items.length;i++) {
      const property=Object.getOwnPropertyDescriptor(items,String(i));
      if(!property||!('value'in property))throw TypeError('INVALID_ARGUMENT');
      const item=scanFields(property.value,['txid','bytes','minedHeight','unspentOutputs']);
      if(item.minedHeight!==null)scanHeight(item.minedHeight);
      const bytes=copyBytes(item.bytes,remaining,'RESOURCE_LIMIT');remaining-=bytes.length;
      const lowered={bytes:scanHex(bytes),minedHeight:item.minedHeight};
      if(Object.hasOwn(item,'txid')){if(typeof item.txid!=='string'||! /^[0-9a-f]{64}$/.test(item.txid))throw TypeError('INVALID_ARGUMENT');lowered.txid=item.txid;}
      if(Object.hasOwn(item,'unspentOutputs')) {
        const outputs=item.unspentOutputs;if(!Array.isArray(outputs)||(outputCount+=outputs.length)>1000||Reflect.ownKeys(outputs).length!==outputs.length+1)throw TypeError('RESOURCE_LIMIT');
        lowered.unspentOutputs=[];
        for(let j=0;j<outputs.length;j++){const field=Object.getOwnPropertyDescriptor(outputs,String(j));if(!field||!('value'in field))throw TypeError('INVALID_ARGUMENT');const output=scanFields(field.value,['outputIndex','script','value']);scanHeight(output.outputIndex);if(typeof output.value!=='bigint'||output.value<0n||output.value>2100000000000000n)throw TypeError('INVALID_ARGUMENT');const script=copyBytes(output.script,Math.min(remaining,10000),'RESOURCE_LIMIT');remaining-=script.length;lowered.unspentOutputs.push({outputIndex:output.outputIndex,script:scanHex(script),value:output.value.toString()});}
      }
      result.transactions.push(lowered);
    }
  }
  input.result=result;
  return input;
}
function lift(value) {
  if (Array.isArray(value)) return value.map(lift);
  if (value&&typeof value==='object'&&typeof value.index==='string') value.index=BigInt(value.index);
  return value;
}
function liftAmounts(value) {
  if (value===null) return null;
  for (const [key,amount] of Object.entries(value)) {
    if (['total','spendable','locked','changePendingConfirmation','pendingSpendability','uneconomic','observedTotal'].includes(key)) value[key]=BigInt(amount);
    else if (amount&&typeof amount==='object') liftAmounts(amount);
  }
  return value;
}
export async function initializeViews(wasm,backend,format,parameters,genesis) {
  // The sole storage owner stays private. It initializes the SAME binding module.
  const storage=await initializeStorage(wasm,backend,format,parameters,genesis);
  return viewsForStorage(storage);
}
/** Bind account/query operations to the already opened worker-local storage. */
export function viewsForStorage(storage) {
  const {generation,instance}=storage;
  let poisoned=false;
  return Object.freeze({
    generation,instance,
    bindSigner: storage.bindSigner, unbindSigner: storage.unbindSigner,
    call(token,owner,operation,args={},seed,mnemonic,passphrase) {
      if(poisoned)throw Error('DOMAIN_INVALID');
      let signal,input,ownedPczt,pcztOperationId,pcztMaximum,proof;
      try {
        storage.binding(token,owner); // actual Rust generation + owned JS instance
        if(!operations.has(operation)&&!scans.has(operation))throw TypeError('INVALID_ARGUMENT');
        const descriptor=Object.getOwnPropertyDescriptor(args,'signal');
        if(descriptor&&!('value' in descriptor))throw TypeError('INVALID_ARGUMENT');
        signal=descriptor?.value;
        abort(signal,'none');
        const lowered=scans.has(operation)?lowerScan(args,operation):lower(args);
        if(operation==='pczt_import'){ownedPczt=lowered.bytes;pcztOperationId=lowered.operationId;pcztMaximum=lowered.maximum;delete lowered.bytes;}
        if(operation==='fused_send'||operation==='pczt_prove'||operation==='pczt_finalize'){proof={...lowered};delete lowered.spend;delete lowered.output;}
        input=JSON.stringify(lowered);
        abort(signal,'none');
      } catch(error) {
        if(scans.has(operation))throw Object.assign(error instanceof Error?error:Error('INVALID_ARGUMENT'),{commit:'none'});
        throw error;
      }
      let result;
      let ownedSeed,ownedMnemonic,ownedPassphrase;
      try {
        if(['account_import_mnemonic','account_import_mnemonic_signer','account_create_mnemonic_signer','account_restore_mnemonic_signer'].includes(operation)) {
          if(seed!==undefined)throw 'INVALID_ARGUMENT';
          try {
            ownedMnemonic=copyBytes(mnemonic,4096,'INVALID_ARGUMENT');
            ownedPassphrase=passphrase===undefined?new Uint8Array():copyBytes(passphrase,65536,'INVALID_ARGUMENT',0);
          }catch {throw 'INVALID_ARGUMENT';}
          result=storage.run(()=>operation==='account_import_mnemonic' ? binding.views_mnemonic_call(token,input,ownedMnemonic,ownedPassphrase) : binding.signer_create_account(token,operation==='account_restore_mnemonic_signer'?'account_restore_signer':operation==='account_create_mnemonic_signer'?'account_create_hd':'account_import_hd',input,ownedMnemonic,ownedPassphrase));
        } else if(mnemonic!==undefined||passphrase!==undefined) {
          throw 'INVALID_ARGUMENT';
        } else if(operation==='account_import_hd'||operation==='account_create_hd') {
          try {ownedSeed=copyBytes(seed,64,'INVALID_ARGUMENT');}catch {throw 'INVALID_ARGUMENT';}
          if(ownedSeed.length!==32&&ownedSeed.length!==64)throw 'INVALID_ARGUMENT';
          result=storage.run(()=>binding.views_seed_call(token,operation,input,ownedSeed));
        } else {
          if(seed!==undefined)throw 'INVALID_ARGUMENT';
          result=storage.run(()=>payments.has(operation)?binding.payment_call(token,operation,input):operation==='finalized_get'?binding.finalized_get(token,JSON.parse(input).operationId):operation==='fused_send'?binding.fused_send_call(token,proof.operationId,proof.proposalId,proof.reviewCommitment,proof.token,proof.spend,proof.output,proof.maximum):operation==='pczt_finalize'?binding.pczt_finalize_call(token,proof.operationId,proof.artifactId,proof.spend,proof.output,proof.maximum):operation==='pczt_prove'?binding.pczt_prove_call(token,proof.operationId,proof.artifactId,proof.spend,proof.output,proof.maximum):operation==='pczt_import'?binding.pczt_import_call(token,pcztOperationId,ownedPczt,pcztMaximum):pczt.has(operation)?binding.pczt_build_call(token,operation,input):lifecycle.has(operation)?binding.account_lifecycle_call(token,operation,input):proposals.has(operation)?binding.proposal_call(token,operation,input):queries.has(operation)?binding.query_call(token,operation,input):enhancements.has(operation)?binding.enhancement_call(token,operation,input):syncs.has(operation)?binding.sync_call(token,operation,input):
            scans.has(operation)?binding.scan_call(token,operation,input):binding.views_call(token,operation,input));
        }
      }
      catch(error) {
        // Infallible upstream entropy/clock paths can trap. Never reuse that owner.
        if(typeof error!=='string'){poisoned=true;throw Error('DOMAIN_INVALID');}
        throw Object.assign(Error(error),scans.has(operation)?{commit:'none'}:{});
      }
      finally {ownedSeed?.fill(0);ownedMnemonic?.fill(0);ownedPassphrase?.fill(0);}
      const value=lift(JSON.parse(result));
      if (operation==='account_import_mnemonic_signer'||operation==='account_create_mnemonic_signer'||operation==='account_restore_mnemonic_signer') {
        if(signal!==undefined&&aborted.call(signal)) {
          storage.run(()=>binding.signer_release(value.signerToken));
          throw Object.assign(Error('ABORTED'),{commit:operation==='account_restore_mnemonic_signer'?'none':'committed',account:value.account});
        }
      }
      abort(signal,writes.has(operation)?'committed':'none');
      if((pczt.has(operation)||operation==='payment_attempt_begin')&&value!==null) {
        for(const row of operation==='finalized_get'||operation==='fused_send'?value.transactions:[value]) {
          const hex=row.bytes;row.bytes=new Uint8Array(hex.length/2);
          for(let i=0;i<row.bytes.length;i++)row.bytes[i]=parseInt(hex.slice(2*i,2*i+2),16);
        }
        for(const output of value.outputs??[]) {
          output.amount=BigInt(output.amount);
          if(output.memo!==null)output.memo=Uint8Array.from(output.memo.match(/../g)??[],hex=>parseInt(hex,16));
        }
      }
      if(operation==='payment_request_parse') {
        for(const payment of value.payments) {if(payment.amount!==null)payment.amount=BigInt(payment.amount);if(payment.memo!==null)payment.memo=Uint8Array.from(payment.memo.match(/../g),hex=>parseInt(hex,16));}
      } else if(proposals.has(operation)&&operation!=='proposal_list'&&value!==null) {
        value.totalFee=BigInt(value.totalFee);
        for(const step of value.steps) {step.fee=BigInt(step.fee);for(const input of step.inputs)input.value=BigInt(input.value);for(const output of step.outputs) {output.amount=BigInt(output.amount);if(output.memo!==null)output.memo=Uint8Array.from(output.memo.match(/../g)??[],hex=>parseInt(hex,16));}}
      }
      if(operation==='account_balance')value.amounts=liftAmounts(value.amounts);
      if(queries.has(operation)&&value!==null) {
        for(const row of value.items??value.accounts)for(const key of operation==='wallet_notes'||operation==='wallet_utxos'?['value']:['balanceDelta','totalReceived','totalSpent','fee'])if(row[key]!==null)row[key]=BigInt(row[key]);
        if(operation==='wallet_transaction') {
          const bytes=hex=>{const result=new Uint8Array(hex.length/2);for(let i=0;i<result.length;i++)result[i]=parseInt(hex.slice(2*i,2*i+2),16);return result;};
          if(value.raw!==null)value.raw=bytes(value.raw);
          for(const output of value.outputs){if(output.value!==null)output.value=BigInt(output.value);if(output.memo.kind==='binary')output.memo.bytes=bytes(output.memo.bytes);}
        }
      }
      return value;
    },
    close(token,owner) {
      if(poisoned)throw Error('DOMAIN_INVALID');
      storage.close(token,owner);
    },
  });
}
