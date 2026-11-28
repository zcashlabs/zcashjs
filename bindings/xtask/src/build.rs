use crate::{codec, generate, inputs, support::*, tools};
use serde_json::{json, Value};
use std::{env, fs, path::Path};

fn validate_paths(output: &Path, cache: &Path) -> Result<()> {
    if output.try_exists()? || output.is_symlink() {
        return Err(format!(
            "output already exists: {}; choose a new --output directory",
            output.display()
        )
        .into());
    }
    if output.starts_with(cache) || cache.starts_with(output) {
        return Err("output and cache must be separate directories".into());
    }
    Ok(())
}

pub fn build(root: &Path, output: &Path, cache: &Path) -> Result<()> {
    let output = absolute(output)?;
    let cache = absolute(cache)?;
    validate_paths(&output, &cache)?;
    tools::archives(env::consts::OS, env::consts::ARCH)?;
    let mut run = Runner::new();
    let git = |args: &[&str]| -> Result<String> {
        Ok(Runner::new().capture(root, "git", args)?.trim().into())
    };
    if !git(&["diff", "HEAD", "--"])?.is_empty() {
        return Err(
            "commit tracked source changes first so the build receipt identifies the source".into(),
        );
    }
    let revision = git(&["rev-parse", "HEAD"])?;
    let toolchain: toml::Value = fs::read_to_string(root.join("rust-toolchain.toml"))?.parse()?;
    let channel = toolchain["toolchain"]["channel"]
        .as_str()
        .ok_or("missing Rust toolchain channel")?;
    let cargo = cache.join("cargo");
    run.set("CARGO_HOME", &cargo);
    run.set("CARGO_TARGET_DIR", cache.join("target/wallet"));
    run.set("CARGO_BUILD_JOBS", "2");
    run.set("RUSTUP_TOOLCHAIN", channel);
    run.run(
        root,
        "rustup",
        &[
            "toolchain",
            "install",
            channel,
            "--profile",
            "minimal",
            "--target",
            "wasm32-unknown-unknown",
            "--no-self-update",
        ],
    )?;
    if run
        .capture(root, "node", &["-p", "process.versions.node.split('.')[0]"])?
        .trim()
        .parse::<u32>()?
        < 22
    {
        return Err("Node 22 or newer is required".into());
    }
    // Fail before downloads if the host compilation tools are missing.
    for tool in ["cc", "ar", "curl"] {
        let found = env::split_paths(&env::var_os("PATH").unwrap_or_default())
            .any(|path| path.join(tool).is_file());
        if !found {
            return Err(format!("missing prerequisite: {tool}; see BUILDING.md").into());
        }
    }
    let (sdk, bindgen) = tools::install(&run, root, &cache)?;
    run.run(root, "cargo", &["fetch", "--locked"])?;
    fs::create_dir_all(output.parent().ok_or("output has no parent")?)?;
    fs::create_dir(&output)?;
    let metadata: Value = serde_json::from_str(&run.capture(
        root,
        "cargo",
        &[
            "metadata",
            "--locked",
            "--offline",
            "--features",
            "zakura-bindings-wasm/wallet-storage",
            "--format-version",
            "1",
        ],
    )?)?;
    // The receipt covers the WASM build; packages reachable only from the native
    // front-end belong to the native (mobile) build and are excluded here.
    let tree = |args: &[&str]| -> Result<std::collections::BTreeSet<String>> {
        let mut all = vec!["tree", "--locked", "--offline", "-e", "normal,build,dev", "--target", "all", "--prefix", "none", "-f", "{p}"];
        all.extend_from_slice(args);
        Ok(run.capture(root, "cargo", &all)?.lines().filter_map(|line| {
            let line = line.split(" (").next()?.trim();
            let (name, version) = line.split_once(" v")?;
            Some(format!("{name}@{version}"))
        }).collect())
    };
    let wasm_closure = tree(&["-p", "zakura-bindings-wasm", "-p", "zakura-bindings-core", "--features", "zakura-bindings-wasm/wallet-storage"])?;
    let native_only: std::collections::BTreeSet<String> = tree(&["-p", "zakura-bindings-native"])?
        .difference(&wasm_closure).cloned().collect();
    let packages = inputs::verify(root, &cargo, &metadata, &native_only)?;
    configure_wallet(&mut run, root, &cargo, &sdk, &metadata)?;
    run.run(root, "cargo", &["test", "--locked", "--offline", "-p", "zakura-bindings-core", "--lib"])?;
    for name in ["primitive", "bundle"] {
        let mut args = vec![
            "build",
            "--locked",
            "--offline",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
            "-p",
            "zakura-bindings-wasm",
            "--lib",
        ];
        if name == "bundle" {
            args.extend(["--features", "wallet-storage"]);
        }
        run.run(root, "cargo", &args)?;
        let destination = output.join(name);
        run.run(
            root,
            text(&bindgen),
            &[
                "--target",
                "web",
                "--keep-lld-exports",
                "--out-dir",
                text(&destination),
                "--out-name",
                "bindings",
                text(&cache.join(
                    "target/wallet/wasm32-unknown-unknown/release/zakura_bindings_wasm.wasm",
                )),
            ],
        )?;
        let mut modules = vec!["bytes.mjs", "network.mjs", "transaction.mjs"];
        if name == "bundle" {
            modules.extend(["wallet.mjs", "views.mjs"]);
        }
        for module in modules {
            fs::copy(root.join(module), destination.join(module))?;
        }
    }
    copy_tree(
        &root.join("wallet-host"),
        &output.join("bundle/wallet-host"),
    )?;
    run.run(
        root,
        "node",
        &["tests/node.mjs", text(&output.join("primitive"))],
    )?;
    run.run(
        root,
        "node",
        &["tests/transaction.mjs", text(&output.join("primitive"))],
    )?;
    let inspection: Value = serde_json::from_str(&run.capture(
        root,
        "node",
        &["tests/wallet-inspect.mjs", text(&output.join("bundle"))],
    )?)?;
    if inspection["pass"] != true {
        return Err("native wallet inspection failed".into());
    }
    generate::generate(root, true)?;
    let mut codecs = json!({});
    for name in ["lightwire", "transparent-address"] {
        let source = root.join(name);
        run.set("CARGO_TARGET_DIR", cache.join("target").join(name));
        run.run(&source, "cargo", &["fetch", "--locked"])?;
        codec::build(
            &run,
            &source,
            &output.join(name),
            &cargo,
            &cache.join("target").join(name),
            &bindgen,
        )?;
        codecs[name] = sha(&output.join(name).join("receipt.json"))?.into();
    }
    if !git(&["diff", "HEAD", "--"])?.is_empty() || git(&["rev-parse", "HEAD"])? != revision {
        return Err("tracked sources changed during the build".into());
    }
    let (system, machine) = match (env::consts::OS, env::consts::ARCH) {
        ("macos", "aarch64") => ("Darwin", "arm64"),
        ("macos", arch) => ("Darwin", arch),
        (_, arch) => ("Linux", arch),
    };
    write_json(
        &output.join("build.json"),
        &json!({
            "format": "zcash-js-native-build/1",
            "complete": true,
            "revision": revision,
            "host": {"system": system, "machine": machine},
            "tree": git(&["rev-parse", "HEAD^{tree}"])?,
            "lockSha256": sha(&root.join("Cargo.lock"))?,
            "nativePolicy": {}, // No upstream crate is patched (#46); kept for receipt readers.
            "packages": packages,
            "rustc": run.capture(root, "rustc", &["-Vv"])?,
            "producerSha256": digest(&serde_json::to_vec(&inventory(&root.join("xtask/src"))?)?),
            "bindgenSha256": sha(&bindgen)?,
            "sdkClangSha256": sha(&sdk.join("bin/clang"))?,
            "inspection": inspection,
            "artifacts": inventory(&output.join("bundle"))?,
            "primitiveArtifacts": inventory(&output.join("primitive"))?,
            "codecs": codecs
        }),
    )?;
    println!("Native SDK build complete: {}", output.display());
    Ok(())
}

