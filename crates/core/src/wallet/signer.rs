//! Worker-local authority, independent of database lifetime. No spending-key export.
use std::cell::RefCell;
use serde_json::json;
use secrecy::SecretVec;
use zcash_client_backend::data_api::{Account,AccountPurpose,WalletRead};
use zcash_client_sqlite::AccountUuid;
use zcash_keys::keys::UnifiedSpendingKey;

const MAX_SIGNERS: usize = 1024;
const MAX_PCZT_BYTES: u32 = 4 * 1024 * 1024;
struct Signer { key: UnifiedSpendingKey, parameters: Vec<u8>, genesis: Vec<u8>, account_index: u32,
    bindings: Vec<(u32,AccountUuid)> }
// Tokens never recycle within this native instance; exhausted instances fail closed.
thread_local! { static SIGNERS: RefCell<Vec<Option<Signer>>> = const { RefCell::new(Vec::new()) }; }

pub fn signer_create_account(generation:u32, operation:&str, input:&str, mnemonic:Vec<u8>, passphrase:Vec<u8>) -> Result<String,String> {
    let mnemonic=SecretVec::new(mnemonic);
    let passphrase=SecretVec::new(passphrase);
    // Reserve allocation and identity before the account transaction can commit.
    SIGNERS.with(|table| {
        let mut table=table.try_borrow_mut().map_err(|_|"STORAGE_BUSY")?;
        if table.len()>=MAX_SIGNERS { return Err("RESOURCE_LIMIT".into()); }
        table.try_reserve(1).map_err(|_|"RESOURCE_LIMIT")?;
        let (parameters,genesis)=super::DOMAIN.with(|domain| {
            let mut domain=domain.try_borrow_mut().map_err(|_|"STORAGE_BUSY")?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
            let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or("STALE_HANDLE")?;
            let genesis=active.wallet.transactionally_with_extension(|_,ext| -> super::accounts::Result<Vec<u8>> {
                Ok(ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?)
            }).map_err(|e|e.0)?;
            Ok::<_,String>((active.bytes.clone(),genesis))
        })?;
        let (account,key)=super::accounts::mnemonic_account(generation,operation,input,mnemonic,passphrase).map_err(|e|e.0)?;
        // The account index is returned by the native allocator/import operation.
        let account_index=account["accountIndex"].as_u64().expect("native derived account index") as u32;
        let token=(table.len()+1) as u32;
        table.push(Some(Signer {key,parameters,genesis,account_index,bindings:Vec::new()}));
        Ok(json!({"account":account,"signerToken":token}).to_string())
    })
}
fn index(token:u32)->Result<usize,String> { token.checked_sub(1).map(|n|n as usize).ok_or("STALE_HANDLE".into()) }
pub fn signer_describe(token:u32)->Result<String,String> {
    super::DOMAIN.with(|domain| {
        if domain.try_borrow().map_err(|_|"STORAGE_BUSY")?.failed.is_some() {Err("DOMAIN_INVALID")} else {Ok(())}
    })?;
    SIGNERS.with(|table| {
        let table=table.try_borrow().map_err(|_|"STORAGE_BUSY")?;
        let signer=table.get(index(token)?).and_then(Option::as_ref).ok_or("STALE_HANDLE")?;
        let p=crate::Document::parse(&signer.parameters).map_err(|_|"DOMAIN_INVALID")?;
        Ok(json!({"parameters":hex::encode(&signer.parameters),"genesis":hex::encode(&signer.genesis),
            "accountIndex":signer.account_index,"viewingKey":signer.key.to_unified_full_viewing_key().encode(&p)}).to_string())
    })
}
/// Native role profile; the host maps the retained network identity to its registered ID.
pub fn signer_capabilities(token:u32)->Result<String,String> {
    use zcash_protocol::consensus::BranchId;
    let identity:serde_json::Value=serde_json::from_str(&signer_describe(token)?).map_err(|_|"DOMAIN_INVALID")?;
    let mut authorizations=Vec::new();
    for (version,branches,pczt_versions) in [
        (5,vec![BranchId::Nu5,BranchId::Nu6,BranchId::Nu6_1,BranchId::Nu6_2],vec![1,2]),
        (6,vec![BranchId::Nu6_3,BranchId::Nu7],vec![2]),
    ] {
        for pool in if version==5 { &["transparent","sapling"][..] } else { &["transparent","sapling","ironwood"][..] } {
            let circuits=match *pool { "sapling"=>vec!["sapling-groth16/1"],"ironwood"=>vec!["ironwood-post-nu6_3/1"],_=>vec![] };
            authorizations.push(json!({"pool":pool,"txVersion":version,"branchIds":branches.iter().map(|b|u32::from(*b)).collect::<Vec<_>>(),
                "circuitVersions":circuits,"pcztVersions":pczt_versions,"proofState":"not-required",
                "requiredFields":["zakura-native-role-input/1"],"review":"application"}));
        }
    }
    Ok(json!({"revision":"zakura-memory-signer/1","parameters":identity["parameters"],"genesis":identity["genesis"],
        "authorizations":authorizations,"accountDiscovery":"explicit-index","exportableViewing":["ufvk","uivk"],"maxPcztBytes":MAX_PCZT_BYTES}).to_string())
}
pub fn signer_release(token:u32)->Result<(),String> {
    SIGNERS.with(|table| {
        let mut table=table.try_borrow_mut().map_err(|_|"STORAGE_BUSY")?;
        table.get_mut(index(token)?).and_then(Option::take).ok_or("STALE_HANDLE")?;
        Ok(())
    })
}
pub(super) fn detach_wallet(generation:u32) {
    SIGNERS.with(|table| { for signer in table.borrow_mut().iter_mut().flatten() { signer.bindings.retain(|(g,_)|*g!=generation); } });
}

