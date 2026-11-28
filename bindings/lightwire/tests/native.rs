use zakura_lightwire::encode_request;
#[test]
fn balance_is_unary_address_list() {
    assert_eq!(encode_request("GetTaddressBalance", r#"{"addresses":["a","bc"]}"#).unwrap(), [10,1,97,10,2,98,99]);
}
#[test]
fn exact_method_requests() {
    for method in ["GetLatestBlock", "GetLightdInfo", "GetMempoolStream"] {
        assert!(encode_request(method, "{}").unwrap().is_empty());
    }
    assert_eq!(encode_request("GetTreeState", r#"{"height":"18446744073709551615","hash":"0102"}"#).unwrap(), [8,255,255,255,255,255,255,255,255,255,1,18,2,1,2]);
    assert_eq!(encode_request("GetTransaction", r#"{"hash":"aabb"}"#).unwrap(), [26,2,170,187]);
    assert_eq!(encode_request("SendTransaction", r#"{"data":"abcd","height":"0"}"#).unwrap(), [10,2,171,205]);
    assert_eq!(encode_request("GetAddressUtxos", r#"{"addresses":["a"],"start_height":"3","max_entries":2}"#).unwrap(), [10,1,97,16,3,24,2]);
    assert_eq!(encode_request("GetSubtreeRoots", r#"{"start_index":3,"shielded_protocol":2,"max_entries":1}"#).unwrap(), [8,3,16,2,24,1]);
    assert_eq!(encode_request("GetBlockRange", r#"{"start":{"height":"1"},"end":{"height":"2"}}"#).unwrap(), [10,2,8,1,18,2,8,2]);
    assert_eq!(encode_request("GetTaddressTransactions", r#"{"address":"a","range":{"start":{"height":"1"},"end":{"height":"2"}}}"#).unwrap(), [10,1,97,18,8,10,2,8,1,18,2,8,2]);
}
#[test]
fn response_and_item_decoding_preserves_wire_values() {
    use zakura_lightwire::{decode_response,decode_item};
    let value = |s: String| serde_json::from_str::<serde_json::Value>(&s).unwrap();
    assert_eq!(value(decode_response("GetLatestBlock", &[8,1,18,2,1,2]).unwrap())["hash"], "0102");
    assert_eq!(value(decode_response("GetTaddressBalance", &[8,255,255,255,255,255,255,255,255,127]).unwrap())["value_zat"], "9223372036854775807");
    assert_eq!(value(decode_response("GetTransaction", &[16,255,255,255,255,255,255,255,255,255,1]).unwrap())["height"], "18446744073709551615");
    for m in ["GetLightdInfo","GetAddressUtxos","GetTreeState","SendTransaction"] { assert!(decode_response(m, &[]).is_ok(), "{m}"); }
    for m in ["GetSubtreeRoots","GetBlockRange","GetTaddressTransactions","GetMempoolStream"] { assert!(decode_item(m, &[]).is_ok(), "{m}"); assert!(decode_response(m, &[]).is_err()); }
    assert!(decode_item("GetLatestBlock", &[]).is_err());
}
#[test]
fn hostile_wire_rejected_before_decode() {
    use zakura_lightwire::decode_response;
    for wire in [vec![8,128], vec![0], vec![15], vec![10,0], vec![18,255,255,255,255,15], vec![8,255,255,255,255,255,255,255,255,255,2], vec![128,128,128,128,16,0]] {
        assert!(decode_response("GetLatestBlock", &wire).is_err(), "{wire:?}");
    }
    assert!(decode_response("GetLightdInfo", &[10,1,255]).is_err());
    assert!(decode_response("SendTransaction", &[8,128,128,128,128,16]).is_err());
    assert!(decode_response("GetTreeState", &[32,128,128,128,128,16]).is_err());
    assert!(decode_response("GetLatestBlock", &vec![8,0].repeat(8193)).is_err());
    assert!(decode_response("GetLatestBlock", &vec![0;4*1024*1024+1]).is_err());
}
#[test]
fn hostile_dto_rejected_before_encoding() {
    for input in [r#"{"height":9007199254740993}"#, r#"{"height":"01"}"#, r#"{"height":"18446744073709551616"}"#, r#"{"height":"-1"}"#, r#"{"hash":"AA"}"#,r#"{"hash":"a"}"#,r#"{"height":"1","height":"2"}"#,r#"{"unknown":true}"#,"null", "[]"] {
        assert!(encode_request("GetTreeState", input).is_err(), "{input}");
    }
    let many = format!("{{\"addresses\":[{}]}}", vec!["\"a\"";8193].join(","));
    assert!(encode_request("GetTaddressBalance", &many).is_err());
    let large = format!("{{\"data\":\"{}\"}}", "aa".repeat(1024*1024+1));
    assert!(encode_request("SendTransaction", &large).is_err());
    assert!(encode_request("GetTaddressBalanceStream", "{}").is_err());
}
#[test]
fn forward_fields_and_nested_resource_limits() {
    use zakura_lightwire::{decode_response,decode_item};
    // Unknown varint, fixed64, length-delimited, group, fixed32: valid protobuf.
    for tail in [vec![160,6,1], vec![161,6,0,0,0,0,0,0,0,0], vec![162,6,2,255,255], vec![163,6,8,1,164,6], vec![165,6,0,0,0,0]] {
        assert!(decode_response("GetLatestBlock", &tail).is_ok(), "{tail:?}");
        for end in 1..tail.len() { assert!(decode_response("GetLatestBlock", &tail[..end]).is_err(), "{tail:?} at {end}"); }
    }
    assert!(decode_response("GetLatestBlock", &[163,6,172,6]).is_err());
    // Uint32 must not truncate; nested compact block -> transaction -> input.
    assert!(decode_item("GetBlockRange", &[58,8,58,6,16,128,128,128,128,16]).is_err());
    assert!(encode_request("GetBlockRange", r#"{"start":[]}"#).is_err());
    // Valid negative int64 and signed int32 remain exact protocol values.
    let negative = [8,255,255,255,255,255,255,255,255,255,1];
    assert!(decode_response("SendTransaction", &negative).unwrap().contains("-1"));
    assert!(decode_response("GetTaddressBalance", &negative).unwrap().contains("\"-1\""));
}
#[test]
fn independently_generated_python_vectors() {
    use zakura_lightwire::{decode_response,decode_item};
    let fixtures: serde_json::Value = serde_json::from_str(include_str!("golden.json")).unwrap();
    for f in fixtures.as_array().unwrap() {
        let method = f["method"].as_str().unwrap();
        let hex = f["hex"].as_str().unwrap();
        let wire: Vec<u8> = hex.as_bytes().chunks_exact(2).map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap(),16).unwrap()).collect();
        match f["direction"].as_str().unwrap() {
            "request" => assert_eq!(encode_request(method,&f["dto"].to_string()).unwrap(),wire,"{method}"),
            kind => {
                let json = if kind=="item" { decode_item(method,&wire) } else { decode_response(method,&wire) }.unwrap();
                assert_eq!(serde_json::from_str::<serde_json::Value>(&json).unwrap(),f["dto"],"{method}");
            }
        }
    }
}
#[test]
fn independent_malformed_prefixes() {
    use zakura_lightwire::{decode_response,decode_item};
    let fixtures: serde_json::Value = serde_json::from_str(include_str!("malformed.json")).unwrap();
    let mut count=0;
    for f in fixtures.as_array().unwrap() {
        let method=f["method"].as_str().unwrap();
        let wire: Vec<u8> = f["hex"].as_str().unwrap().as_bytes().chunks_exact(2).map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap(),16).unwrap()).collect();
        for end in f["cuts"].as_array().unwrap() {
            let bytes=&wire[..end.as_u64().unwrap() as usize];
            let result=if f["direction"]=="item" { decode_item(method,bytes) } else { decode_response(method,bytes) };
            assert!(result.is_err(),"{method} prefix {end}");count+=1;
        }
    }
    assert_eq!(count,1638);
}
#[test]
fn duplicated_nested_messages_cannot_amplify_without_a_bound() {
    use zakura_lightwire::{decode_item,decode_response};
    // Each empty transaction allocates a message even though its encoded body is empty.
    assert!(decode_item("GetBlockRange",&[58,0].repeat(8192)).is_ok());
    assert!(decode_item("GetBlockRange",&[58,0].repeat(8193)).is_err());
    // Duplicate singular chain metadata messages merge, preserving earlier distinct fields.
    let v: serde_json::Value=serde_json::from_str(&decode_item("GetBlockRange",&[66,2,8,1,66,2,16,2]).unwrap()).unwrap();
    assert_eq!(v["chain_metadata"]["sapling_commitment_tree_size"],1);
    assert_eq!(v["chain_metadata"]["orchard_commitment_tree_size"],2);
    assert!(decode_item("GetBlockRange",&[66,2,8,1].repeat(4097)).is_err());
    // Unknown nested groups count toward the same recursion/field budgets.
    let mut groups=vec![163,6].repeat(17);groups.extend([164,6].repeat(17));
    assert!(decode_response("GetLatestBlock",&groups).is_err());
}

#[test]
fn tree_state_response_encoding_preserves_pinned_fields_and_bounds() {
    use zakura_lightwire::{encode_tree_state, decode_response};
    let vectors: serde_json::Value = serde_json::from_str(include_str!("golden.json")).unwrap();
    let vector = vectors.as_array().unwrap().iter().find(|v| v["method"] == "GetTreeState" && v["direction"] == "response").unwrap();
    let bytes = encode_tree_state(&vector["dto"].to_string()).unwrap();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, vector["hex"].as_str().unwrap());
    let decoded: serde_json::Value = serde_json::from_str(&decode_response("GetTreeState", &bytes).unwrap()).unwrap();
    assert_eq!(decoded, vector["dto"]);
    for text in [r#"{"height":"01"}"#, r#"{"height":1}"#, r#"{"time":4294967296}"#,
        r#"{"orchard_tree":null}"#, r#"{"time":1,"time":2}"#, r#"{"unknown":0}"#, "[]"] {
        assert!(encode_tree_state(text).is_err(), "{text}");
    }
    assert!(encode_tree_state(&format!("{{\"orchard_tree\":\"{}\"}}", "a".repeat(1024*1024+1))).is_err());
}