fn configure_wallet(
    run: &mut Runner,
    root: &Path,
    cargo: &Path,
    sdk: &Path,
    metadata: &Value,
) -> Result<()> {
    let sqlite = metadata["packages"]
        .as_array()
        .ok_or("missing packages")?
        .iter()
        .find(|p| p["name"] == "libsqlite3-sys")
        .ok_or("missing sqlite")?;
    let sqlite = Path::new(
        sqlite["manifest_path"]
            .as_str()
            .ok_or("missing sqlite manifest")?,
    )
    .parent()
    .unwrap()
    .join("sqlite3");
    run.set("WALLET_SDK", sdk);
    run.set("WALLET_SQLITE", sqlite);
    run.set("CC_wasm32_unknown_unknown", sdk.join("bin/clang"));
    run.set("AR_wasm32_unknown_unknown", sdk.join("bin/llvm-ar"));
    run.set(
        "CFLAGS_wasm32_unknown_unknown",
        format!(
            concat!(
                "--target=wasm32-wasi --sysroot={}/share/wasi-sysroot ",
                "-DSQLITE_OS_OTHER=1 -USQLITE_THREADSAFE -DSQLITE_THREADSAFE=0 ",
                "-DSQLITE_TEMP_STORE=3 -DSQLITE_OMIT_LOAD_EXTENSION=1"
            ),
            sdk.display()
        ),
    );
    run.set(
        "LIBSQLITE3_FLAGS",
        "-DSQLITE_ENABLE_MEMSYS5 -DSQLITE_ZERO_MALLOC -DLONGDOUBLE_TYPE=double -DSQLITE_OMIT_WAL",
    );
    run.set(
        "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS",
        format!(
            concat!(
                "--remap-path-prefix={}=/source --remap-path-prefix={}=/cargo ",
                "-C link-arg=--max-memory=268435456"
            ),
            root.display(),
            cargo.display()
        ),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_existing_or_overlapping_output_without_mutating_it() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = temp.path().join("cache");
        let output = temp.path().join("output");
        fs::create_dir(&output)?;
        fs::write(output.join("keep"), "keep")?;
        assert!(validate_paths(&output, &cache).is_err());
        assert_eq!(fs::read_to_string(output.join("keep"))?, "keep");
        assert!(validate_paths(&cache.join("inside"), &cache).is_err());
        assert!(validate_paths(&cache, &cache.join("inside")).is_err());
        assert!(validate_paths(&temp.path().join("fresh"), &cache).is_ok());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(temp.path(), temp.path().join("alias"))?;
            assert_eq!(absolute(&temp.path().join("alias/cache"))?, cache);
        }
        Ok(())
    }
}
