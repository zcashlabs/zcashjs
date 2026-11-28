use crate::support::{sha, text, Result, Runner};
use flate2::read::GzDecoder;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn archives(os: &str, arch: &str) -> Result<[(&'static str, &'static str); 2]> {
    Ok(match (os, arch) {
        ("linux", "x86_64") => [
            (
                "wasi-sdk-27.0-x86_64-linux",
                "b7d4d944c88503e4f21d84af07ac293e3440b1b6210bfd7fe78e0afd92c23bc2",
            ),
            (
                "wasm-bindgen-0.2.128-x86_64-unknown-linux-musl",
                "b51f0208fdff83515a787bd8ab9ac5865ed84dabb66d0c709957bb59793c645f",
            ),
        ],
        ("macos", "aarch64") => [
            (
                "wasi-sdk-27.0-arm64-macos",
                "055c3dc2766772c38e71a05d353e35c322c7b2c6458a36a26a836f9808a550f8",
            ),
            (
                "wasm-bindgen-0.2.128-aarch64-apple-darwin",
                "67ba17f260977725c0b541b516dbb5153538140f079a900329fb6077661b47ab",
            ),
        ],
        ("macos", "x86_64") => [
            (
                "wasi-sdk-27.0-x86_64-macos",
                "163dfd47f989b1a682744c1ae1f0e09a83ff5c4bbac9dcd8546909ab54cda5a1",
            ),
            (
                "wasm-bindgen-0.2.128-x86_64-apple-darwin",
                "59d9af11d0a61b8019898d555de31153c3a50e7f1797e9849fb38589d16add43",
            ),
        ],
        _ => {
            return Err(format!(
                "unsupported build host: {os} {arch}; \
             use macOS or Linux x86_64 (Windows: x86_64 WSL2)"
            )
            .into())
        }
    })
}

pub fn install(run: &Runner, root: &Path, cache: &Path) -> Result<(PathBuf, PathBuf)> {
    let directory = cache.join("tools");
    fs::create_dir_all(&directory)?;
    let selected = archives(std::env::consts::OS, std::env::consts::ARCH)?;
    for (index, (name, checksum)) in selected.iter().enumerate() {
        let archive = directory.join(format!("{name}.tar.gz"));
        if !archive.exists() {
            let base = if index == 0 {
                "WebAssembly/wasi-sdk/releases/download/wasi-sdk-27"
            } else {
                "wasm-bindgen/wasm-bindgen/releases/download/0.2.128"
            };
            let partial = archive.with_extension("part");
            run.run(
                root,
                "curl",
                &[
                    "--fail",
                    "--location",
                    "--retry",
                    "3",
                    "--output",
                    text(&partial),
                    &format!("https://github.com/{base}/{name}.tar.gz"),
                ],
            )?;
            if sha(&partial)? != *checksum {
                fs::remove_file(partial)?;
                return Err(format!("tool download checksum mismatch: {name}").into());
            }
            fs::rename(partial, &archive)?;
        }
        if sha(&archive)? != *checksum {
            return Err(format!(
                "cached archive checksum mismatch: {}; remove it and retry",
                archive.display()
            )
            .into());
        }
        let extracted = directory.join(name);
        if extracted.exists() {
            fs::remove_dir_all(&extracted)?;
        }
        tar::Archive::new(GzDecoder::new(fs::File::open(archive)?)).unpack(&directory)?;
    }
    let sdk = directory.join(selected[0].0);
    let bindgen = directory.join(selected[1].0).join("wasm-bindgen");
    if run.capture(root, text(&bindgen), &["--version"])?.trim() != "wasm-bindgen 0.2.128" {
        return Err("unexpected wasm-bindgen version".into());
    }
    Ok((sdk, bindgen))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_tool_cache_is_rejected_before_extraction() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let directory = temp.path().join("tools");
        fs::create_dir(&directory)?;
        let selected = archives(std::env::consts::OS, std::env::consts::ARCH)?;
        fs::write(
            directory.join(format!("{}.tar.gz", selected[0].0)),
            "corrupt",
        )?;
        let error = install(&Runner::new(), temp.path(), temp.path()).unwrap_err();
        assert!(error
            .to_string()
            .contains("cached archive checksum mismatch"));
        assert!(!directory.join(selected[0].0).exists());
        Ok(())
    }
    #[test]
    fn supported_hosts() {
        for (os, arch, wasi, bindgen) in [
            (
                "linux",
                "x86_64",
                "x86_64-linux",
                "x86_64-unknown-linux-musl",
            ),
            ("macos", "aarch64", "arm64-macos", "aarch64-apple-darwin"),
            ("macos", "x86_64", "x86_64-macos", "x86_64-apple-darwin"),
        ] {
            let pair = archives(os, arch).unwrap();
            assert!(pair[0].0.ends_with(wasi));
            assert!(pair[1].0.ends_with(bindgen));
            assert!(pair.iter().all(|(_, hash)| hash.len() == 64));
        }
        assert!(archives("windows", "x86_64").is_err());
        assert!(archives("linux", "aarch64").is_err());
    }
}
