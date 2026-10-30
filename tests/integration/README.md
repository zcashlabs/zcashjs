# THS NU7 regression

Build the SDK with the NU7 native candidate, then run:

```sh
THS_BINARY=/absolute/path/to/ths node tests/integration/ths-nu7.mjs
```

The launcher must support the current THS NU7 Regtest environment and have its
Docker images available. The test starts its own named instance, binds to
loopback, uses manual mining, and removes only that instance in `finally`.
`THS_PORT_OFFSET` defaults to 870; choose another free multiple of ten if needed.
The fixed mnemonic is public test data. Only disposable Regtest funds are used.

Checks cover native consensus, lightwalletd handshake, account creation, exact
incoming amounts, confirmation delay, duplicate sync, a same-height reorg,
Ironwood spending with the SDK's default policy under NU7, and recovery using
the mnemonic and saved birthday after closing the wallet. Run with `--sapling`
to exercise Sapling spending instead.
The test checks confirmations two, three and four individually. With the configured
three-block anchor depth, shielded funds become spendable at four confirmations.
Recovery must reproduce the exact per-pool balances as well as confirmed transaction IDs. Recovery uses memory storage and does not qualify persistent Node storage
on macOS. Native database reopen tests cover that separate layer.

Full-history recovery with `birthday: 'fullScan'` is not qualified by this test.
The tested THS lightwalletd rejects the genesis tree-state request: height zero
is treated as a missing selector, and selecting the genesis hash fails because
Zakura's genesis response has no commitment `finalState`. Recovery from a saved
birthday above genesis succeeds. Keep this limitation separate from the passing
saved-birthday recovery check.

JSON evidence and the THS launcher log are written under `.cache/ths-nu7/`.
Use `--fail-after-start` to exercise cleanup after an application exception; that
control intentionally exits nonzero, with a passing resource-cleanup check.

The review branch pins an exact public native commit containing NU7 support.
The native build receipt and SDK build must identify that same clean commit.
Maintainers can replace this review pin with their native release before publication. Never label a local candidate as the existing `v0.1.0` release.
