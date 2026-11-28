"""Reject a changed helper before executing any of its bytes (also under -O)."""
from pathlib import Path
import os, shutil, subprocess, sys, tempfile
root=Path(__file__).resolve().parents[1]
work=Path(tempfile.mkdtemp(prefix='views-producer-gate-',dir='/home/jack/zakura-account-compose-scratch/fixes/r1'))
for name in ['build-views.py','build-wallet.py']: shutil.copyfile(root/name,work/name)
for argv in [['git','init','-q'],['git','add','.'],['git','-c','user.name=synthetic-test','-c','user.email=synthetic@example.invalid','commit','-qm','synthetic local producer gate']]:
    subprocess.run(argv,cwd=work,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
marker=work/'untrusted-helper-executed'
with (work/'build-wallet.py').open('a') as f: f.write('\nPath('+repr(str(marker))+').write_text("untrusted executed")\nraise RuntimeError("untrusted helper executed")\n')
result=subprocess.run([sys.executable,'-O',str(work/'build-views.py'),str(work/'output')],cwd=work,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
if result.returncode==0 or marker.exists(): raise RuntimeError('producer executed an unauthenticated helper')
print('PASS: changed helper rejected before execution')
