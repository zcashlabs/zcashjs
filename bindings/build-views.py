#!/usr/bin/env python3
"""Offline account candidate producer; reuses the immutable wallet verifier/tools.
Owned backend patches are verified and materialized; output is private.
"""
import hashlib, io, json, os
from pathlib import Path
import shutil, subprocess, sys, tarfile, tempfile, tomllib
REPO=Path(__file__).resolve().parent
SCRATCH=Path('/home/jack/zakura-account-compose-scratch/fixes/r1')
helper_path=REPO/'build-wallet.py'
helper_bytes=helper_path.read_bytes()
if helper_bytes!=subprocess.check_output(['git','-C',str(REPO),'show','HEAD:build-wallet.py']):
    raise RuntimeError('commit-matching wallet helper required before execution')
wallet={'__file__':str(helper_path),'__name__':'verified_wallet_build_helpers'}
exec(compile(helper_bytes,str(helper_path),'exec'),wallet)
sha,inventory,require=wallet['sha'],wallet['inventory'],wallet['require']

def main():
    require(len(sys.argv) in (2,3) and (len(sys.argv)==2 or sys.argv[2]=='--threaded'),'usage: build-views.py NEW_ASSIGNED_OUTPUT [--threaded]')
    threaded=len(sys.argv)==3
    feature='wallet-threaded' if threaded else 'wallet-storage'
    out=Path(sys.argv[1]).resolve()
    require(out.is_relative_to(SCRATCH) and not out.exists(),'new output under assigned scratch required')
    git=lambda *args: subprocess.check_output(['git','-C',str(REPO),*args])
    revision=git('rev-parse','HEAD').decode().strip()
    require(git('show',f'{revision}:build-views.py')==Path(__file__).read_bytes(),'commit producer first')
    require(sha(wallet['BINDGEN'])==wallet['BINDGEN_SHA'],'approved generator hash')
    out.mkdir(parents=True)
    work=Path(tempfile.mkdtemp(prefix='views-build-',dir=SCRATCH)); source=work/'source'; source.mkdir()
    with tarfile.open(fileobj=io.BytesIO(git('archive',revision))) as archive: archive.extractall(source,filter='data')
    require((source/'build-wallet.py').read_bytes()==helper_bytes,'helper snapshot mismatch')
    git_inputs=inventory(source)
    proposed=False
    inputs=inventory(source)
    env={k:v for k,v in os.environ.items() if k not in ['CC','CXX','AR','LD','RANLIB'] and not k.startswith(('CARGO_','RUST','CC_','AR_','CFLAGS','LIBSQLITE','WALLET_'))}
    sdk=wallet['SDK']
    env.update(CARGO_HOME=str(SCRATCH/'cargo'),CARGO_TARGET_DIR=str(work/'target'),CARGO_NET_OFFLINE='true',CARGO_BUILD_JOBS='2',RUSTUP_TOOLCHAIN='stable',TMPDIR=str(SCRATCH/'tmp'),RUSTFLAGS=f'--remap-path-prefix={source}=/source',WALLET_TEST_ROOT=str(work),WALLET_SDK=str(sdk),CC_wasm32_unknown_unknown=str(sdk/'bin/clang'),AR_wasm32_unknown_unknown=str(sdk/'bin/llvm-ar'))
    receipt=dict(mode='threaded' if threaded else 'baseline',format='private-viewing-accounts-build/1',complete=False,revision=revision,tree=git('rev-parse',f'{revision}^{{tree}}').decode().strip(),sources=inputs,work=str(work),commands=[],inheritedStorageBase='dbd67c0b59f35f9661897b82d601a0287f71f719',inheritedStorageMetadataSha256='b6779aa79677dd3759628a3752e6997023d2b74184362fc2152038c2483d2041',acceptance='PENDING independent HIGH and actual Firefox',generator=dict(path=str(wallet['BINDGEN']),sha256=wallet['BINDGEN_SHA']))
    inherited=Path('/home/jack/zakura-wallet-storage-scratch/build-04/build.json')
    require(sha(inherited)==receipt['inheritedStorageMetadataSha256'],'inherited storage metadata mismatch')
    receipt['inheritedStorageMetadataPath']=str(inherited)
    receipt['storagePrerequisite']='c44bded merged PR3; scoped source incorporation, combined qualification pending'
    receipt['helperSha256']=hashlib.sha256(helper_bytes).hexdigest()
    receipt['gitSources']=git_inputs
    receipt['proposedParentHook']=dict(appliedInScratch=proposed,sha256=sha(source/'tests/wallet-views-storage-hook.patch'),approval='hook incorporated under express owner authorization; independent review pending')
    def run(label,args):
        log=out/f'{label}.log'
        with log.open('xb') as f:
            try: result=subprocess.run(list(map(str,args)),cwd=source,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=900 if args[0]=='cargo' else 120)
            except subprocess.TimeoutExpired: result=subprocess.CompletedProcess(args,124)
        entry=dict(argv=list(map(str,args)),cwd=str(source),exit=result.returncode,log=log.name,sha256=sha(log)); receipt['commands'].append(entry); print(json.dumps(entry),flush=True)
        require(result.returncode==0,f'{label} failed: '+log.read_text()[-2500:])
        return log.read_text()
    def verify_packages(metadata):
        locked={(p['name'],p['version']):p.get('checksum') for p in tomllib.loads((source/'Cargo.lock').read_text())['package']}
        packages={}
        for p in metadata['packages']:
            root=Path(p['manifest_path']).parent
            if root==source:
                require(p['name']=='zakura-network-bindings','local root'); continue
            require(p['source']=='registry+https://github.com/rust-lang/crates.io-index','registry source required')
            n,v=p['name'],p['version']
            if n.startswith('zakura-'):
                expected='0.1.0-rc4' if n in ['zakura-client-backend','zakura-client-sqlite'] else '0.1.0-rc2' if n=='zakura-pczt' else '1.0.0'
                require(v==expected,'Common version drift')
            if n=='zcash_protocol': require(v=='0.10.6','protocol drift')
            digest=locked[n,v]; archive=SCRATCH/'cargo/registry/cache'/root.parent.name/f'{n}-{v}.crate'
            packages[f'{n}@{v}']=dict(checksum=digest,files=wallet['verify_package'](root,archive,digest))
        return packages
    try:
        run('producer-gates',['python3','-O','tests/wallet-views-builder.py'])
        metadata=json.loads(run('metadata',['cargo','metadata','--offline','--locked','--features',feature,'--format-version','1']))
        receipt['packages']=verify_packages(metadata)
        sqlite=next(p for p in metadata['packages'] if p['name']=='libsqlite3-sys')
        env['WALLET_SQLITE']=str(Path(sqlite['manifest_path']).parent/'sqlite3')
        receipt['tools']={n:dict(path=shutil.which(n),sha256=sha(Path(shutil.which(n)).resolve())) for n in ['cargo','rustc','node','cc']}
        receipt['versions']={n:run(n,args).strip() for n,args in {'rustc':['rustc','-vV'],'cargo':['cargo','-V'],'node':['node','-v'],'generator':[wallet['BINDGEN'],'--version']}.items()}
        sysroot=Path(run('sysroot',['rustc','--print','sysroot']).strip())
        receipt['targetLibraries']=inventory(sysroot/'lib/rustlib/wasm32-unknown-unknown/lib')
        receipt['compilerFiles']={str(p):sha(p) for p in [sysroot/'bin/rustc',sysroot/'bin/cargo',*list((sysroot/'lib').glob('librustc_driver-*')),*list((sysroot/'lib/rustlib').glob('*/bin/rust-lld'))]}
        receipt['sdk']=dict(path=str(sdk),files=inventory(sdk)); receipt['flockSha256']=sha(Path('/usr/bin/flock'))
        # Exhaustive PR3 migration-order tests run separately in native-all.log;
        # avoid repeating them in each artifact build.
        run('native',['cargo','test','--offline','--locked','--features','wallet-storage','--','--skip','schema_source_effects_compose','--skip','schema_document_committed_prefixes_resume'])
        run('primitive-build',['cargo','build','--offline','--locked','--release','--target','wasm32-unknown-unknown','--lib'])
        raw=work/'target/wasm32-unknown-unknown/release/zakura_network_bindings.wasm'
        primitive=out/'primitive'
        run('primitive-generate',[wallet['BINDGEN'],'--target','web','--out-dir',primitive,'--out-name','bindings',raw])
        for name in ['bytes.mjs','network.mjs','transaction.mjs']: shutil.copyfile(source/name,primitive/name)
        for name in ['node','transaction']: run('test-'+name,['node',f'tests/{name}.mjs',primitive])
        receipt['primitiveArtifacts']=inventory(primitive)
        ctarget='wasm32-wasi-threads' if threaded else 'wasm32-wasi'
        cthreads=' -matomics -mbulk-memory -pthread' if threaded else ''
        env.update(CFLAGS_wasm32_unknown_unknown=f'--target={ctarget} --sysroot={sdk}/share/wasi-sysroot{cthreads} -DSQLITE_OS_OTHER=1 -USQLITE_THREADSAFE -DSQLITE_THREADSAFE=0 -DSQLITE_TEMP_STORE=3 -DSQLITE_OMIT_LOAD_EXTENSION=1',LIBSQLITE3_FLAGS='-DSQLITE_ENABLE_MEMSYS5 -DSQLITE_ZERO_MALLOC -DLONGDOUBLE_TYPE=double -DSQLITE_OMIT_WAL')
        env['RUSTFLAGS']+=' -C link-arg=--max-memory=268435456'
        build=['cargo','build']
        if threaded:
            # Retained shared-memory recipe: pinned nightly std, TLS and wasi-threads libc.
            env['RUSTUP_TOOLCHAIN']='nightly-2026-09-01'
            env['RUSTFLAGS']+=' -C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--shared-memory -C link-arg=--import-memory'
            threaded_root=Path(run('threaded-sysroot',['rustc','--print','sysroot']).strip())
            std_source=threaded_root/'lib/rustlib/src/rust/library'
            receipt['threadedToolchain']=dict(version=run('threaded-rustc',['rustc','-vV']).strip(),sysroot=str(threaded_root),sources=inventory(std_source),compilerFiles={str(p):sha(p) for p in [threaded_root/'bin/rustc',threaded_root/'bin/cargo',*list((threaded_root/'lib').glob('librustc_driver-*')),*list((threaded_root/'lib/rustlib').glob('*/bin/rust-lld'))]})
            build+=['-Z','build-std=std,panic_abort']
        receipt['environment']={k:v for k,v in env.items() if k.startswith(('CARGO_','RUST','WALLET_','CC_','AR_','CFLAGS','LIBSQLITE'))}
        run('wasm',build+['--offline','--locked','--release','--target','wasm32-unknown-unknown','--features',feature,'--lib'])
        raw=work/'target/wasm32-unknown-unknown/release/zakura_network_bindings.wasm'
        shutil.copyfile(raw,out/'wallet.raw.wasm'); bundle=out/'bundle'
        run('generate',[wallet['BINDGEN'],'--target','web','--keep-lld-exports','--out-dir',bundle,'--out-name','bindings',raw])
        for name in ['bytes.mjs','wallet.mjs','views.mjs','network.mjs','transaction.mjs']: shutil.copyfile(source/name,bundle/name)
        shutil.copytree(source/'wallet-host',bundle/'wallet-host',ignore=shutil.ignore_patterns('*.rs','*.c','*.md','*.txt'))
        shutil.copytree(source/'tests',bundle/'tests')
        shutil.copyfile(work/'views-fixture.json',bundle/'tests/views-fixture.json')
        if threaded:
            run('test-wallet-inspect',['node','tests/wallet-inspect.mjs',bundle,'--threaded'])
            run('test-wallet-threaded',['node','tests/wallet-threaded-node.mjs',bundle])
            require(inventory(std_source)==receipt['threadedToolchain']['sources'],'threaded std source mutation')
        else:
            for name in ['wallet-inspect','wallet-admission','wallet-node','wallet-crash','wallet-views-node']:
                run('test-'+name,['node',f'tests/{name}.mjs',bundle])
        receipt['features']=run('features',['cargo','tree','--offline','--locked','--features',feature,'--target','wasm32-unknown-unknown','-e','features'])
        require(inventory(source)==inputs,'source mutation')
        require(verify_packages(metadata)==receipt['packages'],'dependency mutation')
        receipt['artifacts']=inventory(bundle); receipt['rawSha256']=sha(out/'wallet.raw.wasm'); receipt['complete']=True
    except Exception as e:
        receipt['error']=str(e); raise
    finally:
        if (out/'bundle').exists(): receipt['candidateArtifacts']=inventory(out/'bundle')
        (out/'build.json').write_text(json.dumps(receipt,indent=2,sort_keys=True)+'\n')
if __name__=='__main__': main()