pub fn signer_bind(token:u32,generation:u32,account_id:&str)->Result<String,String> {
    let account_id=AccountUuid::from_uuid(uuid::Uuid::parse_str(account_id).map_err(|_|"INVALID_ARGUMENT")?);
    SIGNERS.with(|table| {
        let mut table=table.try_borrow_mut().map_err(|_|"STORAGE_BUSY")?;
        let signer=table.get_mut(index(token)?).and_then(Option::as_mut).ok_or("STALE_HANDLE")?;
        let present=signer.bindings.contains(&(generation,account_id));
        if !present {
            if signer.bindings.len()>=1024 {return Err("RESOURCE_LIMIT".into());}
            signer.bindings.try_reserve(1).map_err(|_|"RESOURCE_LIMIT")?;
        }
        let state=super::DOMAIN.with(|domain| {
            let mut domain=domain.try_borrow_mut().map_err(|_|"STORAGE_BUSY")?;
        if domain.failed.is_some() { return Err("DOMAIN_INVALID".into()); }
            let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or("STALE_HANDLE")?;
            if active.bytes!=signer.parameters {return Err("NETWORK_MISMATCH".to_string());}
            active.wallet.transactionally_with_extension(|db,ext| -> super::accounts::Result<&'static str> {
                let genesis:Vec<u8>=ext.query_row("SELECT genesis FROM ext_wallet_storage WHERE id=1",[],|r|r.get(0))?;
                if genesis!=signer.genesis {return Err("NETWORK_MISMATCH".into());}
                let account=db.get_account(account_id)?.ok_or(super::accounts::Failure::from("ACCOUNT_NOT_FOUND"))?;
                if !account.ufvk().is_some_and(|key|signer.key.to_unified_full_viewing_key().subsumes_ufvk(key)) {
                    return Err("SIGNER_MISMATCH".into());
                }
                Ok(if account.purpose()==AccountPurpose::ViewOnly {"recovery-required"} else {"ready"})
            }).map_err(|e|e.0)
        })?;
        if !present { signer.bindings.push((generation,account_id)); }
        Ok(state.into())
    })
}
pub fn signer_unbind(token:u32,generation:u32,account_id:&str)->Result<(),String> {
    let account_id=AccountUuid::from_uuid(uuid::Uuid::parse_str(account_id).map_err(|_|"INVALID_ARGUMENT")?);
    SIGNERS.with(|table| {
        let mut table=table.try_borrow_mut().map_err(|_|"STORAGE_BUSY")?;
        let signer=table.get_mut(index(token)?).and_then(Option::as_mut).ok_or("STALE_HANDLE")?;
        signer.bindings.retain(|pair|*pair!=(generation,account_id)); Ok(())
    })
}

