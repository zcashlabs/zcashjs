//! Native signature verification and immutable retained artifact versions.
use super::accounts::{Failure,Result};
use pczt::{Pczt,roles::{combiner::Combiner,signer::Signer,verifier::Verifier}};
use zcash_primitives::transaction::{TxVersion,txid::{TxIdDigester,to_txid},sighash::SignableInput};
pub(super) const TABLE:&str="ext_wallet_pczt_artifacts";
pub(super) const SQL:&str="CREATE TABLE ext_wallet_pczt_artifacts(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation BLOB NOT NULL CHECK(typeof(operation)='blob' AND length(operation)=32),artifact TEXT NOT NULL UNIQUE CHECK(typeof(artifact)='text' AND length(artifact)=64),bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes)>0 AND length(bytes)<=4194304),FOREIGN KEY(operation) REFERENCES ext_wallet_pczt(operation))";
pub(super) fn initialize(conn:&mut rusqlite::Connection)->std::result::Result<(),String>{
    if !conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[TABLE],|r|r.get::<_,bool>(0)).map_err(|_|"STORAGE_INIT_FAILED")?{conn.execute_batch(SQL).map_err(|_|"STORAGE_INIT_FAILED")?;}Ok(())
}
fn invalid()->Failure{"INVALID_PCZT".into()}
fn identity(value:&Pczt)->Result<zcash_protocol::TxId>{
    let tx=value.clone().into_effects().map_err(|_|invalid())?;
    Ok(to_txid(tx.version(),tx.consensus_branch_id(),&tx.digest(TxIdDigester)))
}
pub(super) fn combine(retained:Pczt,incoming:Pczt)->Result<Pczt>{
    let expected=identity(&retained)?;
    let combined=Combiner::new(vec![retained,incoming]).combine().map_err(|_|Failure::from("PCZT_ASSOCIATION_MISMATCH"))?;
    if identity(&combined)?!=expected{return Err("PCZT_ASSOCIATION_MISMATCH".into());}
    let mut role=Signer::new(combined.clone()).map_err(|_|invalid())?;
    Verifier::new(combined.clone()).with_sapling::<(),_>(|bundle|{
        for(index,spend)in bundle.spends().iter().enumerate(){if let Some(sig)=spend.spend_auth_sig(){role.apply_sapling_signature(index,sig.clone()).map_err(|_|pczt::roles::verifier::SaplingError::Custom(()))?;}}Ok(())
    }).map_err(|_|invalid())?;
    for sig in pczt::roles::signer::extract_orchard_spend_auth_signatures(&combined){role.apply_orchard_spend_auth_signature(&sig).map_err(|_|invalid())?;}
    let tx=combined.clone().into_effects().map_err(|_|invalid())?;let digests=tx.digest(TxIdDigester);
    Verifier::new(combined.clone()).with_transparent::<(),_>(|bundle|{
        let mut check=||->Result<()>{
            for(index,input)in bundle.inputs().iter().enumerate(){
                input.verify().map_err(|_|invalid())?;
                for(public,bytes)in input.partial_signatures(){
                    let (hash_type,der)=bytes.split_last().ok_or_else(invalid)?;
                    if *hash_type!=input.sighash_type().encode(){return Err(invalid());}
                    let signature=secp256k1::ecdsa::Signature::from_der(der).map_err(|_|invalid())?;
                    let key=secp256k1::PublicKey::from_slice(public).map_err(|_|invalid())?;
                    // Native append_signature reads P2PKH preimage maps; bind the key to the actual script too.
                    let script=input.redeem_script().as_ref().unwrap_or(input.script_pubkey());
                    if let Some(address @ zcash_transparent::address::TransparentAddress::PublicKeyHash(_))=zcash_transparent::address::TransparentAddress::from_script_from_chain(script){
                        if zcash_transparent::address::TransparentAddress::from_pubkey(&key)!=address{return Err(invalid());}
                    }
                    secp256k1::ecdsa::verify(&signature,secp256k1::Message::from_digest(role.transparent_sighash(index).map_err(|_|invalid())?),&key).map_err(|_|invalid())?;
                    role.append_transparent_signature(index,signature).map_err(|_|invalid())?;
                }
                if let Some(sig)=input.script_sig(){
                    use zcash_script::{script,interpreter::{CallbackTransactionSignatureChecker,Flags}};
                    let calculate=|code:&script::Code,hash:&zcash_script::signature::HashType|{
                        let hash_type=zcash_transparent::sighash::SighashType::parse(hash.raw_bits().try_into().ok()?)?;
                        if hash_type!=*input.sighash_type(){return None;}
                        let code=zcash_transparent::address::Script(code.clone());let pubkey=zcash_transparent::address::Script::from(input.script_pubkey());
                        let signable=zcash_transparent::sighash::SignableInput::from_parts(tx.transparent_bundle()?,hash_type,index,&code,&pubkey,*input.value()).ok()?;
                        // Same native V5/V6 dispatcher as Pczt::sighash; no signature algorithm here.
                        let hash=match tx.version(){TxVersion::V5=>zcash_primitives::transaction::sighash_v5::v5_signature_hash(&tx,&SignableInput::Transparent(signable),&digests),TxVersion::V6=>zcash_primitives::transaction::sighash_v6::v6_signature_hash(&tx,&SignableInput::Transparent(signable),&digests),_=>return None};
                        hash.as_bytes().try_into().ok()
                    };
                    let checker=CallbackTransactionSignatureChecker{sighash:&calculate,lock_time:tx.lock_time().into(),is_final:input.sequence().unwrap_or(u32::MAX)==u32::MAX};
                    let script=zcash_script::Script{sig:sig.clone(),pub_key:input.script_pubkey().clone()};
                    if !script.eval(Flags::P2SH|Flags::CHECKLOCKTIMEVERIFY,&checker).map_err(|_|invalid())?{return Err(invalid());}
                }
            }Ok(())
        };check().map_err(|_|pczt::roles::verifier::TransparentError::Custom(()))
    }).map_err(|_|invalid())?;
    Ok(combined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    fn corrupt(value:Pczt,signature:&[u8])->Pczt {
        let mut bytes=value.serialize().unwrap();let at=bytes.windows(signature.len()).position(|part|part==signature).unwrap();
        bytes[at+signature.len()-2]^=1;Pczt::parse(&bytes).unwrap()
    }
    #[test]
    fn pczt_import_verifies_partial_maps_and_finalized_scripts(){
        let fixture:Value=serde_json::from_str(include_str!("../../../../tests/signer-fixture.json")).unwrap();
        let parameters=fixture["parameters"].as_str().unwrap().as_bytes();let p=crate::Document::parse(parameters).unwrap();
        let seed=bip39::Mnemonic::parse(fixture["mnemonic"].as_str().unwrap()).unwrap().to_seed("");
        let key=zcash_keys::keys::UnifiedSpendingKey::from_seed(&p,&seed,zip32::AccountId::ZERO).unwrap();
        let secret=key.transparent().derive_secret_key(zcash_transparent::keys::TransparentKeyScope::EXTERNAL,zcash_transparent::keys::NonHardenedChildIndex::from_index(5).unwrap()).unwrap();
        for vector in [fixture["vectors"][0].clone(),fixture["vectors"][4].clone()] {
            let original=Pczt::parse(&hex::decode(vector["bytes"].as_str().unwrap()).unwrap()).unwrap();
            let mut role=Signer::new(original.clone()).unwrap();role.sign_transparent(0,&secret).unwrap();let signed=role.finish();
            combine(original.clone(),signed.clone()).unwrap();
            let mut signature=vec![];
            Verifier::new(signed.clone()).with_transparent::<(),_>(|bundle|{signature=bundle.inputs()[0].partial_signatures().values().next().unwrap().clone();Ok(())}).unwrap();
            // Forge both signature-map key and P2PKH preimage while retaining the spent script.
            let foreign=secp256k1::SecretKey::from_secret_bytes([7;32]).unwrap();
            let public=secp256k1::PublicKey::from_secret_key(&secret).serialize();let foreign_public=secp256k1::PublicKey::from_secret_key(&foreign).serialize();
            let sighash=Signer::new(original.clone()).unwrap().transparent_sighash(0).unwrap();
            let mut forged_sig=secp256k1::ecdsa::sign(secp256k1::Message::from_digest(sighash),&foreign).serialize_der().to_vec();forged_sig.push(1);
            let mut forged=signed.clone().serialize().unwrap();
            let mut offset=0;while let Some(at)=forged[offset..].windows(33).position(|part|part==public){let at=offset+at;forged[at..at+33].copy_from_slice(&foreign_public);offset=at+33;}
            let at=forged.windows(signature.len()).position(|part|part==signature).unwrap();assert_eq!(forged[at-1] as usize,signature.len());
            forged.splice(at-1..at+signature.len(),std::iter::once(forged_sig.len() as u8).chain(forged_sig));
            let without_preimage=pczt::roles::redactor::Redactor::new(original.clone()).redact_transparent_with(|mut b|b.redact_inputs(|mut i|i.clear_hash160_preimages())).finish();
            assert_eq!(combine(without_preimage,Pczt::parse(&forged).unwrap()).unwrap_err().0,"INVALID_PCZT");
            let invalid_partial=corrupt(signed.clone(),&signature);
            assert_eq!(combine(original.clone(),invalid_partial).unwrap_err().0,"INVALID_PCZT");
            let finalized=pczt::roles::spend_finalizer::SpendFinalizer::new(signed.clone()).finalize_spends().unwrap();
            combine(original.clone(),finalized.clone()).unwrap();
            // Native finalizer gap: it clears partials, then rejects its own output.
            assert!(matches!(pczt::roles::spend_finalizer::SpendFinalizer::new(finalized.clone()).finalize_spends(),Err(pczt::roles::spend_finalizer::Error::TransparentFinalize(zcash_transparent::pczt::SpendFinalizerError::MissingSignature))));
            let corrupt=corrupt(finalized,&signature);
            assert_eq!(combine(original,corrupt).unwrap_err().0,"INVALID_PCZT");
        }
    }
}
