//! Native proving of a retained artifact; immutable publication reuses import.
use super::accounts::{Failure,Result};
use sha2::{Digest,Sha256};

// Canonical Sapling parameters, checked against zakura-proofs 1.0.0's BLAKE2b
// constants before these SHA256 pins were recorded. No parameter downloads.
fn parameters(bytes:&[u8],size:usize,digest:&str)->Result<()> {
    if bytes.is_empty(){return Err("PROVING_MATERIAL_REQUIRED".into());}
    if bytes.len()!=size||hex::encode(Sha256::digest(bytes))!=digest{return Err("ASSET_INTEGRITY".into());}
    Ok(())
}
pub(super) fn sapling_parameters(spend:&[u8],output:&[u8])->Result<(sapling::circuit::SpendParameters,sapling::circuit::OutputParameters)> {
    parameters(spend,47958396,"8e48ffd23abb3a5fd9c5589204f32d9c31285a04b78096ba40a79b75677efc13")?;
    parameters(output,3592860,"2f0ebbcbb9bb0bcffe95a397e7eba89c29eb4dde6191c339db88570e3f3fb0e4")?;
    // Full canonical digest checks above qualify the upstream unchecked-point read.
    let spend=sapling::circuit::SpendParameters::read(spend,false).map_err(|_|Failure::from("ASSET_INTEGRITY"))?;
    let output=sapling::circuit::OutputParameters::read(output,false).map_err(|_|Failure::from("INVALID_ARGUMENT"))?;
    Ok((spend,output))
}
fn prove(value:pczt::Pczt,spend:&[u8],output:&[u8])->Result<pczt::Pczt> {
    let mut role=pczt::roles::prover::Prover::new(value);
    if role.requires_orchard_proof(){return Err("ROLE_PRECONDITION".into());}
    if role.requires_sapling_proofs(){
        let (spend,output)=sapling_parameters(spend,output)?;
        role=role.create_sapling_proofs(&spend,&output).map_err(|_|Failure::from("ROLE_PRECONDITION"))?;
    }
    if role.requires_ironwood_proof(){
        let key=orchard::circuit::ProvingKey::build(orchard::circuit::OrchardCircuitVersion::PostNu6_3).map_err(|_|Failure::from("ROLE_PRECONDITION"))?;
        role=role.create_ironwood_proof(&key).map_err(|_|Failure::from("ROLE_PRECONDITION"))?;
    }
    Ok(role.finish())
}

pub fn pczt_prove_call(generation:u32,operation_id:&str,artifact_id:&str,spend:&[u8],output:&[u8],maximum:u32)->std::result::Result<String,String>{
    if maximum==0||maximum>4194304{return Err("RESOURCE_LIMIT".into());}
    let retained=super::pczt_build::pczt_build_call(generation,"pczt_get_artifact",&serde_json::json!({"operationId":operation_id,"artifactId":artifact_id}).to_string())?;
    let retained:serde_json::Value=serde_json::from_str(&retained).map_err(|_|"STORAGE_ERROR")?;
    let bytes=hex::decode(retained["bytes"].as_str().ok_or("INVALID_PCZT")?).map_err(|_|"STORAGE_ERROR")?;
    if bytes.len()>maximum as usize{return Err("RESOURCE_LIMIT".into());}
    let value=pczt::Pczt::parse(&bytes).map_err(|_|"STORAGE_ERROR")?;
    let proven=prove(value,spend,output).map_err(|e|e.0)?.serialize().map_err(|_|"INVALID_PCZT")?;
    // Synchronous native execution; no wallet mutation occurs until import's
    // existing effects/signature checks and atomic immutable-version insertion.
    super::pczt_build::pczt_import_call(generation,operation_id,&proven,maximum)
}
