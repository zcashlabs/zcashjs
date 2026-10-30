# Old payment databases

These are synthetic Regtest fixtures. All keys and funds are test data.
`legacy-proposed.db.gz` contains an unbuilt proposal with locked inputs.
`legacy-payment.db.gz` contains a real Sapling proof, signed PCZT, finalized
transaction bytes, an interrupted submission and an acknowledged retry. An
acknowledgment is not chain confirmation. Both retain the same idempotency key
and the original 66-migration database schema.

The producer is `jp4g/zakura-wasm-bindings` at release `v0.1.0`, commit
`45a987e3558034ae1a62bf4581b5845ee155ba1c`. `producer.patch` changes only its test:
it assigns an idempotency key and exports the closed databases and expected
proposal/artifact metadata. It does not modify production code or manufacture
old migration rows. Fixture and patch hashes are in `../manifest.json`.

To regenerate in a disposable checkout of that exact native commit:

1. Follow its `BUILDING.md` to prepare the pinned native dependencies. With the
   locked RC4 crates already in Cargo's cache, run
   `CARGO_HOME="$HOME/.cargo" python3 native-policy/prepare.py` instead of a full WASM build.
2. Apply `producer.patch` with `git apply /absolute/path/to/producer.patch`.
3. Create a fixture directory and set `WALLET_TEST_ROOT` to its absolute path.
   Set `PCZT_PROVING_PARAMETERS` to the directory containing the canonical
   `sapling-spend.params` and `sapling-output.params` (the SDK's `.cache/proving`).
4. Run `cargo test --locked --features wallet-storage pczt_finalize_real_sapling_atomic -- --ignored --test-threads=1`.
5. Copy the two `legacy-*.json` files and gzip the two `legacy-*.db` files with
   `mtime=0`. Review the generated databases and update the manifest hashes.

Fresh regeneration changes random account/operation IDs and proof bytes. The
committed fixtures are immutable test inputs, not byte-reproducible build output.
The regression checks the public operation API and the actual bundled worker,
then compares retained database rows before migration and after two reopens.
