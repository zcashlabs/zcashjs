//! `cargo xtask build-mobile`: zakura-bindings-native for React Native.
//!
//! - android: arm64-v8a and x86_64 shared libraries (jniLibs layout), via the NDK in
//!   ANDROID_NDK_HOME (API level 24).
//! - ios (macOS only): static libraries for device and simulator, packaged as
//!   ZakuraNative.xcframework with the C header.
//! - host: the host shared library and test bridge (pipeline check, parity tests).
//!
//! Every library is stamped with the source revision and the dependency-graph digest
//! (reported by `identity()`), and `native-build.json` records artifact hashes,
//! toolchains and targets.
use crate::support::*;
use serde_json::{json, Value};
use std::{env, fs, path::Path};

const ANDROID_API: u32 = 24;
const ANDROID: &[(&str, &str, &str)] = &[
    ("aarch64-linux-android", "arm64-v8a", "aarch64-linux-android"),
    ("x86_64-linux-android", "x86_64", "x86_64-linux-android"),
];
const IOS_DEVICE: &str = "aarch64-apple-ios";
const IOS_SIMULATOR: &[&str] = &["aarch64-apple-ios-sim", "x86_64-apple-ios"];

pub fn build(root: &Path, output: &Path, cache: &Path, targets: &[String]) -> Result<()> {
    let output = absolute(output)?;
    let cache = absolute(cache)?;
    if output.try_exists()? {
        return Err(format!("output already exists: {}", output.display()).into());
    }
    let git = |args: &[&str]| -> Result<String> { Ok(Runner::new().capture(root, "git", args)?.trim().into()) };
    if !git(&["diff", "HEAD", "--"])?.is_empty() {
        return Err("commit tracked source changes first so the build receipt identifies the source".into());
    }
    let revision = git(&["rev-parse", "HEAD"])?;
    let toolchain: toml::Value = fs::read_to_string(root.join("rust-toolchain.toml"))?.parse()?;
    let channel = toolchain["toolchain"]["channel"].as_str().ok_or("missing Rust toolchain channel")?;
    let mut run = Runner::new();
    run.set("RUSTUP_TOOLCHAIN", channel);
    run.set("CARGO_TARGET_DIR", cache.join("target/native"));
    run.set("ZAKURA_NATIVE_REVISION", &revision);
    // The graph digest covers exactly what the native library links.
    let graph = run.capture(root, "cargo", &["tree", "--locked", "-p", "zakura-bindings-native", "-e", "normal,build",
        "--target", "all", "--prefix", "none", "-f", "{p}"])?;
    let mut lines: Vec<&str> = graph.lines().map(|l| l.trim_end_matches(" (*)")).collect();
    lines.sort_unstable();
    lines.dedup();
    let graph_sha = digest(lines.join("\n").as_bytes());
    run.set("ZAKURA_NATIVE_GRAPH_SHA256", &graph_sha);
    fs::create_dir_all(&output)?;
    let mut artifacts = json!({});
    fn record(artifacts: &mut Value, name: String, path: &Path) -> Result<()> {
        artifacts[name] = sha(path)?.into();
        Ok(())
    }
    let cargo = |run: &Runner, target: Option<&str>, kind: &[&str]| -> Result<()> {
        let mut args = vec!["build", "--locked", "--profile", "mobile", "-p", "zakura-bindings-native"];
        args.extend_from_slice(kind);
        if let Some(target) = target { args.extend(["--target", target]); }
        run.run(root, "cargo", &args)
    };
    let built = |target: Option<&str>, file: &str| {
        let mut path = cache.join("target/native");
        if let Some(target) = target { path = path.join(target); }
        path.join("mobile").join(file)
    };
    for target in targets {
        match target.as_str() {
            "host" => {
                cargo(&run, None, &["--lib", "--bin", "zakura-native-bridge"])?;
                let dir = output.join("host");
                fs::create_dir_all(&dir)?;
                let library = format!("{}zakura_bindings_native{}", env::consts::DLL_PREFIX, env::consts::DLL_SUFFIX);
                for file in [library.as_str(), "zakura-native-bridge"] {
                    fs::copy(built(None, file), dir.join(file))?;
                    record(&mut artifacts, format!("host/{file}"), &dir.join(file))?;
                }
            }
            "android" => {
                let ndk = env::var_os("ANDROID_NDK_HOME").or_else(|| env::var_os("ANDROID_NDK_ROOT"))
                    .ok_or("android builds need ANDROID_NDK_HOME (Android NDK r26 or newer)")?;
                let host = match (env::consts::OS, env::consts::ARCH) {
                    ("linux", "x86_64") => "linux-x86_64",
                    ("macos", _) => "darwin-x86_64", // The NDK ships universal macOS binaries here.
                    other => return Err(format!("unsupported NDK host: {other:?}").into()),
                };
                let bin = Path::new(&ndk).join("toolchains/llvm/prebuilt").join(host).join("bin");
                for (triple, abi, clang) in ANDROID {
                    run.run(root, "rustup", &["target", "add", triple, "--toolchain", channel])?;
                    let mut android = Runner::new();
                    android.set("RUSTUP_TOOLCHAIN", channel);
                    android.set("CARGO_TARGET_DIR", cache.join("target/native"));
                    android.set("ZAKURA_NATIVE_REVISION", &revision);
                    android.set("ZAKURA_NATIVE_GRAPH_SHA256", &graph_sha);
                    let cc = bin.join(format!("{clang}{ANDROID_API}-clang"));
                    let env_triple = triple.replace('-', "_");
                    android.set(&format!("CC_{env_triple}"), &cc);
                    android.set(&format!("AR_{env_triple}"), bin.join("llvm-ar"));
                    android.set(&format!("CARGO_TARGET_{}_LINKER", env_triple.to_uppercase()), &cc);
                    // 16 KB page alignment is required for new Android apps (API 35+ devices).
                    android.set(&format!("CARGO_TARGET_{}_RUSTFLAGS", env_triple.to_uppercase()),
                        "-C link-arg=-Wl,-z,max-page-size=16384");
                    cargo(&android, Some(triple), &["--lib"])?;
                    let dir = output.join("android/jniLibs").join(abi);
                    fs::create_dir_all(&dir)?;
                    fs::copy(built(Some(triple), "libzakura_bindings_native.so"), dir.join("libzakura_bindings_native.so"))?;
                    record(&mut artifacts, format!("android/jniLibs/{abi}/libzakura_bindings_native.so"), &dir.join("libzakura_bindings_native.so"))?;
                }
            }
            "ios" => {
                if env::consts::OS != "macos" { return Err("ios builds need a macOS host with Xcode".into()); }
                let mut libraries = Vec::new();
                for triple in std::iter::once(IOS_DEVICE).chain(IOS_SIMULATOR.iter().copied()) {
                    run.run(root, "rustup", &["target", "add", triple, "--toolchain", channel])?;
                    cargo(&run, Some(triple), &["--lib"])?;
                    libraries.push((triple, built(Some(triple), "libzakura_bindings_native.a")));
                }
                // One fat simulator library (arm64 + x86_64), then the XCFramework.
                let staging = output.join("ios-staging");
                fs::create_dir_all(staging.join("simulator"))?;
                let simulator = staging.join("simulator/libzakura_bindings_native.a");
                let mut lipo = vec!["-create".to_string(), "-output".into(), text(&simulator).into()];
                lipo.extend(libraries.iter().filter(|(t, _)| *t != IOS_DEVICE).map(|(_, p)| text(p).to_string()));
                run.run(root, "lipo", &lipo.iter().map(String::as_str).collect::<Vec<_>>())?;
                let device = &libraries.iter().find(|(t, _)| *t == IOS_DEVICE).unwrap().1;
                let headers = root.join("crates/native/include");
                let framework = output.join("ios/ZakuraNative.xcframework");
                run.run(root, "xcodebuild", &["-create-xcframework", "-library", text(device), "-headers", text(&headers),
                    "-library", text(&simulator), "-headers", text(&headers), "-output", text(&framework)])?;
                fs::remove_dir_all(&staging)?;
                for (name, hash) in inventory(&framework)? {
                    artifacts[format!("ios/ZakuraNative.xcframework/{name}")] = hash.into();
                }
            }
            other => return Err(format!("unknown mobile target: {other} (android, ios, host)").into()),
        }
    }
    fs::create_dir_all(output.join("include"))?;
    fs::copy(root.join("crates/native/include/zakura_native.h"), output.join("include/zakura_native.h"))?;
    copy_tree(&root.join("crates/native/js"), &output.join("js"))?;
    let tools: Value = json!({
        "rustc": run.capture(root, "rustc", &["-Vv"])?,
        "ndk": env::var("ANDROID_NDK_HOME").ok().and_then(|ndk| fs::read_to_string(Path::new(&ndk).join("source.properties")).ok()),
        "xcode": if env::consts::OS == "macos" { run.capture(root, "xcodebuild", &["-version"]).ok() } else { None },
    });
    write_json(&output.join("native-build.json"), &json!({
        "format": "zakura-native-build/1",
        "revision": revision,
        "tree": git(&["rev-parse", "HEAD^{tree}"])?,
        "lockSha256": sha(&root.join("Cargo.lock"))?,
        "dependencyGraphSha256": graph_sha,
        "abiVersion": 1,
        "targets": targets,
        "androidApi": ANDROID_API,
        "tools": tools,
        "artifacts": artifacts,
        "js": inventory(&output.join("js"))?,
    }))?;
    println!("Native mobile build complete: {}", output.display());
    Ok(())
}
