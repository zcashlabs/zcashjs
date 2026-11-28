//! Standalone PCZT roles. Inspection reports material completeness, not validity.
use pczt::{Pczt, roles::{combiner::Combiner, redactor::Redactor, verifier::Verifier}};
use serde_json::json;
use zcash_primitives::transaction::TxVersion;
use zcash_script::script::Evaluable;
use zcash_protocol::constants::{V5_VERSION_GROUP_ID,V6_VERSION_GROUP_ID};
use zcash_protocol::{PoolType, consensus::{BranchId,Parameters,NetworkConstants,NetworkUpgrade}};

type Result<T> = std::result::Result<T, String>;
const INVALID: &str = "INVALID_PCZT";

pub struct StandalonePczt {
    value: Pczt,
    parameters: Vec<u8>,
    genesis: Vec<u8>,
    height: u32,
    branch: u32,
    maximum: u32,
}
impl StandalonePczt {
    pub fn serialize(&self) -> Result<Vec<u8>> {
        let bytes = self.value.clone().serialize().map_err(|_| INVALID)?;
        if bytes.len() > self.maximum as usize { return Err("RESOURCE_LIMIT".into()); }
        Ok(bytes)
    }
    pub fn inspect(&self) -> Result<String> {
        let value = &self.value;
        let (mut sapling_proofs,mut sapling_authorization)=(false,false);
        Verifier::new(value.clone()).with_sapling::<(),_>(|bundle| {
            sapling_proofs=bundle.spends().iter().all(|s|s.zkproof().is_some()) && bundle.outputs().iter().all(|o|o.zkproof().is_some());
            sapling_authorization=bundle.spends().iter().all(|s|s.spend_auth_sig().is_some()); Ok(())
        }).map_err(|_|INVALID)?;
        let proofs = sapling_proofs && (value.ironwood().actions().is_empty() || value.ironwood().zkproof().is_some());
        let mut transparent = false;
        Verifier::new(value.clone()).with_transparent::<(),_>(|bundle| {
            transparent = transparent_complete(bundle).map_err(|_| pczt::roles::verifier::TransparentError::Custom(()))?;
            Ok(())
        }).map_err(|_| INVALID)?;
        let authorization = transparent && sapling_authorization
            && value.ironwood().actions().iter().all(|a| a.spend().spend_auth_sig().is_some());
        let pools: Vec<_> = [(PoolType::TRANSPARENT,"transparent"),(PoolType::SAPLING,"sapling"),(PoolType::IRONWOOD,"ironwood")]
            .into_iter().filter_map(|(pool,name)| value.has_data_in_pool(pool).then_some(name)).collect();
        let bytes = self.serialize()?;
        Ok(json!({"pcztVersion":u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            "transactionVersion":value.global().tx_version(),"targetHeight":self.height,"branchId":self.branch,
            "pools":pools,"proofsComplete":proofs,"authorizationComplete":authorization}).to_string())
    }
    pub fn combine(&self, other: &StandalonePczt) -> Result<StandalonePczt> {
        if self.parameters != other.parameters || self.genesis != other.genesis || self.height != other.height || self.branch != other.branch {
            return Err("NETWORK_MISMATCH".into());
        }
        let value = Combiner::new(vec![self.value.clone(),other.value.clone()]).combine().map_err(|_| "PCZT_ASSOCIATION_MISMATCH")?;
        self.with_value(value, self.maximum.min(other.maximum))
    }
    pub fn redact(&self, profile: &str) -> Result<StandalonePczt> {
        if profile != "zakura-signer-full/1" { return Err("UNSUPPORTED_VERSION".into()); }
        // Exact Full policy from pinned zakura-client-backend0.1.0-rc4 wallet.rs3318.
        fn orchard(mut redactor: pczt::roles::redactor::orchard::OrchardRedactor<'_>) {
            redactor.redact_actions(|mut action| {
                action.clear_spend_witness(); action.clear_spend_dummy_sk();
                action.redact_output_proprietary("zcash_client_backend:output_info");
            });
        }
        let value = Redactor::new(self.value.clone())
            .redact_global_with(|mut global| {global.redact_proprietary("zcash_client_backend:proposal_info");})
            .redact_transparent_with(|mut bundle| {bundle.redact_outputs(|mut output| {output.redact_proprietary("zcash_client_backend:output_info");});})
            .redact_sapling_with(|mut bundle| {
                bundle.redact_spends(|mut spend| {spend.clear_witness();spend.clear_dummy_ask();});
                bundle.redact_outputs(|mut output| {output.redact_proprietary("zcash_client_backend:output_info");});
            }).redact_orchard_with(orchard).redact_ironwood_with(orchard).finish();
        self.with_value(value,self.maximum)
    }
}
impl StandalonePczt {
    pub(crate) fn into_value(self) -> Pczt { self.value }
    fn with_value(&self,value:Pczt,maximum:u32)->Result<Self> {
        let output=Self {value,parameters:self.parameters.clone(),genesis:self.genesis.clone(),height:self.height,branch:self.branch,maximum};
        output.serialize()?; Ok(output)
    }
}
pub fn parse_standalone_pczt(parameters:&[u8],genesis:&[u8],height:u32,branch:u32,bytes:&[u8],maximum:u32)->Result<StandalonePczt> {
    if maximum==0 || genesis.len()!=32 {return Err("INVALID_ARGUMENT".into());}
    if bytes.len()>maximum as usize {return Err("RESOURCE_LIMIT".into());}
    let document=crate::Document::parse(parameters).map_err(|_|"INVALID_ARGUMENT")?;
    if u32::from(BranchId::for_height(&document,height.into())) != branch {return Err("NETWORK_MISMATCH".into());}
    // Upstream parse accepts trailing bytes. Reuse its public versioned wire
    // types to check exact consumption; reserialization may normalize v2 to v1.
    let remaining=match u32::from_le_bytes(bytes.get(4..8).ok_or(INVALID)?.try_into().unwrap()) {
        1=>postcard::take_from_bytes::<pczt::v1::Pczt>(&bytes[8..]).map_err(|_|INVALID)?.1,
        2=>postcard::take_from_bytes::<pczt::v2::Pczt>(&bytes[8..]).map_err(|_|INVALID)?.1,
        _=>return Err("UNSUPPORTED_VERSION".into()),
    };
    if !remaining.is_empty() {return Err(INVALID.into());}
    let value=Pczt::parse(bytes).map_err(|_|INVALID)?;
    let global=value.global();
    if serde_json::to_value(global).map_err(|_|INVALID)?["coin_type"].as_u64()!=Some(u64::from(document.network_type().coin_type())) {return Err("NETWORK_MISMATCH".into());}
    if *global.consensus_branch_id()!=branch {return Err("NETWORK_MISMATCH".into());}
    let version=match (*global.tx_version(),*global.version_group_id()) {
        (5,V5_VERSION_GROUP_ID)=>TxVersion::V5,(6,V6_VERSION_GROUP_ID)=>TxVersion::V6,
        _=>return Err("UNSUPPORTED_VERSION".into()),
    };
    if !version.valid_in_branch(BranchId::try_from(branch).map_err(|_|"NETWORK_MISMATCH")?) {return Err("NETWORK_MISMATCH".into());}
    for (pool,upgrade) in [(PoolType::SAPLING,NetworkUpgrade::Sapling),(PoolType::IRONWOOD,NetworkUpgrade::Nu6_3)] {
        if value.has_data_in_pool(pool) && !document.is_nu_active(upgrade,height.into()) {return Err("NETWORK_MISMATCH".into());}
    }
    if value.has_data_in_pool(PoolType::ORCHARD) {return Err("UNSUPPORTED_POOL".into());}
    let output=StandalonePczt {value,parameters:parameters.to_vec(),genesis:genesis.to_vec(),height,branch,maximum};
    output.serialize()?; Ok(output)
}

