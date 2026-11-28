"""Nonexecuting preflight regression: python3 [-O|-OO] tests/test_build_guards.py.
Boundary stubs stop before mkdtemp; these checks are never build receipts.
"""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'build.py'
SOURCE = SCRIPT.read_bytes()
BINDGEN = Path('/home/jack/zcash-node-runtime-scratch/wasm-bindgen-0.2.128-x86_64-unknown-linux-musl/wasm-bindgen')
GOOD_BINARY = BINDGEN.read_bytes()


class PreflightAccepted(Exception):
    pass


class BuildGuards(unittest.TestCase):
    def test_preflight(self):
        cases = [
            ('valid', None, 3),
            ('scratch-inside-source', 'build outside source', 0),
            ('output-inside-source', 'build outside source', 0),
            ('existing-output', 'output must be new', 0),
            ('wrong-bindgen-hash', 'approved bindgen binary mismatch', 0),
            ('wrong-bindgen-version', 'approved bindgen version mismatch', 1),
            ('uncommitted-script', 'commit build script first', 3),
        ]
        for case, diagnostic, call_count in cases:
            with self.subTest(case=case, optimization=sys.flags.optimize):
                calls = []
                scratch = SCRIPT.parent if case == 'scratch-inside-source' else SCRIPT.parent.parent
                output = SCRIPT.parent / 'never-created-output' if case == 'output-inside-source' else SCRIPT.parent.parent / 'never-created-output'
                if case == 'existing-output':
                    output = SCRIPT.parent.parent

                def read_bytes(path):
                    if path == BINDGEN:
                        return b'wrong tool' if case == 'wrong-bindgen-hash' else GOOD_BINARY
                    if path == SCRIPT:
                        return SOURCE
                    self.fail(f'unexpected read: {path}')

                def capture(args, **kwargs):
                    args = list(map(str, args))
                    calls.append(args)
                    if args == [str(BINDGEN), '--version']:
                        return b'wrong version' if case == 'wrong-bindgen-version' else b'wasm-bindgen 0.2.128\n'
                    if args == ['git', '-C', str(SCRIPT.parent), 'rev-parse', 'HEAD']:
                        return b'test-revision\n'
                    if args == ['git', '-C', str(SCRIPT.parent), 'show', 'test-revision:build.py']:
                        return SOURCE + b'changed' if case == 'uncommitted-script' else SOURCE
                    self.fail(f'unexpected subprocess: {args}')

                with patch.object(sys, 'argv', [str(SCRIPT), str(scratch), str(output)]), \
                     patch.object(Path, 'read_bytes', read_bytes), \
                     patch.object(subprocess, 'check_output', capture), \
                     patch.object(subprocess, 'run', side_effect=AssertionError('no build allowed')), \
                     patch.object(tempfile, 'mkdtemp', side_effect=PreflightAccepted):
                    if diagnostic is None:
                        with self.assertRaises(PreflightAccepted):
                            exec(compile(SOURCE, str(SCRIPT), 'exec'), {'__file__': str(SCRIPT)})
                    else:
                        with self.assertRaisesRegex(RuntimeError, diagnostic):
                            exec(compile(SOURCE, str(SCRIPT), 'exec'), {'__file__': str(SCRIPT)})
                self.assertEqual(len(calls), call_count)


if __name__ == '__main__':
    unittest.main()
