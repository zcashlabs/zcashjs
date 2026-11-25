# Native Regtest tests with THS

`@zcashlabs/zcash.js/testing` exports `withTestTHS` and `createTestTHSClient` for Node 22.23.4. They start an isolated, manually mined Regtest instance with the existing [Thus Spoke Zakura](https://github.com/zcashlabs/thus-spoke-zakura) launcher. The browser package entry does not import these helpers.

Install or build a THS launcher and matching native runtime before using this API. The launcher must support `start --native --json` and the status, mine, reorg and rollback APIs. Native bundles are not yet published; use a locally built native runtime following the THS development documentation. This API uses your installation and never downloads executables. Docker startup is not supported by this helper.

## Automatic setup and cleanup

Wrap a test body in `withTestTHS`. It starts a fresh sandbox, calls your test only after startup succeeds, and waits for shutdown before returning the test's result. It also shuts down when an assertion throws. If the test and shutdown both fail, an `AggregateError` preserves both errors, with the test error first. Concurrent calls use separate instances. Use the callback from Node's test runner, Vitest, or Jest; no test-runner dependency is required.

```ts
import { withTestTHS } from '@zcashlabs/zcash.js/testing';

await withTestTHS(async ths => {
  const before = await ths.rpc('getblockcount');
  await ths.produceBlock(3);
  const after = await ths.rpc('getblockcount');
  if (typeof before !== 'number' || after !== before + 3) {
    throw new Error('Expected exactly three new blocks');
  }
});
```

The second argument accepts the same launcher options as `createTestTHSClient`, plus an optional `signal`. Pass the test runner's abort signal, such as Node's `t.signal`, to shut down on test cancellation or timeout. An already aborted signal prevents startup. Cancellation waits for THS shutdown even if the callback is still waiting; application work must observe its own signal to stop too. `timeoutMs` bounds THS operations, not the entire test body.

```ts
import { test } from 'node:test';
import { withTestTHS } from '@zcashlabs/zcash.js/testing';

test('application sandbox', { timeout: 240_000 }, async t => {
  await withTestTHS(async ths => {
    await ths.produceBlock(1);
    // Exercise your application using ths.config().
  }, { signal: t.signal });
});
```

Tests that share a sandbox can instead call `start()` in their setup hook and `stop()` in their teardown hook. Register teardown before awaiting startup.

## Sandbox controls

| Handle | Behavior |
| --- | --- |
| `config()` | Returns the instance's dashboard, RPC and lightwalletd endpoints and network identity. Pass lightwalletd to your application or ZcashJS wallet. |
| `fundAddress(address, amountZatoshi, options?)` | Sends test funds to an application wallet and waits for broadcast. Amounts are bigint zatoshi, from `1n` to `500_000_000n` (5 ZEC). |
| `produceBlock(count)` | Mines blocks and waits for the node, indexer and THS wallet to sync. |
| `reorg(depth, { keepTransactions? })` | Replaces recent blocks, optionally trying to include their transactions again. |
| `rollback(depth)` | Removes recent blocks without producing replacements. |
| `rpc(method, params?)` | Calls a Zakura RPC method on this sandbox. Returns `unknown`; validate it or use the SDK's typed RPC client with `config().rpc`. |
| `waitUntilSettled()` | Waits for node, indexer and THS wallet agreement after direct RPC changes. |

`fundAddress` returns `{ address, amountZatoshi, idempotencyKey, txid, status }`, where status is `broadcast` or `confirmed`. THS validates that the address belongs to Regtest. It supports unified and transparent destinations. The helper does not mine confirmation blocks for the payment: call `produceBlock` for the confirmations your application requires, then sync the application's wallet. THS may replenish its treasury while preparing funding, so funding is not a guarantee that chain height stays fixed.

Supply a stable `idempotencyKey` when you may retry funding. Reusing it with the same address and amount retrieves the same payment; changing either is rejected by THS. Keys contain 8-128 visible ASCII characters. When omitted, the helper generates a UUID. Funding errors include the key, so a lost response can be investigated or retried with the same key instead of creating another payment. Only the status read is polled; the payment submission is never automatically repeated.

Direct RPC calls are not automatically retried or followed by settlement. They expose the methods the node supports, including mutations; a call can make the sandbox unavailable. All handles stay bound to the helper's own validated Regtest instance. A response from another instance is rejected.

## Manual lifecycle

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

`produceBlock(count)` accepts integers from 1 to 10,000. `reorg(depth, { keepTransactions })` and `rollback(depth)` accept integers from 1 to 1,000; the chain must also contain sufficient blocks. `keepTransactions` defaults to `false`. These methods resolve with no value after THS reports its node, index and internal wallet settled. External SDK wallets must still call `wallet.sync()` themselves. Every RPC, funding and settlement call also has one total `timeoutMs` budget and is cancelled by `stop()`. Chain operations are not automatically retried: a timed-out operation might already have changed the chain.

Always await `stop()` in `finally`. It cancels startup and pending requests, sends SIGTERM to the owned launcher, and awaits the launcher's service cleanup. Repeated stops are harmless. A cleanup timeout is an error; the helper retains the run and prevents restart until cleanup is confirmed by a subsequent stop. Unexpected nonzero launcher exits are reported as errors; code 143 is accepted after the helper successfully requests SIGTERM on its live child. An interrupted native startup can exit with code 1 after cleaning its processes and deleting its instance state; both `start()` and `stop()` then reject, preserving the launcher's error message. Errors use ordinary JavaScript `Error`/`AggregateError`, with launcher diagnostics for startup failures.

The optional native regression exercises the public helpers with a real SDK wallet, exact funding and replay, an outgoing payment, direct RPC mining, reorg, rollback, and automatic shutdown after passing, failing, and cancelled tests:

```sh
npm run build
THS_BINARY=/absolute/path/to/ths THS_RUNTIME_DIR=/absolute/path/to/ths-runtime \
  node tests/integration/ths-testing.mjs
```

It writes evidence under `.cache/ths-testing/`. The default `npm test` uses disposable local CLI fixtures and does not require THS or a live node.
