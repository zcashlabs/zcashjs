// React Native (Hermes) platform simulation: dist/react-native/index.js running with
// no WebAssembly, workers or WebCrypto, against the actual native library.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pin = JSON.parse(readFileSync(join(root, 'scripts/native-source.json'), 'utf8'));
const source = join(root, '.cache/native', pin.revision ?? pin.release, 'source');
// The host build of the same native front-end React Native links (cached per revision).
const mobile = join(root, '.cache/native', pin.revision ?? pin.release, 'mobile-host');

test('the React Native build runs the shared checks and native wallets without WebAssembly', { timeout: 1800000 }, () => {
  assert.ok(existsSync(join(root, 'dist/react-native/index.js')), 'run npm run build first');
  if (!existsSync(join(mobile, 'native-build.json'))) {
    execFileSync('cargo', ['xtask', 'build-mobile', '--targets', 'host', '--output', mobile,
      '--cache', join(root, '.cache/native/cache')], { cwd: source, stdio: ['ignore', 'inherit', 'inherit'] });
  }
  const bridge = join(mobile, 'host/zakura-native-bridge');
  const output = execFileSync(process.execPath, ['--import', './register.mjs', 'scenario.mjs'], {
    cwd: import.meta.dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 600000,
    env: { ...process.env, ZAKURA_NATIVE_BRIDGE: bridge, ZAKURA_FIFO_TRANSPORT: join(mobile, 'js/fifo-transport.mjs') },
  });
  const results = JSON.parse(output.trim().split('\n').at(-1));
  assert.deepEqual(results.viewing, { operations: 7, independentAuthorities: 3, cancelled: 2, unknownReceivers: true });
  assert.ok(results.birthday && results.pczt && results.signer);
  assert.deepEqual(results.durable, { reopenedAccounts: 1 });
  assert.equal(results.example, 4);
});
