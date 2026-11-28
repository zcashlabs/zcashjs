//! Native storage through the public call path: ownership, encryption admission,
//! tamper detection and reopen.
use zakura_bindings_native::wire::{self, Value};

const PARAMS: &str = r#"{"encoding":"regtest","Overwinter":10,"Sapling":20,"Blossom":30,"Heartwood":40,"Canopy":50,"Nu5":60,"Nu6":70,"Nu6_1":80,"Nu6_2":90,"Nu6_3":100}"#;

fn args(values: &[Value]) -> Vec<u8> {
    let mut out = Vec::new();
    for value in values { wire::encode_value(&mut out, value); }
    out
}
fn outcome(bytes: Vec<u8>) -> Result<Value, (u8, String)> {
    let mut decoded = wire::decode_args(&bytes[1..]).expect("result encoding");
    let value = decoded.remove(0);
    match (bytes[0], value) {
        (0, v) => Ok(v),
        (status, Value::Str(s)) => Err((status, s)),
        (status, other) => Err((status, format!("{other:?}"))),
    }
}
fn open(runtime: u64, dir: &std::path::Path, key: Option<[u8; 32]>) -> Result<u32, String> {
    let key = key.map_or(Value::None, |k| Value::Bytes(k.to_vec()));
    let request = args(&[Value::Str(dir.to_str().unwrap().into()), Value::Str("zcash-js-network/1".into()),
        Value::Bytes(PARAMS.as_bytes().to_vec()), Value::Bytes(vec![3; 32]), key]);
    match outcome(zakura_bindings_native::call(runtime, "storage_initialize_native", &request)) {
        Ok(Value::U32(generation)) => Ok(generation),
        Ok(other) => panic!("unexpected {other:?}"),
        Err((_, code)) => Err(code),
    }
}
fn close(runtime: u64, generation: u32) {
    outcome(zakura_bindings_native::call(runtime, "storage_close", &args(&[Value::U32(generation)]))).expect("close");
}
fn scratch(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("zakura-native-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn encrypted_storage_admission_ownership_and_reopen() {
    let root = scratch("admission");
    let dir = root.join("wallet");
    let runtime = zakura_bindings_native::runtime_create().unwrap();
    let key = [7u8; 32];
    let first = open(runtime, &dir, Some(key)).unwrap();
    assert_eq!(open(runtime, &dir, Some(key)), Err("STORAGE_BUSY".into()));
    // A second runtime (another JS runtime or process) cannot take ownership either.
    let other = zakura_bindings_native::runtime_create().unwrap();
    assert_eq!(open(other, &dir, Some(key)), Err("STORAGE_BUSY".into()));
    close(runtime, first);
    assert_eq!(open(runtime, &dir, Some([8u8; 32])), Err("STORAGE_KEY_MISMATCH".into()));
    assert_eq!(open(runtime, &dir, None), Err("STORAGE_KEY_MISMATCH".into()));
    let header = std::fs::read(dir.join("wallet.db")).unwrap();
    assert_eq!(&header[..8], b"ZJSWENC1");
    assert!(!header.windows(16).any(|w| w == b"SQLite format 3\0"), "plaintext SQLite header on disk");
    let again = open(other, &dir, Some(key)).unwrap();
    close(other, again);
    // A plaintext wallet refuses a key.
    let plain = root.join("plain");
    let generation = open(runtime, &plain, None).unwrap();
    close(runtime, generation);
    assert_eq!(open(runtime, &plain, Some(key)), Err("STORAGE_KEY_MISMATCH".into()));
    zakura_bindings_native::runtime_destroy(runtime);
    zakura_bindings_native::runtime_destroy(other);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn tampered_ciphertext_never_opens_as_data() {
    let root = scratch("tamper");
    let dir = root.join("wallet");
    let runtime = zakura_bindings_native::runtime_create().unwrap();
    let key = [9u8; 32];
    let generation = open(runtime, &dir, Some(key)).unwrap();
    close(runtime, generation);
    let path = dir.join("wallet.db");
    let mut bytes = std::fs::read(&path).unwrap();
    // Flip one ciphertext byte inside the first block (after the 64-byte header + nonce).
    bytes[64 + 12 + 100] ^= 1;
    std::fs::write(&path, &bytes).unwrap();
    let reopened = open(runtime, &dir, Some(key));
    assert!(reopened.is_err(), "tampered database opened: {reopened:?}");
    zakura_bindings_native::runtime_destroy(runtime);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn directories_must_be_private_and_absolute() {
    let root = scratch("paths");
    let runtime = zakura_bindings_native::runtime_create().unwrap();
    assert_eq!(open(runtime, std::path::Path::new("relative/wallet"), None), Err("INVALID_ARGUMENT".into()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let shared = root.join("shared");
        std::fs::create_dir(&shared).unwrap();
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(open(runtime, &shared, None), Err("STORAGE_ERROR".into()));
    }
    zakura_bindings_native::runtime_destroy(runtime);
    std::fs::remove_dir_all(&root).unwrap();
}
