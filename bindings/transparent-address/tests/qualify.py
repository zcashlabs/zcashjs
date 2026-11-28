#!/usr/bin/env python3
"""Finite parent-only qualification: authenticated inputs, fresh roots, normal Firefox and four real signals."""
import argparse, hashlib, json, os, pathlib, signal, subprocess, time

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    p=argparse.ArgumentParser()
    for name in ['manifest','sha256','logs','scratch']: p.add_argument('--'+name,required=True)
    a=p.parse_args(); manifest=pathlib.Path(a.manifest)
    if sha(manifest)!=a.sha256: raise RuntimeError('manifest authentication failed')
    data=json.loads(manifest.read_text())
    def verify():
        for path,digest in data['files'].items():
            if sha(pathlib.Path(path))!=digest: raise RuntimeError('input changed: '+path)
    verify()
    logs=pathlib.Path(a.logs).resolve(); scratch=pathlib.Path(a.scratch).resolve()
    if logs==scratch or logs.is_relative_to(scratch) or scratch.is_relative_to(logs): raise RuntimeError('distinct fresh roots required')
    logs.mkdir(); scratch.mkdir()
    results=[]
    def run(stage=None,sig=None):
        verify()
        label='normal' if stage is None else stage+'-'+sig.name
        env=dict(os.environ)
        env.pop('TRANSPARENT_ADDRESS_CONTROL',None)
        if stage: env['TRANSPARENT_ADDRESS_CONTROL']=stage
        command=[data['node'],data['runner'],data['build'],str(logs/label),str(scratch/label)]
        sent=False; observed=None
        with (logs/(label+'.log')).open('wb') as out:
            child=subprocess.Popen(command,env=env,stdout=out,stderr=subprocess.STDOUT)
            end=time.monotonic()+110
            try:
                while child.poll() is None:
                    receipts=list((logs/label).glob('firefox-*/receipt.json'))
                    if receipts:
                        try: observed=json.loads(receipts[0].read_text())
                        except json.JSONDecodeError: pass
                    if stage and not sent and observed and any(t['event']=='control-ready' for t in observed['trace']):
                        if observed['runnerPid']!=child.pid or observed['control']!=stage: raise RuntimeError('control identity mismatch')
                        child.send_signal(sig);sent=True
                    if time.monotonic()>end: raise RuntimeError('runner exceeded whole-run deadline')
                    time.sleep(.025)
                code=child.wait()
            finally:
                if child.poll() is None:
                    # Ask the owned runner to execute its independently bounded resource cleanup.
                    child.send_signal(signal.SIGTERM)
                    try: child.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        child.kill();child.wait()
                        raise RuntimeError('runner killed after cleanup deadline: external resource verification required')
        receipts=list((logs/label).glob('firefox-*/receipt.json'))
        if len(receipts)!=1: raise RuntimeError('missing unique final receipt')
        observed=json.loads(receipts[0].read_text())
        cleanup=observed['cleanup']
        if cleanup['errors'] or not all(cleanup.get(k) for k in ['serverClosed','driverGroupGone','browserGone']): raise RuntimeError('cleanup failed')
        if stage:
            if not sent or code!=1 or observed.get('error')!='Error: '+sig.name: raise RuntimeError('actual signal not established')
            if stage=='session' and not cleanup.get('sessionDeleted'): raise RuntimeError('session deletion unobserved')
        elif code!=0 or not observed['ok'] or not observed['result']['workerTerminated']: raise RuntimeError('normal browser qualification failed')
        verify()
        results.append({'label':label,'exit':code,'signalSent':sent,'receipt':str(receipts[0]),'sha256':sha(receipts[0])})
        (logs/'qualification.json').write_text(json.dumps({'complete':False,'results':results},indent=2)+'\n')
    run()
    for stage in ['acquisition','session']:
        for sig in [signal.SIGINT,signal.SIGTERM]: run(stage,sig)
    (logs/'qualification.json').write_text(json.dumps({'complete':True,'manifest':a.sha256,'results':results},indent=2)+'\n')
    print(json.dumps({'ok':True,'results':results}))
if __name__=='__main__': main()
