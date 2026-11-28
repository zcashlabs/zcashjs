use crate::support::{digest, inventory, sha, text, Inventory, Result};
use flate2::read::GzDecoder;
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

fn source_inventory(root: &Path) -> Result<Inventory> {
    let mut files = inventory(root)?;
    files.remove(".cargo-ok");
    files.remove(".cargo-checksum.json");
    Ok(files)
}

fn verify_archive(source: &Path, archive: &Path, checksum: &str) -> Result<Inventory> {
    if sha(archive)? != checksum {
        return Err(format!("archive checksum mismatch: {}", archive.display()).into());
    }
    let mut expected = Inventory::new();
    let mut tar = tar::Archive::new(GzDecoder::new(fs::File::open(archive)?));
    let stem = archive.file_stem().ok_or("archive has no stem")?;
    for entry in tar.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err("unsafe archive path".into());
        }
        let relative = path.strip_prefix(stem)?;
        if entry.header().entry_type().is_dir() {
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(format!("unexpected archive entry: {}", path.display()).into());
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        if expected
            .insert(text(relative).into(), digest(&bytes))
            .is_some()
        {
            return Err("duplicate archive entry".into());
        }
    }
    let actual = source_inventory(source)?;
    if expected != actual {
        return Err(format!("source differs from locked archive: {}", source.display()).into());
    }
    Ok(actual)
}

fn archive_for(cargo: &Path, source: &Path) -> Result<PathBuf> {
    let registry = source.parent().ok_or("missing registry directory")?;
    if registry.parent() != Some(cargo.join("registry/src").as_path()) {
        return Err("unexpected cached source path".into());
    }
    Ok(cargo
        .join("registry/cache")
        .join(registry.file_name().unwrap())
        .join(format!(
            "{}.crate",
            text(Path::new(source.file_name().unwrap()))
        )))
}

pub fn verify(root: &Path, cargo: &Path, metadata: &Value) -> Result<Value> {
    let lock: toml::Value = fs::read_to_string(root.join("Cargo.lock"))?.parse()?;
    let mut packages = json!({});
    for package in metadata["packages"].as_array().ok_or("missing packages")? {
        let name = package["name"].as_str().ok_or("missing package name")?;
        let version = package["version"]
            .as_str()
            .ok_or("missing package version")?;
        let source = Path::new(
            package["manifest_path"]
                .as_str()
                .ok_or("missing manifest")?,
        )
        .parent()
        .ok_or("missing source")?;
        // Workspace members (crates/*) are this repository's own sources.
        if source.starts_with(root) && package["source"].is_null() {
            continue;
        }
        let (checksum, actual) = {
            if package["source"] != "registry+https://github.com/rust-lang/crates.io-index" {
                return Err(format!("unexpected dependency source: {name}").into());
            }
            let selected = lock["package"]
                .as_array()
                .ok_or("missing locked packages")?
                .iter()
                .find(|p| {
                    p["name"].as_str() == Some(name) && p["version"].as_str() == Some(version)
                })
                .ok_or("package absent from lock")?;
            let checksum = selected["checksum"]
                .as_str()
                .ok_or("missing locked checksum")?;
            (
                checksum,
                verify_archive(source, &archive_for(cargo, source)?, checksum)?,
            )
        };
        packages[format!("{name}@{version}")] = json!({
            "checksum": checksum,
            "sourceInventorySha256": digest(&serde_json::to_vec(&actual)?)
        });
    }
    Ok(packages)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_corrupt_archive_and_modified_extra_or_linked_sources() -> Result<()> {
        let scratch = tempfile::tempdir()?;
        let source = scratch.path().join("demo-1");
        fs::create_dir(&source)?;
        fs::write(source.join("file"), "original")?;
        let archive = scratch.path().join("demo-1.crate");
        let gzip = flate2::write::GzEncoder::new(
            fs::File::create(&archive)?,
            flate2::Compression::default(),
        );
        let mut tar = tar::Builder::new(gzip);
        tar.append_dir_all("demo-1", &source)?;
        tar.into_inner()?.finish()?;
        let checksum = sha(&archive)?;
        verify_archive(&source, &archive, &checksum)?;
        assert!(verify_archive(&source, &archive, "wrong").is_err());
        fs::write(source.join("file"), "tampered")?;
        assert!(verify_archive(&source, &archive, &checksum).is_err());
        fs::write(source.join("file"), "original")?;
        fs::write(source.join("extra"), "extra")?;
        assert!(verify_archive(&source, &archive, &checksum).is_err());
        fs::remove_file(source.join("extra"))?;
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(source.join("file"), source.join("link"))?;
            assert!(verify_archive(&source, &archive, &checksum).is_err());
        }
        Ok(())
    }
}
