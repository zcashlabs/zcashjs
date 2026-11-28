use zakura_transparent_address::decode;
use zcash_address::ZcashAddress;

#[test]
fn source_vectors_and_families() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!("fixtures.json")).unwrap();
    for v in fixtures["positive"].as_array().unwrap() {
        let address = v["address"].as_str().unwrap();
        for family in ["main", "test", "regtest"] {
            let result = decode(address, family);
            if (family == "main") == (v["family"] == "main") {
                let result = result.unwrap();
                assert_eq!(result.canonical, address);
                assert_eq!(result.kind, v["kind"]);
                assert_eq!(hex::encode(result.payload), v["hex"]);
            } else { assert!(result.is_err()); }
        }
    }
    for address in fixtures["unsupported"].as_array().unwrap() {
        for family in ["main", "test", "regtest"] {
            assert!(decode(address.as_str().unwrap(), family).is_err());
        }
    }
}

#[test]
fn strict_token_and_native_whitespace_difference() {
    let address = "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs";
    for token in [format!(" {address}"),format!("{address}\n"),format!("\u{2003}{address}")] {
        assert_eq!(ZcashAddress::try_from_encoded(&token).unwrap().encode(), address);
        assert!(decode(&token,"main").is_err());
    }
    for token in ["".to_owned(),"t".repeat(129),"t".repeat(128),address[..34].to_owned(),format!("1{address}"),format!("{}1",&address[..34]),address.replace('t',"T"),format!("{address}\0"),format!("{address}é")] {
        assert!(decode(&token,"main").is_err(),"{token}");
    }
    assert!(decode(address,"Main").is_err());
}
