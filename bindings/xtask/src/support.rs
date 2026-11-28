use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub type Inventory = BTreeMap<String, String>;

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn sha(path: &Path) -> Result<String> {
    let mut hash = Sha256::new();
    io::copy(&mut fs::File::open(path)?, &mut hash)?;
    Ok(format!("{:x}", hash.finalize()))
}
pub fn json(path: &Path) -> Result<serde_json::Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
pub fn write_json(path: &Path, value: &serde_json::Value) -> Result<()> {
    Ok(fs::write(
        path,
        serde_json::to_string_pretty(value)? + "\n",
    )?)
}
pub fn inventory(root: &Path) -> Result<Inventory> {
    fn visit(root: &Path, directory: &Path, files: &mut Inventory) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            let kind = entry.file_type()?;
            if kind.is_symlink() {
                return Err(format!("unexpected symlink: {}", path.display()).into());
            }
            if kind.is_dir() {
                visit(root, &path, files)?;
            } else if kind.is_file() {
                files.insert(
                    path.strip_prefix(root)?
                        .to_str()
                        .ok_or("non-UTF8 path")?
                        .into(),
                    sha(&path)?,
                );
            } else {
                return Err(format!("unexpected file type: {}", path.display()).into());
            }
        }
        Ok(())
    }
    let mut files = Inventory::new();
    visit(root, root, &mut files)?;
    Ok(files)
}
pub fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    for name in inventory(source)?.keys() {
        let target = destination.join(name);
        fs::create_dir_all(target.parent().unwrap())?;
        fs::copy(source.join(name), target)?;
    }
    Ok(())
}

// Resolve existing ancestors too, so symlinks cannot bypass output/cache separation.
pub fn absolute(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return Ok(path.canonicalize()?);
    }
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        env::current_dir()?.join(path)
    };
    let parent = absolute(path.parent().ok_or("path has no parent")?)?;
    match path.file_name() {
        Some(name) => Ok(parent.join(name)),
        None => Err(format!("invalid path: {}", path.display()).into()),
    }
}

pub struct Runner {
    env: BTreeMap<OsString, OsString>,
}
impl Runner {
    pub fn new() -> Self {
        let excluded = [
            "CARGO_",
            "RUST",
            "CC",
            "CXX",
            "AR",
            "LD",
            "RANLIB",
            "CFLAGS",
            "LIBSQLITE",
            "WALLET_",
        ];
        Self {
            env: env::vars_os()
                .filter(|(key, _)| {
                    !excluded
                        .iter()
                        .any(|prefix| key.to_string_lossy().starts_with(prefix))
                })
                .collect(),
        }
    }
    pub fn set(&mut self, key: &str, value: impl Into<OsString>) {
        self.env.insert(key.into(), value.into());
    }
    fn command(&self, cwd: &Path, program: &str, args: &[&str]) -> Command {
        eprintln!("+ {program} {}", args.join(" "));
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(cwd)
            .env_clear()
            .envs(&self.env);
        command
    }
    pub fn run(&self, cwd: &Path, program: &str, args: &[&str]) -> Result<()> {
        let status = self.command(cwd, program, args).status()?;
        if !status.success() {
            return Err(format!("{program} failed: {status}").into());
        }
        Ok(())
    }
    pub fn capture(&self, cwd: &Path, program: &str, args: &[&str]) -> Result<String> {
        let output = self
            .command(cwd, program, args)
            .stderr(Stdio::inherit())
            .output()?;
        if !output.status.success() {
            return Err(format!("{program} failed: {}", output.status).into());
        }
        Ok(String::from_utf8(output.stdout)?)
    }
    pub fn log(&self, cwd: &Path, path: &Path, program: &str, args: &[&str]) -> Result<()> {
        let log = fs::File::create(path)?;
        let status = self
            .command(cwd, program, args)
            .stdout(log.try_clone()?)
            .stderr(log)
            .status()?;
        if !status.success() {
            return Err(format!("{program} failed: {status}; see {}", path.display()).into());
        }
        Ok(())
    }
}
pub fn text(path: &Path) -> &str {
    path.to_str().expect("build paths must be UTF-8")
}
