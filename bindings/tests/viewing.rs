#![cfg(feature = "viewing")]
use zakura_bindings_core::{viewing::*,consensus_branch};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::consensus::MAIN_NETWORK;
use zcash_address::unified::{self, Container, Encoding};
use serde_json::{json,Value};
const DOC: &[u8] = br#"{"encoding":"main","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#;
const POOLS:&str = r#"["transparent","sapling","ironwood"]"#;
const ACK:&str = "discloses-viewing-authority";
const UNIFIED:&str = r#"{"format":"unified"}"#;
fn key() -> String { UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[7;32],zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key().encode(&MAIN_NETWORK) }
fn owner() -> ViewingHandle { viewing_open(DOC,"ufvk",&key(),POOLS).unwrap() }
fn v(s: String) -> Value { serde_json::from_str(&s).unwrap() }
#[test]
fn authority_roundtrip_and_reduction() {
    let full=owner();
    assert_eq!(full.export("ufvk",ACK).unwrap(),key());
    assert_eq!(v(full.describe())["components"],json!(["p2pkh","sapling","orchard"]));
    assert!(full.export("ufvk","no").is_err());
    let incoming=full.to_incoming(); drop(full);
    assert_eq!(incoming.export("ufvk",ACK).unwrap_err(),"FULL_VIEWING_KEY_REQUIRED");
    let encoded=incoming.export("uivk",ACK).unwrap();
    let reopened=viewing_open(DOC,"uivk",&encoded,POOLS).unwrap();
    assert_eq!(v(reopened.describe())["kind"],"uivk");
    assert_eq!(reopened.find("0",UNIFIED,100).unwrap(),incoming.find("0",UNIFIED,100).unwrap());
}
#[test]
fn native_derivation_and_explicit_pool_policy() {
    let full=owner(); let a=v(full.find("0",UNIFIED,100).unwrap());
    assert_eq!(a["receiverTypes"],json!(["p2pkh","sapling","orchard"]));
    assert_eq!(full.derive(a["index"].as_str().unwrap(),UNIFIED).unwrap(),a.to_string());
    let transparent=viewing_open(DOC,"ufvk",&key(),r#"["transparent"]"#).unwrap();
    let t=v(transparent.find("0",r#"{"format":"transparent"}"#,1).unwrap());
    assert_eq!(t["intendedPools"],json!(["transparent"]));
    assert!(transparent.find("0",UNIFIED,1).is_err());
    assert_eq!(transparent.export("ufvk",ACK).unwrap(),key());
    assert_eq!(transparent.find("0",r#"{"format":"unified","transparent":"omit","sapling":"require","ironwood":"omit"}"#,1).unwrap_err(),"UNSUPPORTED_POOL");
    assert_eq!(full.find("2147483648",r#"{"format":"transparent"}"#,1).unwrap_err(),"DISCOVERY_RANGE_UNSAFE");
    for bad in ["-1","01","309485009821345068724781056"] { assert!(full.find(bad,UNIFIED,1).is_err()); }
    assert!(full.find("0",UNIFIED,0).is_err());
    assert!(full.find("0",UNIFIED,10001).is_err());
}
#[test]
fn address_receivers_context_unknown_items() {
    let a=v(owner().find("0",UNIFIED,100).unwrap()); let encoded=a["address"].as_str().unwrap();
    let decoded=v(viewing_decode_address(DOC,encoded).unwrap());
    assert_eq!(decoded["knownReceivers"],json!(["p2pkh","sapling","orchard"]));
    let branch=consensus_branch("zcash-js-network/1",DOC,100).unwrap();
    for (pool,kind,len) in [("transparent","p2pkh",40),("sapling","sapling",86),("ironwood","orchard",86)] {
        let r=v(viewing_select_receiver(DOC,encoded,pool,100,branch).unwrap());
        assert_eq!(r["type"],kind); assert_eq!(r["bytes"].as_str().unwrap().len(),len);
    }
    let before=consensus_branch("zcash-js-network/1",DOC,99).unwrap();
    assert_eq!(viewing_select_receiver(DOC,encoded,"ironwood",99,before).unwrap_err(),"UNSUPPORTED_POOL");
    assert!(viewing_select_receiver(DOC,encoded,"sapling",100,0).is_err());
    assert!(viewing_select_receiver(DOC,encoded,"legacyOrchard",100,branch).is_err());
    let (net,ua)=unified::Address::decode(encoded).unwrap(); let mut items=ua.items_as_parsed().to_vec();
    items.push(unified::Receiver::Unknown{typecode:100,data:vec![9;8]});
    let unknown=unified::Address::try_from_items(items).unwrap().encode(&net);
    assert_eq!(v(viewing_decode_address(DOC,&unknown).unwrap())["unknownTypecodes"],json!([100]));
    assert_eq!(viewing_select_receiver(DOC,&unknown,"ironwood",100,branch).unwrap(),viewing_select_receiver(DOC,encoded,"ironwood",100,branch).unwrap());
}
#[test]
fn bounded_search_and_network_admission() {
    let owner=owner();
    let invalid=(0..100).find(|j| owner.derive(&j.to_string(),UNIFIED).is_err()).unwrap();
    assert_eq!(owner.derive(&invalid.to_string(),UNIFIED).unwrap_err(),"INVALID_DIVERSIFIER");
    assert_eq!(owner.find(&invalid.to_string(),UNIFIED,1).unwrap_err(),"ADDRESS_SEARCH_LIMIT");
    let found=v(owner.find(&invalid.to_string(),UNIFIED,100).unwrap());
    assert!(found["index"].as_str().unwrap().parse::<u128>().unwrap()>invalid);
    let other=String::from_utf8(DOC.to_vec()).unwrap().replace("main","test");
    assert!(viewing_open(other.as_bytes(),"ufvk",&key(),POOLS).is_err());
    for pools in ["[]",r#"["sapling","sapling"]"#,r#"["legacyOrchard"]"#] { assert!(viewing_open(DOC,"ufvk",&key(),pools).is_err()); }
    assert!(viewing_open(DOC,"ufvk",&(key()+"\n"),POOLS).is_err());
}
#[test]
fn same_format_unknown_key_items_survive_without_unknown_routing() {
    let (net,key)=unified::Ufvk::decode(&key()).unwrap();
    let mut items=key.items_as_parsed().to_vec();
    items.push(unified::Fvk::Unknown{typecode:100,data:vec![7;8]});
    let encoded=unified::Ufvk::try_from_items(items).unwrap().encode(&net);
    let full=viewing_open(DOC,"ufvk",&encoded,POOLS).unwrap();
    assert_eq!(full.export("ufvk",ACK).unwrap(),encoded);
    // Upstream reduces only known authority; it cannot derive an unknown incoming component.
    let (net,key)=unified::Uivk::decode(&full.export("uivk",ACK).unwrap()).unwrap();
    let mut items=key.items_as_parsed().to_vec();
    items.push(unified::Ivk::Unknown{typecode:100,data:vec![8;8]});
    let encoded=unified::Uivk::try_from_items(items).unwrap().encode(&net);
    let incoming=viewing_open(DOC,"uivk",&encoded,POOLS).unwrap();
    assert_eq!(incoming.export("uivk",ACK).unwrap(),encoded);
    assert_eq!(incoming.to_incoming().export("uivk",ACK).unwrap(),encoded);
}
#[test]
fn malformed_native_shielded_receiver_is_rejected() {
    let invalid=unified::Address::try_from_items(vec![unified::Receiver::Sapling([0;43])]).unwrap().encode(&zcash_protocol::consensus::NetworkType::Main);
    assert!(viewing_decode_address(DOC,&invalid).is_err());
}
