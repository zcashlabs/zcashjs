#!/usr/bin/env python3
"""Explicit offline build of HEAD from Git bytes, into a new external directory."""
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

REPO = Path(__file__).resolve().parent
BINDGEN = Path('/home/jack/zcash-node-runtime-scratch/wasm-bindgen-0.2.128-x86_64-unknown-linux-musl/wasm-bindgen')
BINDGEN_SHA256 = 'dc9e4f1e03996c26fb8bfedfded73d81120a37251c3f19eb87bb460f1f89a5be'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

scratch, output = (Path(p).resolve() for p in sys.argv[1:])
if scratch.is_relative_to(REPO) or output.is_relative_to(REPO):
    raise RuntimeError('build outside source')
if output.exists():
    raise RuntimeError('output must be new')
if sha(BINDGEN.read_bytes()) != BINDGEN_SHA256:
    raise RuntimeError('approved bindgen binary mismatch')
if subprocess.check_output([BINDGEN, '--version']).decode().strip() != 'wasm-bindgen 0.2.128':
    raise RuntimeError('approved bindgen version mismatch')
revision = git('rev-parse', 'HEAD').decode().strip()
if git('show', f'{revision}:build.py') != Path(__file__).read_bytes():
    raise RuntimeError('commit build script first')
work = Path(tempfile.mkdtemp(prefix='build-', dir=scratch))
source = work / 'source'
source.mkdir()
with tarfile.open(fileobj=io.BytesIO(git('archive', revision))) as archive:
    archive.extractall(source, filter='data')
env = {key: value for key, value in os.environ.items()
       if not key.startswith(('CARGO_', 'RUST'))}
env.update(CARGO_HOME=str(scratch / 'cargo'), CARGO_TARGET_DIR=str(work / 'target'),
           CARGO_BUILD_JOBS='2', CARGO_NET_OFFLINE='true', RUSTUP_TOOLCHAIN='stable',
           RUSTFLAGS=f'--remap-path-prefix={source}=/source', TMPDIR=str(scratch / 'tmp'))
# Same installed C toolchain as the accepted Common 1.0.0 transaction qualification.
sdk = Path('/home/jack/zcash-qualification-scratch/wasi-sdk-27.0-x86_64-linux/bin')
env.update(CC_wasm32_unknown_unknown=str(sdk / 'clang'),
           AR_wasm32_unknown_unknown=str(sdk / 'llvm-ar'))

def run(*args):
    print('+', ' '.join(map(str, args)), flush=True)
    subprocess.run(args, cwd=source, env=env, check=True)

def capture(*args):
    return subprocess.check_output(args, cwd=source, env=env).decode().strip()

run('cargo', 'test', '--offline', '--locked')
run('cargo', 'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--lib')
raw = work / 'target/wasm32-unknown-unknown/release/zakura_network_bindings.wasm'
output.mkdir(parents=True)
run(BINDGEN, '--target', 'web', '--out-dir', output, '--out-name', 'bindings', raw)
for name in ['network.mjs', 'bytes.mjs', 'transaction.mjs']:
    shutil.copyfile(source / name, output / name)
run('node', 'tests/node.mjs', output)
run('node', 'tests/transaction.mjs', output)
files = {p.name: {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
         for p in sorted(output.iterdir())}
graph = capture('cargo', 'tree', '--offline', '--locked', '--target', 'wasm32-unknown-unknown', '--edges', 'features').replace(str(source), '/source')
metadata = dict(schema='zakura-bindings-build/1', revision=revision,
                sourceTree=git('rev-parse', f'{revision}^{{tree}}').decode().strip(),
                lockSha256=sha((source / 'Cargo.lock').read_bytes()),
                rustc=capture('rustc', '-vV'), cargo=capture('cargo', '-V'),
                wasmBindgen='0.2.128', wasmBindgenSha256=BINDGEN_SHA256,
                cTools={name: sha((sdk / name).read_bytes()) for name in ['clang', 'llvm-ar']},
                target='wasm32-unknown-unknown', profile='release',
                rustflags='--remap-path-prefix=<source>=/source',
                dependencyGraph=graph, dependencyGraphSha256=sha(graph.encode()),
                rawWasmSha256=sha(raw.read_bytes()), files=files)
encoded = (json.dumps(metadata, sort_keys=True, indent=2) + '\n').encode()
(output / 'build.json').write_bytes(encoded)
print(json.dumps({'revision': revision, 'output': str(output), 'metadataSha256': sha(encoded), 'files': files}, indent=2))
