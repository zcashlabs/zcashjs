# Native Regtest tests with THS

`@zcashlabs/zcash.js/testing` exports `createTestTHSClient` for Node 22.23.4. It starts an isolated, manually mined Regtest instance with the existing [Thus Spoke Zakura](https://github.com/amiabix/thus-spoke-zakura) launcher. The browser package entry does not import this helper.

Install or build a THS launcher and matching native runtime before using this API. The launcher must support `start --native --json` and the status, mine, reorg and rollback APIs. Native bundles are not yet published; use a locally built native runtime following the THS development documentation. This API uses your installation and never downloads executables. Docker startup is not supported by this helper.

```ts
import { createTestTHSClient } from '@zcashlabs/zcash.js/testing';

const ths = createTestTHSClient({
  executable: '/absolute/path/to/ths',
  runtimeDir: '/absolute/path/to/ths-runtime',
  timeoutMs: 180_000,
});
try {
  await ths.start();
  const config = ths.config();
  console.log(config.lightwalletd);
  await ths.produceBlock(10);
  await ths.reorg(2, { keepTransactions: true });
  await ths.rollback(1);
} finally {
  await ths.stop();
}
```

With `createTestTHSClient()` the executable defaults to `ths` on PATH and runtime discovery belongs to the launcher. `timeoutMs` defaults to 180,000 and bounds startup, each chain operation including settlement, and shutdown separately. Failed startup also waits for cleanup, so it may consume a second timeout budget.

`start()` resolves to the same frozen config returned by `config()`: `instance`, `dashboard`, `rpc`, `lightwalletd`, `p2p`, `network: 'regtest'`, `tls: false`, and `genesisHash`. Concurrent starts coalesce. Config access before readiness or after launcher failure throws. Each restart after `stop()` generates a fresh instance name. The helper accepts no existing instance or arbitrary service URL. It checks numeric loopback endpoints, the instance identity, Regtest network and exact Regtest genesis before startup completes, and checks instance identity again before chain operations. HTTP redirects are rejected.

`produceBlock(count)` accepts integers from 1 to 10,000. `reorg(depth, { keepTransactions })` and `rollback(depth)` accept integers from 1 to 1,000; the chain must also contain sufficient blocks. `keepTransactions` defaults to `false`. These methods resolve with no value after THS reports its node, index and internal wallet settled. External SDK wallets must still call `wallet.sync()` themselves. Chain operations are not automatically retried: a timed-out operation might already have changed the chain.

Always await `stop()` in `finally`. It cancels startup and pending requests, sends SIGTERM to the owned launcher, and awaits the launcher's service cleanup. Repeated stops are harmless. A cleanup timeout is an error; the helper retains the run and prevents restart until cleanup is confirmed by a subsequent stop. Unexpected nonzero launcher exits are reported as errors; code 143 is accepted after the helper successfully requests SIGTERM on its live child. An interrupted native startup can exit with code 1 after cleaning its processes and retaining diagnostic logs; both `start()` and `stop()` then reject, preserving those diagnostics. Errors use ordinary JavaScript `Error`/`AggregateError`, with launcher diagnostics for startup failures.

The optional native regression exercises the helper with a real SDK wallet, treasury funding, an outgoing payment, reorg, rollback and shutdown:

```sh
npm run build
THS_BINARY=/absolute/path/to/ths THS_RUNTIME_DIR=/absolute/path/to/ths-runtime \
  node tests/integration/ths-testing.mjs
```

It writes evidence under `.cache/ths-testing/`. The default `npm test` uses disposable local CLI fixtures and does not require THS or a live node.
