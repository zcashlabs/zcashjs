# Sapling parameter distribution

The bundled `sapling-spend.params` and `sapling-output.params` are the canonical
Sapling proving parameters. Their raw bytes were retrieved from
https://download.z.cash/downloads/ and checked against the SDK's SHA-256 pins.

The same bytes were independently reconstructed from the published
`wagyu-zcash-parameters-{1,2,3,4,5,6}` version `0.2.0` crate distributions:
concatenate `sapling-spend-1.params` through `sapling-spend-5.params`, and use
`sapling-output-1.params` from package 6. Both outputs matched byte-for-byte.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| sapling-spend.params | 47,958,396 | `8e48ffd23abb3a5fd9c5589204f32d9c31285a04b78096ba40a79b75677efc13` |
| sapling-output.params | 3,592,860 | `2f0ebbcbb9bb0bcffe95a397e7eba89c29eb4dde6191c339db88570e3f3fb0e4` |

Those crate distributions declare `MIT/Apache-2.0` and credit Collin Chin,
Raymond Chu, Ali Mousa, and Howard Wu. Both supplied license texts are retained
alongside this notice as `SAPLING-PARAMETERS-MIT.txt` and
`SAPLING-PARAMETERS-APACHE.txt`.

Source repository: https://github.com/howardwu/wagyu-zcash-parameters
(the historical `AleoHQ/wagyu-zcash-parameters` URL redirects there).

These are public proving parameters, not secret setup contributions or wallet
secrets. Source builds download missing parameters into `.cache/proving`, verify
their sizes and hashes, and bundle them. Prebuilt npm installations include these
files and load them only when needed, without a post-install download. Neither
path executes a new trusted setup.
