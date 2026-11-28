# Standalone PCZT binding

The private `parse_standalone_pczt` binding owns a wasm-bindgen handle; serialization,
combination and redaction return independent values. The caller supplies a positive
u32 byte limit. Parsing and serialized results must fit it; combination uses the
smaller input limit. Inputs must share exact parameter bytes, genesis, height and
branch. The qualified transaction versions are V5 and V6. Native consensus rules check
version, branch, coin type and pool activation.
Legacy Orchard transactions are outside this three-pool profile and reject explicitly.

Inspection reports **structural role material completeness**, not cryptographic
validity, transaction finalizability or wallet approval. Proof completeness means
required proof slots are populated. Authorization completeness means shielded spend
signature slots are populated and transparent inputs either have a nonempty finalized
scriptSig or the upstream spend finalizer can assemble their supplied partial
material. The finalizer runs only on copied pending inputs; finalized inputs must not
be re-finalized after their partial signatures/redeem scripts were cleared. No keys,
signatures, binding signatures or proofs are generated or verified. Binding material,
transaction consistency, effects and authorization verification remain later roles.

`zakura-signer-full/1` applies the exact Full recipe from the accepted patched
`zakura-client-backend 0.1.0-rc4` `src/data_api/wallet.rs:3318`: remove the proprietary
`zcash_client_backend:proposal_info` global entry and each pool's
`zcash_client_backend:output_info` output entry; remove Sapling spend witnesses and
dummy asks and Orchard/Ironwood spend witnesses and dummy signing keys. Preserve
other proprietary fields, proofs, binding-signature keys, anchors, viewing keys,
authorization randomizers, derivation paths, output recovery keys and user addresses.
This is a signer view, **not privacy-safe public disclosure**. Unknown profiles reject;
Compact is not implemented. No wallet association or approval is conferred.

The locked `zakura-pczt 0.1.0-rc2` parser may normalize a valid v2 encoding to v1 on
serialization. Exact input consumption uses its public versioned wire types with
`postcard::take_from_bytes`, rather than rejecting valid normalization. No backend
prover/signer/extractor feature is enabled for this standalone binding.
