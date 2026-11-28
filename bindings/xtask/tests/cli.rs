use std::process::Command;

#[test]
fn help_and_missing_prerequisite_need_no_build_side_effects() {
    let binary = env!("CARGO_BIN_EXE_xtask");
    let help = Command::new(binary)
        .arg("--help")
        .env("PATH", "")
        .output()
        .unwrap();
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("--cache"));
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("output");
    let missing = Command::new(binary)
        .args(["build", "--output"])
        .arg(&output)
        .env("PATH", "")
        .output()
        .unwrap();
    assert!(!missing.status.success());
    assert!(!output.exists());
}
