use zakura_bindings_core::transaction_id;

#[test]
fn exact_source_vectors_and_lossy_rejection() {
    let vectors: serde_json::Value = serde_json::from_str(include_str!("transaction-vectors.json")).unwrap();
    for v in vectors.as_array().unwrap() {
        let bytes = hex::decode(v["hex"].as_str().unwrap()).unwrap();
        let id = transaction_id(&bytes, v["branch"].as_u64().unwrap() as u32).unwrap();
        assert_eq!(hex::encode(id), v["txid"].as_str().unwrap());
    }
    let lossy = hex::decode("0400008085202f89000000000000000000000100000000000000000000").unwrap();
    assert_eq!(transaction_id(&lossy, 0x76b809bb).unwrap_err(), "serialization differs from input");
}

#[test]
fn bounded_exact_supported_context() {
    let vectors: serde_json::Value = serde_json::from_str(include_str!("transaction-vectors.json")).unwrap();
    let v = vectors.as_array().unwrap().last().unwrap();
    let mut raw = hex::decode(v["hex"].as_str().unwrap()).unwrap();
    assert_eq!(transaction_id(&raw, 0xc2d6d0b4).unwrap_err(), "branch mismatch");
    raw[8..12].copy_from_slice(&0xc2d6d0b4u32.to_le_bytes());
    assert_eq!(transaction_id(&raw, 0xc2d6d0b4).unwrap_err(), "version/context mismatch");
    assert_eq!(transaction_id(&[], 0).unwrap_err(), "invalid transaction bytes");
    assert_eq!(transaction_id(&vec![0; 2097153], 0).unwrap_err(), "invalid transaction bytes");
    // Minimal parseable Sprout V1 is deliberately outside this private codec.
    assert_eq!(transaction_id(&[1,0,0,0,0,0,0,0,0,0], 0).unwrap_err(), "unsupported transaction version");
    for v in vectors.as_array().unwrap() {
        let mut raw = hex::decode(v["hex"].as_str().unwrap()).unwrap();
        let branch = v["branch"].as_u64().unwrap() as u32;
        assert_eq!(transaction_id(&raw, u32::MAX).unwrap_err(), "unknown context branch");
        for cut in (0..raw.len().min(128)).chain([raw.len()/2, raw.len()-1]) {
            assert!(transaction_id(&raw[..cut], branch).is_err());
        }
        raw.push(0);
        assert_eq!(transaction_id(&raw, branch).unwrap_err(), "trailing bytes");
    }
}
