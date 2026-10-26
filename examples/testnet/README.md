# Installed-package testnet acceptance

Copy this directory into a new project outside the SDK repository. Before
publication install the candidate tarball with `npm install /absolute/package.tgz`;
after owner publication use `npm install @zcashlabs/zcash.js@VERSION`. The only additional
dependency is `@scure/bip39`, used by this application to generate fresh recovery
phrases. The SDK supplies its own engine, workers and proving assets.

The persistent wallets used by `init` and the wallet commands require **Linux
with `/usr/bin/flock`**; see [platform requirements](../../docs/api/platforms.md).

`npm run probe` performs read-only testnet network checks. `npm run init` creates
independent A/B wallets and prints their receive addresses. Recovery phrases and
databases stay under `private/` (ignored by Git); keep that directory private and
back it up before funding. Do not copy it into a browser build or publish it.

If initialization is interrupted, rerun `npm run init` with the same directory.
It retains the saved recovery phrases and scan height, verifies any committed
account against its phrase, and reuses an already issued receive address. Before
issuing a missing first address, it runs a bounded sync against your endpoint. A
completed initialization can also be rerun without replacing accounts or
rotating addresses. Do not delete `accounts.json` or a database to retry; a
mismatch or unreadable state file requires inspection of the preserved files.

Acceptance is Ironwood-only: both receive addresses contain only Ironwood,
spending selects only Ironwood inputs, and change returns to Ironwood. For existing
test wallets, `node wallet.js addresses` generates and verifies new Ironwood-only
addresses without replacing accounts or recovery material; previous addresses
remain recorded. Do not fund the earlier Sapling-only acceptance address.

Fund A with a small amount of testnet TAZ, then run `npm run status` until funds
are confirmed and spendable. Each transfer command is explicit consent to submit
the displayed payment; use these commands only with fresh testnet wallets:

```sh
node wallet.js send A B 0.001 acceptance-a-to-b
node wallet.js receive B CONFIRMED_TXID 0.001
node wallet.js send B A 0.0005 acceptance-b-to-a
node wallet.js receive A CONFIRMED_RETURN_TXID 0.0005
```

The receiving checks verify transaction identity, exact account balance delta,
spendability, and persistence after reopening. Different return amount leaves room
for B's fee. Actual proposals must fit available funds.

This is an in-progress acceptance harness. If submission or confirmation fails,
do not create a new request ID: preserve `private/`, inspect `operations` in
`npm run status`, and rerun the same `send` command. A finalized operation resumes
its original bytes; an acknowledged or uncertain submission is observed rather
than automatically repeated. An unbuilt stale proposal requires explicit
abandonment before starting a replacement. This recovery path still needs live
qualification, as do all advertised pools and the browser live flow.

Confirmation consumes `wallet.watchSync()` concurrently with `pending.wait()`:
payment waiting alone does not scan the wallet. Both tasks are cancelled and
drained when either confirmation completes or one task fails. A scan error stops
the wait without rebuilding or resubmitting a payment. `node wallet.js confirm A OPERATION_ID`
resumes observation/scanning of an existing operation without submitting anything.

The default endpoint is `https://testnet.zec.rocks:443`, previously used in issue
#125. `TESTNET_ENDPOINT` may select another endpoint on the same pinned testnet.
Mainnet network configuration is deliberately unavailable in this harness.
