# Internal light server observation

This leaf composes an already initialized accepted lightwire codec and actual
`createGrpcWebByteTransport` instance with a separate local `sourceId`. It encodes
literal `GetLightdInfo` / `'{}'`, performs one unary call, waits for terminal
success, decodes, validates, and returns ten scalar observations. There is no
asset acquisition, registration, genesis check, public factory, or full
`LightServerInfo` result.

## Source profile

The source is wallet commit `a9142ee100b3a563b7d9ba7a8e94201d00ad8154`,
`librustzcash/zcash_client_backend/lightwallet-protocol/walletrpc/service.proto`
lines 95–119, retained in accepted private lightwire `vendor/service.proto`
(SHA256 `80575dbe59a9bf2e6b79e2391eb78679c453f1a0477292eb97ea3b58bb6c8b10`).
The codec is reviewed `84585f25f7fed6a897891f5fb5bc509c76dddd05`, merged as
`eae920f968aa5ee59a4ce6bd1c468d4d0fe0eb97`. Its Rust `src/lib.rs:6–18` emits
uint64 values as canonical decimal strings. The accepted facade owns byte copies
and enforces its 4 MiB message bound; Rust additionally bounds fields at 1 MiB,
recursion and occurrences. The byte transport retains its existing bounded
framing, response cardinality, deadline, and status behavior.

[Reference lightwalletd common.go](https://github.com/zcash/lightwalletd/blob/09593edbee4ee68d47e5a53f8ce1c83514c4e8e6/common/common.go)
lines 288–347 supplies the mapping. Version and vendor are lightwalletd labels,
not backend build labels. `lightwallet_protocol_version` must advertise one of
the revisions this client speaks, `v0.5.0` or `v0.6.0`; this is distinct from the custom transport's schema digest.
`v0.6.0` added only `GetStandardFee`, so every message this client exchanges is
unchanged; a server advertising a different revision is rejected, not guessed at.
`chain_name` must be nonempty. `consensus_branch_id` must have exactly eight
lowercase hex digits. Both consumed heights must be canonical decimal strings
within uint32, checked lexically before Number conversion. Zero is valid.
`taddr_support` is a boolean advertisement. Unused metadata and well-formed
unknown protobuf fields remain subject to the accepted codec's behavior.

`sourceId` is a captured local label; `observedAt` is a local ISO timestamp after
success. No endpoint URL or received metadata is included in fixed error text.
Malformed consumed fields, default protobuf and unsupported advertised versions
fail with `PROTOCOL_MISMATCH`. Codec foreign exceptions also become that fixed
error. Trusted SDK errors retain identity: gRPC status 12 is
`METHOD_NOT_SUPPORTED`, other nonzero service status and HTTP errors are
`TRANSPORT_ERROR`; deadlines, cancellation, and transport bounds retain
`TIMEOUT`, `ABORTED`, and `RESOURCE_LIMIT`. Foreign transport exceptions become
fixed `TRANSPORT_ERROR`. Invalid descriptors, operation keys, labels, and signals
fail admission with `INVALID_ARGUMENT`.

The native cancellation bridge is a local adaptation of accepted A. Input data
and function descriptors are captured before asynchronous admission. Captured
functions use trusted `Reflect.apply` with their original receiver. Synthetic
caller events alone do not cancel, and earlier stopImmediatePropagation cannot
suppress genuine abort. Listeners are detached in finally. These guarantees
assume the trusted initialized codec and byte transport and normal native
platform intrinsics; this is not an arbitrary provider or hostile-platform API.

## Fixtures and qualification

`light-server-observation-fixtures.js` contains independently encoded Python
protobuf vectors derived from the pinned schema using the accepted
`lightwire/tests/golden.py` descriptor oracle (installed protobuf 6.33.5).
The full-field accepted golden vector is unchanged: the actual codec accepts it,
but this reader rejects its uint64-max heights/arbitrary branch/protocol. Separate
semantic fixtures cover main, all-zero/test, and uint32-max metadata. A `test`
label and zero Sapling height establish neither registered identity nor a
schedule: zero also represents an absent source upgrade entry.

The lane-specific shared checks file is the sole extra owned repository file;
it prevents divergence between Node and page-owned Firefox assertions. Tests
cover source mappings, unknown fields, malformed protobuf/UTF-8/wire type,
consumed uint64 overflow, profile/default failure, codec/transport bounds,
fragmentation, no/multiple unary messages, missing/error trailers, malformed
base64/frame, HTTP error, status 12, timeout, cancellation, descriptor mutation,
synthetic events, receiver/application behavior and sanitized exceptions.

The installed TypeScript 6.0.3 compiler passes. Actual Node **26.8.1**, accepted
Rust WASM codec, and accepted byte transport pass the shared suite using native
Response/ReadableStream byte fixtures (37 unary requests). This is in-memory
fetch infrastructure, not a loopback HTTP pass. The initial source compiled and
failed the default-response rejection assertion before validation was added.
A small Rust 1.98.1 helper linked to the existing accepted native library also
passes all 13 independently derived DTO vectors without rebuilding the mission.

Worker loopback Node and ordinary Firefox runner attempts both exit 1 at
`listen EPERM` before HTTP/browser execution. No browser version or pass is
claimed. The parent-host packet under
`/home/jack/zcash-light-server-observation-scratch` pins final Git head, source,
compiled modules, accepted receipt inventory and executable assets. It runs Node
loopback composition, ordinary Firefox, and actual SIGINT/SIGTERM acquisition
and session diagnostics with bounded identity-safe cleanup. The Firefox runner
uses unchanged packaged browser options and `acceptInsecureCerts: false`.
WebDriver only reads the page result; page-owned modules and native objects
execute the tests. Served inventory and actual runtime versions are recorded.
Parent execution and independent HIGH review are outstanding acceptance gates.

Full evidence and exact commands are separate external `REPORT.md` and
`COMMANDS.md` in `/home/jack/zcash-light-server-observation-logs`. This slice makes
no native Node gRPC, public handshake, registered Network, network schedule,
authentication, consensus, deployment, wallet, or whole-issue acceptance claim.