// Projection through upstream Input::parse, matching pczt::transparent::into_parsed.
// Only pending inputs are copied: finalized inputs have already cleared partial data.
fn transparent_complete(bundle:&zcash_transparent::pczt::Bundle)->Result<bool> {
    use zcash_transparent::pczt::{Bundle,Input};
    let mut pending=vec![];
    for input in bundle.inputs() {
        if input.script_sig().as_ref().is_some_and(|s| !s.to_bytes().is_empty()) {continue;}
        pending.push(Input::parse(*input.prevout_txid().as_ref(),*input.prevout_index(),*input.sequence(),
            *input.required_time_lock_time(),*input.required_height_lock_time(),
            input.script_sig().as_ref().map(|s|s.to_bytes()),u64::from(*input.value()),input.script_pubkey().to_bytes(),
            input.redeem_script().as_ref().map(|s|s.to_bytes()),input.partial_signatures().clone(),input.sighash_type().encode(),
            input.bip32_derivation().iter().map(|(key,path)| Ok((*key,zcash_transparent::pczt::Bip32Derivation::parse(*path.seed_fingerprint(),path.derivation_path().iter().map(|n|u32::from(*n)).collect()).map_err(|_|INVALID)?))).collect::<Result<_>>()?,input.ripemd160_preimages().clone(),input.sha256_preimages().clone(),
            input.hash160_preimages().clone(),input.hash256_preimages().clone(),input.proprietary().clone()).map_err(|_|INVALID)?);
    }
    Ok(Bundle::parse(pending,vec![]).map_err(|_|INVALID)?.finalize_spends().is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use zcash_transparent::pczt::{Bundle,Input};
    const PARAMS:&[u8]=br#"{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#;
    fn empty(branch:BranchId,coin:u32)->Pczt {
        pczt::roles::creator::Creator::new(branch.into(),200,coin,Some([0;32]),Some([0;32])).unwrap().build().unwrap()
    }
    fn open(value:Pczt,height:u32)->StandalonePczt {
        let branch=*value.global().consensus_branch_id();
        parse_standalone_pczt(PARAMS,&[3;32],height,branch,&value.serialize().unwrap(),65536).unwrap()
    }
    #[test]
    fn standalone_pczt_context_bounds_combine_redact() {
        let native=empty(BranchId::Nu6,1); let bytes=native.clone().serialize().unwrap();
        let mut junk=bytes.clone();junk.push(0);
        assert_eq!(parse_standalone_pczt(PARAMS,&[3;32],70,BranchId::Nu6.into(),&junk,65536).err().unwrap(),INVALID);
        let v2=pczt::v2::Pczt::try_from(native.clone()).unwrap().serialize();
        assert!(parse_standalone_pczt(PARAMS,&[3;32],70,BranchId::Nu6.into(),&v2,65536).is_ok());
        let handle=open(native,70); let before=handle.serialize().unwrap();
        let inspection:serde_json::Value=serde_json::from_str(&handle.inspect().unwrap()).unwrap();
        assert_eq!(inspection["pcztVersion"],1);assert_eq!(inspection["transactionVersion"],5);
        assert_eq!(inspection["proofsComplete"],true);assert_eq!(inspection["authorizationComplete"],true);
        assert_eq!(handle.serialize().unwrap(),before);
        assert_eq!(handle.combine(&open(empty(BranchId::Nu6,1),70)).unwrap().serialize().unwrap(),before);
        assert_eq!(handle.combine(&open(empty(BranchId::Nu6,1),71)).err().unwrap(),"NETWORK_MISMATCH");
        assert_eq!(parse_standalone_pczt(PARAMS,&[3;32],70,BranchId::Nu6.into(),&bytes,1).err().unwrap(),"RESOURCE_LIMIT");
        assert_eq!(parse_standalone_pczt(PARAMS,&[3;32],60,BranchId::Nu5.into(),&bytes,65536).err().unwrap(),"NETWORK_MISMATCH");
        assert_eq!(parse_standalone_pczt(PARAMS,&[3;32],70,BranchId::Nu6.into(),&empty(BranchId::Nu6,133).serialize().unwrap(),65536).err().unwrap(),"NETWORK_MISMATCH");
        assert_eq!(handle.redact("unknown").err().unwrap(),"UNSUPPORTED_VERSION");
        // Native serde representation of an upstream Creator fixture, not a second PCZT encoding.
        let mut fixture=serde_json::to_value(pczt::v1::Pczt::try_from(empty(BranchId::Nu6,1)).unwrap()).unwrap();
        fixture["global"]["proprietary"]=json!({"zcash_client_backend:proposal_info":[1,2],"other":[3]});
        let mut v4=fixture.clone();v4["global"]["tx_version"]=json!(4);v4["global"]["version_group_id"]=json!(zcash_protocol::constants::V4_VERSION_GROUP_ID);
        let unsupported=serde_json::from_value::<pczt::v1::Pczt>(v4).unwrap().serialize();
        assert_eq!(parse_standalone_pczt(PARAMS,&[3;32],70,BranchId::Nu6.into(),&unsupported,65536).err().unwrap(),"UNSUPPORTED_VERSION");
        let encoded=serde_json::from_value::<pczt::v1::Pczt>(fixture).unwrap().serialize();
        let full=parse_standalone_pczt(PARAMS,&[3;32],70,BranchId::Nu6.into(),&encoded,65536).unwrap();
        let redacted=full.redact("zakura-signer-full/1").unwrap();
        assert_eq!(full.serialize().unwrap(),encoded);
        let returned=serde_json::to_value(pczt::v1::Pczt::try_from(Pczt::parse(&redacted.serialize().unwrap()).unwrap()).unwrap()).unwrap();
        assert!(returned["global"]["proprietary"].get("zcash_client_backend:proposal_info").is_none());
        assert_eq!(returned["global"]["proprietary"]["other"],json!([3]));
        if let Ok(path)=std::env::var("PCZT_FIXTURE_PATH") {
            let (ironwood,ironwood_early)=ironwood_fixture();
            let fixture=json!({"ironwood":hex::encode(ironwood),"ironwoodEarly":hex::encode(ironwood_early),"ironwoodEarlyBranch":u32::from(BranchId::Nu5),"ironwoodHeight":100,"ironwoodBranch":u32::from(BranchId::Nu6_3),"parameters":String::from_utf8(PARAMS.to_vec()).unwrap(),"genesis":hex::encode([3;32]),"height":70,"branch":u32::from(BranchId::Nu6),
                "pczt":hex::encode(&encoded),"v2":hex::encode(v2),"v4":hex::encode(unsupported),"redacted":hex::encode(redacted.serialize().unwrap())});
            std::fs::write(path,serde_json::to_string_pretty(&fixture).unwrap()+"\n").unwrap();
        }
        assert_eq!(open(empty(BranchId::Nu6_3,1),100).inspect().unwrap().contains("\"transactionVersion\":6"),true);
    }
    fn ironwood_fixture()->(Vec<u8>,Vec<u8>) {
        let mut fixture=serde_json::to_value(pczt::v2::Pczt::try_from(empty(BranchId::Nu6_3,1)).unwrap()).unwrap();
        let zero=vec![0u8;32];
        fixture["ironwood"]=json!({"actions":[{"cv_net":zero,"spend":{"nullifier":zero,"rk":zero,"proprietary":{}},
            "output":{"cmx":zero,"ephemeral_key":zero,"enc_ciphertext":{"Encrypted":[]},"out_ciphertext":[],"proprietary":{}}}],
            "flags":3,"value_sum":[0,true],"anchor":zero,"note_version":"V3"});
        let bytes=serde_json::from_value::<pczt::v2::Pczt>(fixture.clone()).unwrap().serialize();
        fixture["global"]["consensus_branch_id"]=json!(u32::from(BranchId::Nu5));
        fixture["global"]["tx_version"]=json!(5);fixture["global"]["version_group_id"]=json!(V5_VERSION_GROUP_ID);
        let early=serde_json::from_value::<pczt::v2::Pczt>(fixture).unwrap().serialize();
        (bytes,early)
    }
    #[test]
    fn standalone_pczt_ironwood_activation_and_material_only_flags() {
        let (bytes,early)=ironwood_fixture();
        let handle=parse_standalone_pczt(PARAMS,&[3;32],100,BranchId::Nu6_3.into(),&bytes,65536).unwrap();
        let inspection:serde_json::Value=serde_json::from_str(&handle.inspect().unwrap()).unwrap();
        assert_eq!(inspection["pools"],json!(["ironwood"]));
        assert_eq!(inspection["proofsComplete"],false);assert_eq!(inspection["authorizationComplete"],false);
        assert_eq!(parse_standalone_pczt(PARAMS,&[3;32],60,BranchId::Nu5.into(),&early,65536).err().unwrap(),"NETWORK_MISMATCH");
        assert_eq!(handle.serialize().unwrap(),bytes);
    }
    fn pending_input(count:usize)->Input {
        // Native finalizer's supported 2-of-2 P2MS-in-P2SH case. Material only,
        // deliberately not valid signatures: inspection must not claim verification.
        let keys=[[2;33],[3;33]];
        let mut redeem=vec![0x52,33];redeem.extend(keys[0]);redeem.push(33);redeem.extend(keys[1]);redeem.extend([0x52,0xae]);
        let mut script=vec![0xa9,20];script.extend([0;20]);script.push(0x87);
        let signatures=keys.into_iter().take(count).map(|key|(key,vec![1,2,3])).collect();
        let mut derivation=BTreeMap::new();
        derivation.insert(keys[0],zcash_transparent::pczt::Bip32Derivation::parse([7;32],vec![0x8000002c,0x80000001,0x80000000,0,5]).unwrap());
        Input::parse([1;32],2,Some(3),Some(500000001),Some(4),None,5,script,Some(redeem),signatures,1,
            derivation,BTreeMap::new(),BTreeMap::new(),BTreeMap::new(),BTreeMap::new(),BTreeMap::from([("preserve".into(),vec![9])])).unwrap()
    }
    #[test]
    fn standalone_pczt_transparent_material_pending_mixed_and_finalized() {
        let partial=Bundle::parse(vec![pending_input(1)],vec![]).unwrap();
        assert!(!transparent_complete(&partial).unwrap());
        assert_eq!(partial.inputs()[0].partial_signatures().len(),1);
        let mut complete=Bundle::parse(vec![pending_input(2)],vec![]).unwrap();
        assert!(transparent_complete(&complete).unwrap());
        assert!(complete.inputs()[0].script_sig().is_none());
        assert_eq!(complete.inputs()[0].bip32_derivation().len(),1);
        complete.finalize_spends().unwrap();
        assert!(transparent_complete(&complete).unwrap());
        assert!(complete.inputs()[0].partial_signatures().is_empty());
        // Move the finalized input through its public mutable slot, preserving it
        // beside a pending input without assuming Input implements Clone.
        let finalized=std::mem::replace(&mut complete.inputs_mut()[0],pending_input(0));
        let mut mixed=Bundle::parse(vec![finalized,pending_input(2)],vec![]).unwrap();
        assert!(transparent_complete(&mixed).unwrap());
        assert!(mixed.inputs()[0].script_sig().is_some());assert!(mixed.inputs()[1].script_sig().is_none());
        assert_eq!(mixed.inputs()[1].partial_signatures().len(),2);
        // Locked structural finalizer reprocesses the completed P2SH input after
        // clearing its redeem script; the pending input has all native role material.
        assert!(matches!(mixed.finalize_spends(),Err(zcash_transparent::pczt::SpendFinalizerError::MissingRedeemScript)));
    }
}
