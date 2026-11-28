mod build;
mod codec;
mod generate;
mod inputs;
mod mobile;
mod support;
mod tools;

use std::{env, path::PathBuf};
use support::Result;

fn main() {
    if let Err(error) = run() {
        eprintln!("xtask: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_owned();
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("build") => {
            let mut output = root.join("build/sdk");
            let mut cache = root.join(".cache/sdk");
            while let Some(option) = args.next() {
                let destination = match option.as_str() {
                    "--output" => &mut output,
                    "--cache" => &mut cache,
                    _ => return Err(format!("unknown build option: {option}").into()),
                };
                *destination = args
                    .next()
                    .ok_or_else(|| format!("missing value for {option}"))?
                    .into();
            }
            build::build(&root, &output, &cache)
        }
        Some("build-mobile") => {
            let mut output = root.join("build/native");
            let mut cache = root.join(".cache/sdk");
            let mut targets = vec!["android".to_string(), "ios".to_string()];
            while let Some(option) = args.next() {
                let value = args.next().ok_or_else(|| format!("missing value for {option}"))?;
                match option.as_str() {
                    "--output" => output = value.into(),
                    "--cache" => cache = value.into(),
                    "--targets" => targets = value.split(',').map(String::from).collect(),
                    _ => return Err(format!("unknown build-mobile option: {option}").into()),
                }
            }
            mobile::build(&root, &output, &cache, &targets)
        }
        Some("generate") => {
            let options: Vec<_> = args.collect();
            match options.as_slice() {
                [] => generate::generate(&root, false),
                [option] if option == "--check" => generate::generate(&root, true),
                _ => Err("usage: cargo xtask generate [--check]".into()),
            }
        }
        None | Some("--help" | "-h") => {
            println!(
                "cargo xtask build [--output PATH] [--cache PATH]\n\
                 cargo xtask build-mobile [--output PATH] [--cache PATH] [--targets android,ios,host]\n\
                 cargo xtask generate [--check]"
            );
            Ok(())
        }
        Some(command) => Err(format!("unknown command: {command}").into()),
    }
}
