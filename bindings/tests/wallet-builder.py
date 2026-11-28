"""Exercise actual provenance gates, including under python -O."""
import io
from pathlib import Path
import runpy
import tarfile
import tempfile

builder = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'build-wallet.py'))
verify, sha = builder['verify_package'], builder['sha']
root = Path(tempfile.mkdtemp(prefix='wallet-gates-', dir='/home/jack/zakura-wallet-storage-scratch'))
package = root / 'example-1.0.0'
package.mkdir()
(package / 'Cargo.toml').write_bytes(b'published')
archive = root / 'example-1.0.0.crate'
with tarfile.open(archive, 'w:gz') as stream:
    info = tarfile.TarInfo('example-1.0.0/Cargo.toml')
    info.size = 9
    stream.addfile(info, io.BytesIO(b'published'))
digest = sha(archive)
verify(package, archive, digest)

def rejected(action):
    try:
        action()
    except RuntimeError:
        return
    raise RuntimeError('gate accepted invalid input')

rejected(lambda: builder['require'](False, 'gate'))
(package / 'extra.rs').write_bytes(b'extra')
rejected(lambda: verify(package, archive, digest))
(package / 'extra.rs').unlink()
(package / 'Cargo.toml').write_bytes(b'tampered')
rejected(lambda: verify(package, archive, digest))
(package / 'Cargo.toml').unlink()
rejected(lambda: verify(package, archive, digest))
(package / 'Cargo.toml').write_bytes(b'published')
rejected(lambda: verify(package, archive, '0' * 64))
verify(package, archive, digest)
print('PASS: unconditional gate, archive checksum, exact source set, changed/missing/extra file rejection')
