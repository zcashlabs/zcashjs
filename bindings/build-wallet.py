#!/usr/bin/env python3
"""Offline, locked private wallet build from committed Git bytes. No installation."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib

REPO = Path(__file__).resolve().parent
SCRATCH = Path('/home/jack/zakura-wallet-storage-scratch')
SDK = Path('/home/jack/zcash-qualification-scratch/wasi-sdk-27.0-x86_64-linux')
BINDGEN = Path('/home/jack/zcash-node-runtime-scratch/wasm-bindgen-0.2.128-x86_64-unknown-linux-musl/wasm-bindgen')
BINDGEN_SHA = 'dc9e4f1e03996c26fb8bfedfded73d81120a37251c3f19eb87bb460f1f89a5be'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def inventory(root):
    return {str(p.relative_to(root)): sha(p) for p in sorted(root.rglob('*')) if p.is_file()}

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def verify_package(root, archive, digest):
    require(sha(archive) == digest, f'archive mismatch: {root.name}')
    with tarfile.open(archive) as package_archive:
        expected = {str(Path(m.name).relative_to(root.name)): hashlib.sha256(package_archive.extractfile(m).read()).hexdigest()
                    for m in package_archive.getmembers() if m.isfile()}
    actual = inventory(root)
    actual.pop('.cargo-ok', None)
    actual.pop('.cargo-checksum.json', None)
    require(actual == expected, f'extracted source mismatch: {root.name}')
    return expected

def main():
    require(len(sys.argv) == 2, 'usage: build-wallet.py NEW_OUTPUT_UNDER_ASSIGNED_SCRATCH')
    output = Path(sys.argv[1]).resolve()
    require(output.is_relative_to(SCRATCH) and not output.exists(), 'output must be new assigned scratch')
    git = lambda *args: subprocess.check_output(['git', '-C', str(REPO), *args])
    revision = git('rev-parse', 'HEAD').decode().strip()
    require(git('show', f'{revision}:build-wallet.py') == Path(__file__).read_bytes(), 'commit builder first')
    require(sha(BINDGEN) == BINDGEN_SHA, 'approved generator hash mismatch')
    require(subprocess.check_output([BINDGEN, '--version']).strip() == b'wasm-bindgen 0.2.128', 'generator version')
    output.mkdir(parents=True)
    work = Path(tempfile.mkdtemp(prefix='build-', dir=SCRATCH))
    source = work / 'source'
    source.mkdir()
    with tarfile.open(fileobj=io.BytesIO(git('archive', revision))) as archive:
        archive.extractall(source, filter='data')
    inputs = inventory(source)
    env = {k: v for k, v in os.environ.items() if k not in ['CC', 'CXX', 'AR', 'LD', 'RANLIB'] and not k.startswith(('CARGO_', 'RUST', 'CC_', 'AR_', 'CFLAGS', 'LIBSQLITE', 'WALLET_'))}
    env.update(CARGO_HOME=str(SCRATCH / 'cargo'), CARGO_TARGET_DIR=str(work / 'target'),
               CARGO_NET_OFFLINE='true', CARGO_BUILD_JOBS='2', RUSTUP_TOOLCHAIN='stable',
               TMPDIR=str(SCRATCH / 'tmp'), RUSTFLAGS=f'--remap-path-prefix={source}=/source',
               WALLET_TEST_ROOT=str(work), WALLET_SDK=str(SDK),
               CC_wasm32_unknown_unknown=str(SDK / 'bin/clang'), AR_wasm32_unknown_unknown=str(SDK / 'bin/llvm-ar'))
    commands = []
    receipt = dict(format='private-wallet-storage-build/1', complete=False, revision=revision,
                   tree=git('rev-parse', f'{revision}^{{tree}}').decode().strip(), sources=inputs,
                   generator=dict(path=str(BINDGEN), sha256=BINDGEN_SHA), commands=commands,
                   work=str(work), environment={k: v for k, v in env.items() if k.startswith(('CARGO_', 'RUST', 'WALLET_', 'CC_', 'AR_'))})

    def run(label, *args):
        log = output / f'{label}.log'
        with log.open('xb') as stream:
            try:
                result = subprocess.run(args, cwd=source, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=120 if label.startswith(('wallet-', 'old-')) and str(args[0]) == 'node' else 900)
            except subprocess.TimeoutExpired:
                result = subprocess.CompletedProcess(args, 124)
        commands.append(dict(argv=list(map(str, args)), cwd=str(source), exit=result.returncode, log=log.name, sha256=sha(log)))
        print(json.dumps(commands[-1]), flush=True)
        if result.returncode:
            print(log.read_text()[-5000:], flush=True)
            raise RuntimeError(f'{label} failed')
        return log.read_text()

    def verify_packages(metadata):
        locked = tomllib.loads((source / 'Cargo.lock').read_text())['package']
        checksums = {(p['name'], p['version']): p.get('checksum') for p in locked}
        packages = {}
        for package in metadata['packages']:
            root = Path(package['manifest_path']).parent
            if root == source:
                require(package['name'] == 'zakura-network-bindings', 'unexpected local root')
                continue
            require(package['source'] == 'registry+https://github.com/rust-lang/crates.io-index', 'non-registry dependency')
            name, version = package['name'], package['version']
            if name.startswith('zakura-'):
                expected = '0.1.0-rc4' if name in ['zakura-client-backend', 'zakura-client-sqlite'] else '0.1.0-rc2' if name == 'zakura-pczt' else '1.0.0'
                require(version == expected, f'backend version drift: {name}')
            if name == 'zcash_protocol':
                require(version == '0.10.6', 'protocol version drift')
            archive = SCRATCH / 'cargo/registry/cache' / root.parent.name / f'{name}-{version}.crate'
            digest = checksums[name, version]
            expected_files = verify_package(root, archive, digest)
            packages[f'{name}@{version}'] = dict(checksum=digest, files=expected_files)
        return packages

    try:
        metadata = json.loads(run('metadata', 'cargo', 'metadata', '--offline', '--locked', '--features', 'wallet-storage', '--format-version', '1'))
        receipt['packages'] = verify_packages(metadata)
        sqlite = next(p for p in metadata['packages'] if p['name'] == 'libsqlite3-sys')
        env['WALLET_SQLITE'] = str(Path(sqlite['manifest_path']).parent / 'sqlite3')
        receipt['toolchain'] = {name: run(name, *args).strip() for name, args in {
            'rustc': ['rustc', '-vV'], 'cargo': ['cargo', '-V'], 'node': ['node', '--version']}.items()}
        sysroot = Path(run('rust-sysroot', 'rustc', '--print', 'sysroot').strip())
        compiler_files = [sysroot / 'bin/rustc', sysroot / 'bin/cargo']
        compiler_files += list((sysroot / 'lib').glob('librustc_driver-*'))
        compiler_files += list((sysroot / 'lib/rustlib').glob('*/bin/rust-lld'))
        receipt['rustCompilerFiles'] = {str(p): sha(p) for p in compiler_files}
        receipt['rustTargetLibraries'] = inventory(sysroot / 'lib/rustlib/wasm32-unknown-unknown/lib')
        receipt['runtimeFlockSha256'] = sha(Path('/usr/bin/flock'))
        receipt['sdk'] = dict(path=str(SDK), files=inventory(SDK))
        receipt['tools'] = {name: dict(path=shutil.which(name), sha256=sha(Path(shutil.which(name)).resolve())) for name in ['rustc', 'cargo', 'node', 'cc']}
        run('builder-gates', 'python3', '-O', 'tests/wallet-builder.py')
        run('native', 'cargo', 'test', '--offline', '--locked', '--features', 'wallet-storage')
        run('primitive-build', 'cargo', 'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--lib')
        raw = work / 'target/wasm32-unknown-unknown/release/zakura_network_bindings.wasm'
        primitive = output / 'primitive'
        run('primitive-generate', BINDGEN, '--target', 'web', '--out-dir', primitive, '--out-name', 'bindings', raw)
        for name in ['bytes.mjs', 'network.mjs', 'transaction.mjs']:
            shutil.copyfile(source / name, primitive / name)
        run('old-node', 'node', 'tests/node.mjs', primitive)
        run('old-transaction', 'node', 'tests/transaction.mjs', primitive)
        env.update(CFLAGS_wasm32_unknown_unknown=f'--target=wasm32-wasi --sysroot={SDK}/share/wasi-sysroot -DSQLITE_OS_OTHER=1 -USQLITE_THREADSAFE -DSQLITE_THREADSAFE=0 -DSQLITE_TEMP_STORE=3 -DSQLITE_OMIT_LOAD_EXTENSION=1',
                   LIBSQLITE3_FLAGS='-DSQLITE_ENABLE_MEMSYS5 -DSQLITE_ZERO_MALLOC -DLONGDOUBLE_TYPE=double -DSQLITE_OMIT_WAL')
        env['RUSTFLAGS'] += ' -C link-arg=--max-memory=268435456'
        receipt['walletRustflags'] = env['RUSTFLAGS']
        receipt['walletEnvironment'] = {k: v for k, v in env.items() if k.startswith(('CFLAGS', 'LIBSQLITE', 'WALLET_'))}
        run('wallet-build', 'cargo', 'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--features', 'wallet-storage', '--lib')
        shutil.copyfile(raw, output / 'wallet.raw.wasm')
        bundle = output / 'bundle'
        run('wallet-generate', BINDGEN, '--target', 'web', '--keep-lld-exports', '--out-dir', bundle, '--out-name', 'bindings', raw)
        for name in ['bytes.mjs', 'wallet.mjs']:
            shutil.copyfile(source / name, bundle / name)
        shutil.copytree(source / 'wallet-host', bundle / 'wallet-host', ignore=shutil.ignore_patterns('*.rs', '*.c', '*.md', '*.txt'))
        shutil.copytree(source / 'tests', bundle / 'tests')
        run('wallet-inspect', 'node', 'tests/wallet-inspect.mjs', bundle)
        run('wallet-admission', 'node', 'tests/wallet-admission.mjs', bundle)
        run('wallet-crash', 'node', 'tests/wallet-crash.mjs', bundle)
        run('wallet-node', 'node', 'tests/wallet-node.mjs', bundle)
        receipt['featureGraph'] = run('features', 'cargo', 'tree', '--offline', '--locked', '--features', 'wallet-storage', '--target', 'wasm32-unknown-unknown', '-e', 'features')
        require(inventory(source) == inputs, 'source snapshot changed during build')
        require(verify_packages(metadata) == receipt['packages'], 'dependency source changed during build')
        receipt['artifacts'] = inventory(bundle)
        receipt['primitiveArtifacts'] = inventory(primitive)
        receipt['rawSha256'] = sha(output / 'wallet.raw.wasm')
        receipt['complete'] = True
    except Exception as error:
        receipt['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        (output / 'build.json').write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')

if __name__ == '__main__':
    main()