pub(super) fn is_bound(generation:u32,account_id:&str)->bool {
    SIGNERS.with(|table| table.borrow().iter().flatten().any(|signer| signer.bindings.iter().any(|(g,id)|*g==generation && id.expose_uuid().to_string()==account_id)))
}

/// Authorize only spends controlled by this retained key; account IDs are not authority.
pub fn signer_authorize(token:u32,parameters:&[u8],genesis:&[u8],height:u32,branch:u32,bytes:&[u8],maximum:u32)->Result<Vec<u8>,String> {
    use pczt::roles::{signer::{Signer as Role,Error as RoleError},verifier::{Verifier,OrchardError}};
    use zcash_transparent::keys::{TransparentKeyScope,NonHardenedChildIndex};
    super::DOMAIN.with(|domain| {
        if domain.try_borrow().map_err(|_|"STORAGE_BUSY")?.failed.is_some() {Err("DOMAIN_INVALID")} else {Ok(())}
    })?;
    if maximum==0 || maximum>MAX_PCZT_BYTES {return Err("RESOURCE_LIMIT".into());}
    SIGNERS.with(|table| {
        let table=table.try_borrow().map_err(|_|"STORAGE_BUSY")?;
        let signer=table.get(index(token)?).and_then(Option::as_ref).ok_or("STALE_HANDLE")?;
        if parameters!=signer.parameters || genesis!=signer.genesis {return Err("NETWORK_MISMATCH".into());}
        let p=crate::Document::parse(parameters).map_err(|_|"INVALID_ARGUMENT")?;
        let pczt=crate::standalone_pczt::parse_standalone_pczt(parameters,genesis,height,branch,bytes,maximum)?.into_value();
        let mut transparent=Vec::new();
        let mut own_sapling=Vec::new();let mut foreign_sapling=Vec::new();
        let pczt=Verifier::new(pczt).with_ironwood::<(),_>(|bundle| {
            bundle.verify_cross_address_restriction().map_err(|_|OrchardError::Custom(()))
        }).map_err(|_|"INVALID_PCZT")?.with_transparent::<(),_>(|bundle| {
            for (index,input) in bundle.inputs().iter().enumerate() {
                for (public,derivation) in input.bip32_derivation() {
                    let path=derivation.derivation_path();
                    if path.len()!=5 {continue;}
                    let public_key=signer.key.transparent().to_account_pubkey().derive_pubkey_at_bip32_path(&p,zip32::AccountId::try_from(signer.account_index).expect("native account index"),path);
                    if !public_key.is_ok_and(|key|key.serialize()==*public) {continue;}
                    let invalid=||pczt::roles::verifier::TransparentError::Custom(());
                    let scope=TransparentKeyScope::custom(path[3].index()).ok_or_else(invalid)?;
                    let child=NonHardenedChildIndex::from_index(path[4].index()).ok_or_else(invalid)?;
                    transparent.push((index,signer.key.transparent().derive_secret_key(scope,child).map_err(|_|invalid())?));
                }
            }
            Ok(())
        }).map_err(|_|"INVALID_PCZT")?.with_sapling::<(),_>(|bundle| {
            // Builder omits PGK. Bind missing material to the retained native randomized key first.
            for (index,spend) in bundle.spends().iter().enumerate() {
                if spend.proof_generation_key().is_some(){continue;}
                match spend.verify_rk(Some(&signer.key.sapling().to_diversifiable_full_viewing_key().fvk())) {
                    Ok(())=>{
                        let key=signer.key.sapling().to_diversifiable_full_viewing_key();
                        let internal=if spend.verify_nullifier(Some(key.fvk())).is_ok(){false}
                            else if spend.verify_nullifier(Some(&key.to_internal_fvk())).is_ok(){true}
                            else{return Err(pczt::roles::verifier::SaplingError::Custom(()));};
                        own_sapling.push((index,internal));
                    },
                    Err(sapling::pczt::VerifyError::InvalidRandomizedVerificationKey)=>foreign_sapling.push(index),
                    Err(_)=>return Err(pczt::roles::verifier::SaplingError::Custom(())),
                }
            }
            Ok(())
        }).map_err(|_|"INVALID_PCZT")?.finish();
        let pczt=pczt::roles::updater::Updater::new(pczt).update_sapling_with(|mut bundle| {
            for (index,internal) in own_sapling {
                let pgk=if internal{signer.key.sapling().derive_internal().expsk.proof_generation_key()}else{signer.key.sapling().expsk.proof_generation_key()};
                bundle.update_spend_with(index,|mut spend|spend.set_proof_generation_key(pgk))?;
            }
            Ok(())
        }).map_err(|_|"INVALID_PCZT")?.finish();
        let sapling=pczt.sapling().spends().len();
        let ironwood=pczt.ironwood().actions().len();
        let mut role=Role::new(pczt).map_err(|_|"ROLE_PRECONDITION")?;
        let mut signed=0usize;
        for (index,key) in transparent {role.sign_transparent(index,&key).map_err(|_|"INVALID_PCZT")?;signed+=1;}
        for index in 0..sapling {
            if foreign_sapling.contains(&index){continue;}
            match role.sign_sapling(index,&signer.key.sapling().expsk.ask) {
                Ok(())=>signed+=1,
                Err(RoleError::SaplingSign(sapling::pczt::SignerError::WrongSpendAuthorizingKey))=>{},
                Err(_)=>return Err("INVALID_PCZT".into()),
            }
        }
        let ask=signer.key.orchard().into();
        for index in 0..ironwood {
            match role.sign_ironwood(index,&ask) {
                Ok(())=>signed+=1,
                Err(RoleError::IronwoodSign(orchard::pczt::SignerError::WrongSpendAuthorizingKey))=>{},
                Err(_)=>return Err("INVALID_PCZT".into()),
            }
        }
        if signed==0 {return Err("SIGNER_MISMATCH".into());}
        let output=role.finish().serialize().map_err(|_|"INVALID_PCZT")?;
        if output.len()>maximum as usize {return Err("RESOURCE_LIMIT".into());}
        Ok(output)
    })
}

