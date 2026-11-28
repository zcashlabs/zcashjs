#!/usr/bin/env python3
"""Copy only locked package sources, archives and index entries into a fresh owned cache."""
import argparse, hashlib, pathlib, shutil, tomllib
p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
if a.output.exists():raise RuntimeError('cache output must be fresh')
lock=tomllib.loads((pathlib.Path(__file__).parent/'Cargo.lock').read_text())
registry='index.crates.io-1949cf8c6b5b557f'
for item in lock['package']:
    if 'source' not in item:continue
    if item['source']!='registry+https://github.com/rust-lang/crates.io-index':raise RuntimeError('unexpected package source')
    name=item['name'];package=name+'-'+item['version']
    archive=a.source/'registry/cache'/registry/(package+'.crate')
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=item['checksum']:raise RuntimeError('archive checksum mismatch: '+package)
    index=name if len(name)==1 else '2/'+name if len(name)==2 else '3/'+name[0]+'/'+name if len(name)==3 else name[:2]+'/'+name[2:4]+'/'+name
    for rel in ['registry/cache/'+registry+'/'+package+'.crate','registry/src/'+registry+'/'+package,'registry/index/'+registry+'/.cache/'+index,'registry/index/'+registry+'/config.json']:
        source=a.source/rel;target=a.output/rel;target.parent.mkdir(parents=True,exist_ok=True)
        if source.is_dir():shutil.copytree(source,target)
        else:shutil.copy2(source,target)
print('copied exact locked cache; no downloads')
