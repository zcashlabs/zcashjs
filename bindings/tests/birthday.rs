#![cfg(feature="birthday")]
use zakura_bindings_core::birthday::validate_birthday;
use zcash_client_backend::proto::service::TreeState;
use prost::Message;
const DOC:&[u8]=br#"{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#;
#[test]
fn birthday_uses_native_tree_validation_and_exact_boundaries() {
    let mut tree=TreeState{network:"regtest".into(),height:0,hash:"03".repeat(32),..Default::default()};
    assert!(validate_birthday(DOC,&[3;32],1,&tree.encode_to_vec(),None).is_ok());
    assert_eq!(validate_birthday(DOC,&[4;32],1,&tree.encode_to_vec(),None).unwrap_err(),"NETWORK_MISMATCH");
    assert_eq!(validate_birthday(DOC,&[3;32],0,&tree.encode_to_vec(),None).unwrap_err(),"INVALID_BIRTHDAY");
    tree.height=99;tree.hash="07".repeat(32);tree.sapling_tree="000000".into();tree.orchard_tree="000000".into();
    assert!(validate_birthday(DOC,&[3;32],100,&tree.encode_to_vec(),Some(100)).is_ok());
    assert_eq!(validate_birthday(DOC,&[3;32],100,&tree.encode_to_vec(),Some(99)).unwrap_err(),"INVALID_BIRTHDAY");
    assert_eq!(validate_birthday(DOC,&[3;32],99,&tree.encode_to_vec(),None).unwrap_err(),"INVALID_BIRTHDAY");
    tree.sapling_tree.clear();assert_eq!(validate_birthday(DOC,&[3;32],100,&tree.encode_to_vec(),None).unwrap_err(),"INVALID_BIRTHDAY");
    assert_eq!(validate_birthday(DOC,&[3;32],100,&[0],None).unwrap_err(),"INVALID_BIRTHDAY");
}

#[test]
fn birthday_genesis_uses_protocol_bytes_and_display_tree_hash() {
    let genesis:[u8;32]=std::array::from_fn(|i|i as u8);
    let tree=TreeState{network:"regtest".into(),height:0,hash:hex::encode(genesis.iter().copied().rev().collect::<Vec<_>>()),..Default::default()};
    assert!(validate_birthday(DOC,&genesis,1,&tree.encode_to_vec(),None).is_ok());
    let reversed:Vec<u8>=genesis.iter().copied().rev().collect();
    assert_eq!(validate_birthday(DOC,&reversed,1,&tree.encode_to_vec(),None).unwrap_err(),"NETWORK_MISMATCH");
}
