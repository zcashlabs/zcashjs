use crate::{inputs, support::*};
use serde_json::json;
use std::{fs, path::Path};

pub fn build(
    run: &Runner,
    source: &Path,
    output: &Path,
    cargo: &Path,
    target: &Path,
    bindgen: &Path,
) -> Result<()> {
    let snapshot = inventory(source)?;
    fs::create_dir(output)?;
    let receipt_path = output.join("receipt.json");
    let mut receipt = json!({"status": "incomplete", "source": snapshot});
    write_json(&receipt_path, &receipt)?;
    let log = |name: &str, program: &str, args: &[&str]| -> Result<()> {
        run.log(source, &output.join(format!("{name}.log")), program, args)?;
        if inventory(source)? != snapshot {
            return Err(format!("source mutated during {name}").into());
        }
        Ok(())
    };
    log("rustc", "rustc", &["-vV"])?;
    log("cargo", "cargo", &["--version"])?;
    log("bindgen-version", text(bindgen), &["--version"])?;
    receipt["bindgen_sha256"] = sha(bindgen)?.into();
    let mut tool_hashes = json!({});
    for tool in ["rustc", "cargo"] {
        let path = run.capture(source, "rustup", &["which", tool])?;
        tool_hashes[path.trim()] = sha(Path::new(path.trim()))?.into();
    }
    receipt["tools"] = tool_hashes;
    let sysroot = run.capture(source, "rustc", &["--print", "sysroot"])?;
    let libraries = Path::new(sysroot.trim()).join("lib/rustlib/wasm32-unknown-unknown/lib");
    let mut hashes = json!({});
    for (name, hash) in inventory(&libraries)? {
        hashes[text(&libraries.join(name))] = hash.into();
    }
    if hashes.as_object().unwrap().is_empty() {
        return Err("missing installed wasm target libraries".into());
    }
    receipt["target_libraries"] = hashes;
    log(
        "metadata",
        "cargo",
        &[
            "metadata",
            "--locked",
            "--offline",
            "--format-version",
            "1",
            "--filter-platform",
            "wasm32-unknown-unknown",
        ],
    )?;
    let metadata = json(&output.join("metadata.log"))?;
    let packages = inputs::verify(source, cargo, &metadata)?;
    let mut graph = Vec::new();
    for package in metadata["packages"].as_array().unwrap() {
        if package["source"].is_null() {
            continue;
        }
        let name = package["name"].as_str().unwrap();
        let version = package["version"].as_str().unwrap();
        graph.push(json!({
            "name": name,
            "version": version,
            "source": package["source"],
            "checksum": packages[format!("{name}@{version}")]["checksum"]
        }));
    }
    receipt["graph"] = graph.into();
    receipt["metadata_sha256"] = sha(&output.join("metadata.log"))?.into();
    receipt["graph_sha256"] = digest(&serde_json::to_vec(&metadata["resolve"])?).into();
    log("native", "cargo", &["test", "--locked", "--offline"])?;
    log(
        "wasm",
        "cargo",
        &[
            "build",
            "--locked",
            "--offline",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
        ],
    )?;
    let crate_name = if source.ends_with("lightwire") {
        "zakura_lightwire"
    } else {
        "zakura_transparent_address"
    };
    let wasm = target.join(format!("wasm32-unknown-unknown/release/{crate_name}.wasm"));
    log(
        "bindgen",
        text(bindgen),
        &[
            "--target",
            "web",
            "--out-dir",
            text(&output.join("wasm")),
            text(&wasm),
        ],
    )?;
    fs::copy(source.join("codec.mjs"), output.join("codec.mjs"))?;
    let mut artifacts = Inventory::from([("codec.mjs".into(), sha(&output.join("codec.mjs"))?)]);
    for (name, hash) in inventory(&output.join("wasm"))? {
        artifacts.insert(format!("wasm/{name}"), hash);
    }
    receipt["raw_wasm_sha256"] = sha(&wasm)?.into();
    receipt["artifacts"] = serde_json::to_value(artifacts)?;
    inputs::verify(source, cargo, &metadata)?;
    if inventory(source)? != snapshot {
        return Err("source mutated before completion".into());
    }
    receipt["status"] = "built".into();
    write_json(&receipt_path, &receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn source_mutation_leaves_only_an_incomplete_receipt() -> Result<()> {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir()?;
        let source = temp.path().join("source");
        let bin = temp.path().join("bin");
        fs::create_dir(&source)?;
        fs::create_dir(&bin)?;
        fs::write(source.join("codec.mjs"), "original")?;
        let rustc = bin.join("rustc");
        fs::write(&rustc, "#!/bin/sh\nprintf mutated > codec.mjs\n")?;
        fs::set_permissions(&rustc, fs::Permissions::from_mode(0o755))?;
        let mut run = Runner::new();
        run.set("PATH", &bin);
        let output = temp.path().join("output");
        let error = build(
            &run,
            &source,
            &output,
            temp.path(),
            temp.path(),
            temp.path(),
        )
        .unwrap_err();
        assert!(error.to_string().contains("source mutated during rustc"));
        assert_eq!(json(&output.join("receipt.json"))?["status"], "incomplete");
        assert!(!output.join("wasm").exists());
        assert!(!output.join("build.json").exists());
        Ok(())
    }
}