#[cfg(test)]
mod authorization_tests {
    use super::*;
    use pczt::{Pczt,roles::{creator::Creator,updater::Updater,signer::Signer as Role,verifier::Verifier}};
    use zcash_protocol::consensus::BranchId;
    use zcash_script::script::Evaluable;
    const PARAMS:&[u8]=br#"{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#;
    fn key(seed:u8)->UnifiedSpendingKey {UnifiedSpendingKey::from_seed(&crate::Document::parse(PARAMS).unwrap(),&[seed;32],zip32::AccountId::ZERO).unwrap()}
    #[test]
    fn nu7_wallet_signer_advertises_v6_authorization() {
        let parameters=std::str::from_utf8(PARAMS).unwrap().replace('}', ",\"Nu7\":110}").into_bytes();
        let token=SIGNERS.with(|table| {
            let mut table=table.borrow_mut();
            table.push(Some(Signer {key:key(7),parameters,genesis:vec![3;32],account_index:0,bindings:vec![]}));
            table.len() as u32
        });
        let capabilities:serde_json::Value=serde_json::from_str(&signer_capabilities(token).unwrap()).unwrap();
        signer_release(token).unwrap();
        for pool in ["transparent","sapling","ironwood"] {
            assert!(capabilities["authorizations"].as_array().unwrap().iter().any(|role|
                role["pool"]==pool && role["txVersion"]==6 && role["branchIds"].as_array().unwrap().contains(&json!(0x77190ad9u32))));
        }
    }
    fn fixture_for(key:&UnifiedSpendingKey,branch:BranchId)->Pczt {
        // Native Creator/Updater plus synthetic effects, following upstream role fixtures.
        // This qualifies actual authorization signatures, not proofs or spendability.
        let base=Creator::new(branch.into(),140,1,Some([0;32]),Some([0;32])).unwrap().build().unwrap();
        let mut value=serde_json::to_value(pczt::v2::Pczt::try_from(base).unwrap()).unwrap();
        let alpha={let mut a=[0u8;32];a[0]=1;a};
        let recipient=key.sapling().default_address().1;
        let note=recipient.create_note(sapling::value::NoteValue::from_raw(1),sapling::Rseed::AfterZip212([7;32]));
        // Native MerklePath constructs the synthetic checkpoint; no tree/hash algorithm here.
        let path=sapling::MerklePath::from_parts(vec![sapling::Node::from_bytes([0;32]).unwrap();32],0u64.into()).unwrap();
        let anchor=path.root(sapling::Node::from_cmu(&note.cmu())).to_bytes();
        let nullifier=note.nf(&key.sapling().to_diversifiable_full_viewing_key().fvk().vk.nk,0).0;
        let witness=path.path_elems().iter().map(|node|node.to_bytes()).collect::<Vec<_>>();
        let rcv=sapling::value::ValueCommitTrapdoor::from_bytes(alpha).unwrap();
        let cv=sapling::value::ValueCommitment::derive(sapling::value::NoteValue::from_raw(1),rcv).to_bytes();
        let rk:[u8;32]=sapling::keys::SpendValidatingKey::from(&key.sapling().expsk.ask).randomize(&1u64.into()).into();
        value["sapling"]=json!({"spends":[{"cv":cv,"nullifier":nullifier,"recipient":recipient.to_bytes().to_vec(),"value":1,"rseed":vec![7u8;32],"rcv":alpha,"witness":[0,witness],"rk":rk,"alpha":alpha,"proof_generation_key":[sapling::keys::SpendValidatingKey::from(&key.sapling().expsk.ask).to_bytes(),key.sapling().expsk.nsk.to_bytes()],"proprietary":{}}],"outputs":[],"value_sum":1,"anchor":anchor});
        let ask=orchard::keys::SpendAuthorizingKey::from(key.orchard());
        let rk:[u8;32]=orchard::keys::SpendValidatingKey::from(&ask).randomize(&orchard::primitives::redpallas::SpendAuthRandomizer::from_bytes(alpha).unwrap()).into();
        let cv=orchard::value::ValueCommitment::derive(orchard::value::NoteValue::from_raw(0)-orchard::value::NoteValue::from_raw(0),orchard::value::ValueCommitTrapdoor::from_bytes(alpha).unwrap()).to_bytes();
        if matches!(branch,BranchId::Nu6_3|BranchId::Nu7) { value["ironwood"]=json!({"actions":[{"cv_net":cv,"spend":{"nullifier":vec![0u8;32],"rk":rk,"alpha":alpha,"fvk":orchard::keys::FullViewingKey::from(key.orchard()).to_bytes().to_vec(),"proprietary":{}},"output":{"cmx":vec![0u8;32],"ephemeral_key":rk,"enc_ciphertext":{"Encrypted":vec![0u8;580]},"out_ciphertext":vec![0u8;80],"proprietary":{}}}],"flags":7,"value_sum":[0,true],"anchor":null,"note_version":"V3"}); }
        let path=vec![0x8000002c,0x80000001,0x80000000,0,5];
        let p=crate::Document::parse(PARAMS).unwrap();
        let public=key.transparent().to_account_pubkey().derive_pubkey_at_bip32_path(&p,zip32::AccountId::ZERO,&path.iter().map(|n|(*n).into()).collect::<Vec<_>>()).unwrap();
        let script=zcash_transparent::address::TransparentAddress::from_pubkey(&public).script().to_bytes();
        value["transparent"]=json!({"inputs":[{"prevout_txid":vec![1u8;32],"prevout_index":0,"value":1,"script_pubkey":script,"partial_signatures":{},"sighash_type":1,"bip32_derivation":{},"ripemd160_preimages":{},"sha256_preimages":{},"hash160_preimages":{},"hash256_preimages":{},"proprietary":{}}],"outputs":[]});
        let raw=serde_json::from_value::<pczt::v2::Pczt>(value).unwrap().serialize();
        Updater::new(Pczt::parse(&raw).unwrap()).update_transparent_with(|mut bundle|bundle.update_input_with(0,|mut input| {
            input.set_hash160_preimage(public.serialize().to_vec());input.set_bip32_derivation(public.serialize(),zcash_transparent::pczt::Bip32Derivation::parse([0;32],path).unwrap());Ok(())
        })).unwrap().finish()
    }
    fn fixture(key:&UnifiedSpendingKey)->Pczt { fixture_for(key,BranchId::Nu6_3) }
    #[test]
    fn nu7_authorization_signatures_verify_and_reject_a_pre_activation_context() {
        let parameters=std::str::from_utf8(PARAMS).unwrap().replace('}', ",\"Nu7\":110}").into_bytes();
        let authority=key(63);
        let original=fixture_for(&authority,BranchId::Nu7);
        let bytes=original.clone().serialize().unwrap();
        let token=SIGNERS.with(|table| {
            let mut table=table.borrow_mut();
            table.push(Some(Signer {key:authority,parameters:parameters.clone(),genesis:vec![3;32],account_index:0,bindings:vec![]}));
            table.len() as u32
        });
        assert_eq!(signer_authorize(token,&parameters,&[3;32],109,0x77190ad9,&bytes,65536).unwrap_err(),"NETWORK_MISMATCH");
        let signed=Pczt::parse(&signer_authorize(token,&parameters,&[3;32],110,0x77190ad9,&bytes,65536).unwrap()).unwrap();
        signer_release(token).unwrap();
        let mut sapling_signature=None;
        Verifier::new(signed.clone()).with_sapling::<(),_>(|bundle|{sapling_signature=bundle.spends()[0].spend_auth_sig().clone();Ok(())}).unwrap()
            .with_transparent::<(),_>(|bundle|{assert_eq!(bundle.inputs()[0].partial_signatures().len(),1);Ok(())}).unwrap();
        let mut verifier=Role::new(original).unwrap();
        verifier.apply_sapling_signature(0,sapling_signature.unwrap()).unwrap();
        verifier.apply_ironwood_signature(0,signed.ironwood().actions()[0].spend().spend_auth_sig().unwrap().into()).unwrap();
    }
    #[test]
    fn native_signer_authorizes_three_pools_with_verified_signatures() {
        assert_eq!(super::super::accounts::mnemonic_account(0,"account_import_hd","{}",SecretVec::new(b"abandon ".repeat(12)),SecretVec::new(vec![])).err().unwrap().0,"INVALID_MNEMONIC");
        let authority=key(61);let unsigned=fixture(&authority);
        let token=SIGNERS.with(|table|{let mut t=table.borrow_mut();t.push(Some(Signer{key:authority,parameters:PARAMS.to_vec(),genesis:vec![3;32],account_index:0,bindings:vec![]}));t.len() as u32});
        let caps:serde_json::Value=serde_json::from_str(&signer_capabilities(token).unwrap()).unwrap();
        assert_eq!(caps["authorizations"].as_array().unwrap().len(),5);
        assert_eq!(caps["maxPcztBytes"],MAX_PCZT_BYTES);
        let raw=unsigned.clone().serialize().unwrap();
        let full=crate::standalone_pczt::parse_standalone_pczt(PARAMS,&[3;32],100,BranchId::Nu6_3.into(),&raw,65536).unwrap().redact("zakura-signer-full/1").unwrap().serialize().unwrap();
        assert_eq!(signer_authorize(token,PARAMS,&[3;32],100,BranchId::Nu6_3.into(),&full,65536).unwrap_err(),"INVALID_PCZT");
        assert_eq!(signer_authorize(token,PARAMS,&[3;32],100,BranchId::Nu6_3.into(),&raw,MAX_PCZT_BYTES+1).unwrap_err(),"RESOURCE_LIMIT");
        let output=signer_authorize(token,PARAMS,&[3;32],100,BranchId::Nu6_3.into(),&raw,65536).unwrap();
        let signed=Pczt::parse(&output).unwrap();
        let mut sapling_signature=None;let mut transparent_signature=None;
        Verifier::new(signed.clone()).with_sapling::<(),_>(|b|{sapling_signature=b.spends()[0].spend_auth_sig().clone();Ok(())}).unwrap()
          .with_transparent::<(),_>(|b|{transparent_signature=Some(b.inputs()[0].partial_signatures().values().next().unwrap().clone());Ok(())}).unwrap();
        let mut verifier=Role::new(unsigned.clone()).unwrap();
        verifier.apply_sapling_signature(0,sapling_signature.unwrap()).unwrap();
        verifier.apply_ironwood_signature(0,signed.ironwood().actions()[0].spend().spend_auth_sig().unwrap().into()).unwrap();
        let signature=transparent_signature.unwrap();
        Role::new(signed.clone()).unwrap().append_transparent_signature(0,secp256k1::ecdsa::Signature::from_der(&signature[..signature.len()-1]).unwrap()).unwrap();
        assert!(Role::new(unsigned).unwrap().apply_sapling_signature(0,[0u8;64].into()).is_err());
        assert_eq!(signer_authorize(token,PARAMS,&[4;32],100,BranchId::Nu6_3.into(),&raw,65536).unwrap_err(),"NETWORK_MISMATCH");
        let foreign=fixture(&key(62)).serialize().unwrap();
        assert_eq!(signer_authorize(token,PARAMS,&[3;32],100,BranchId::Nu6_3.into(),&foreign,65536).unwrap_err(),"SIGNER_MISMATCH");
        for (branch,height) in [(BranchId::Nu5,60),(BranchId::Nu6,70),(BranchId::Nu6_1,80),(BranchId::Nu6_2,90)] {
            let original=fixture_for(&key(61),branch);
            let bytes=original.clone().serialize().unwrap();
            let wire2=pczt::v2::Pczt::try_from(original.clone()).unwrap().serialize();
            signer_authorize(token,PARAMS,&[3;32],height,branch.into(),&wire2,65536).unwrap();
            let result=signer_authorize(token,PARAMS,&[3;32],height,branch.into(),&bytes,65536).unwrap();
            let signed=Pczt::parse(&result).unwrap();
            let mut signature=None;
            Verifier::new(signed.clone()).with_sapling::<(),_>(|b|{signature=b.spends()[0].spend_auth_sig().clone();Ok(())}).unwrap();
            Role::new(original).unwrap().apply_sapling_signature(0,signature.unwrap()).unwrap();
            Verifier::new(signed).with_transparent::<(),_>(|b|{assert_eq!(b.inputs()[0].partial_signatures().len(),1);Ok(())}).unwrap();
        }
        if let Ok(path)=std::env::var("SIGNER_FIXTURE_OUT") {
            let mnemonic="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            let seed=bip39::Mnemonic::parse(mnemonic).unwrap().to_seed("");
            let authority=UnifiedSpendingKey::from_seed(&crate::Document::parse(PARAMS).unwrap(),&seed,zip32::AccountId::ZERO).unwrap();
            let vectors=[(BranchId::Nu5,60),(BranchId::Nu6,70),(BranchId::Nu6_1,80),(BranchId::Nu6_2,90),(BranchId::Nu6_3,100)].into_iter().map(|(branch,height)| {
                let value=fixture_for(&authority,branch);
                json!({"height":height,"branch":u32::from(branch),"bytes":hex::encode(value.clone().serialize().unwrap()),"wire2":hex::encode(pczt::v2::Pczt::try_from(value).unwrap().serialize())})
            }).collect::<Vec<_>>();
            std::fs::write(path,serde_json::to_string_pretty(&json!({"parameters":String::from_utf8(PARAMS.to_vec()).unwrap(),"genesis":hex::encode([3;32]),"mnemonic":mnemonic,"vectors":vectors})).unwrap()+"\n").unwrap();
        }
        signer_release(token).unwrap();
        assert_eq!(signer_authorize(token,PARAMS,&[3;32],100,BranchId::Nu6_3.into(),&raw,65536).unwrap_err(),"STALE_HANDLE");
    }
}

// Synchronous worker-local borrowing only; no raw spending-key representation crosses the ABI.
pub(super) fn with_spending_key<T>(token:u32, use_key:impl FnOnce(&UnifiedSpendingKey,&[u8],&[u8])->super::accounts::Result<T>)->super::accounts::Result<T> {
    SIGNERS.with(|table| {
        let table=table.try_borrow().map_err(|_|super::accounts::Failure::from("STORAGE_BUSY"))?;
        let signer=table.get(index(token).map_err(super::accounts::Failure)?).and_then(Option::as_ref).ok_or(super::accounts::Failure::from("STALE_HANDLE"))?;
        use_key(&signer.key,&signer.parameters,&signer.genesis)
    })
}
