# Build the native SDK components

Build host selection covers **macOS (Apple Silicon and Intel)** and **Linux
x86_64**. On Windows, use **WSL2 with an x86_64 Linux distribution**, and run all
commands with the Linux tools inside WSL (prefer a checkout in its Linux filesystem).
Native Windows and Linux ARM builds are not configured.

Install Node **22+**, Git, curl, a host C compiler and binutils,
and [rustup](https://rustup.rs/). The build selects matching WASI SDK and
wasm-bindgen archives automatically; no manual platform flags are needed.

- **macOS:** install Xcode Command Line Tools with `xcode-select --install`.
  With Homebrew, `brew install node` supplies Node.
  Use native ARM tools on Apple Silicon rather than mixing Rosetta installations.
- **Debian/Ubuntu/WSL:** install `build-essential`, `git`, `curl` and
  `ca-certificates`; install Node 22 or newer.

From a clean, committed checkout:

```sh
cargo xtask build
```

`cargo xtask` is a repository-local Cargo alias, not an installed command. Cargo
builds the small `xtask/` binary using its own committed lockfile. Rustup selects
the minimal toolchain from `rust-toolchain.toml`; the task ensures the WASM target
is installed and downloads the pinned WASI SDK and wasm-bindgen release archives. Archive SHA-256 values are checked
before extraction. Cargo downloads are locked; the owned policy patches and
cached crate sources are checked before compilation. No crates.io publication
of this repository is required.

The first run needs network access and compiles the native wallet and three
codecs. Expect minutes rather than seconds and several GB of free disk space.
This is a developer build, never an npm install hook.

## Outputs and repeat builds

`build/sdk/` contains:

- `bundle/`: wallet WASM, generated JS bindings and handwritten host adapters.
- `primitive/`: stateless network, transaction and viewing codec bindings/WASM.
- `lightwire/` and `transparent-address/`: independently built codec outputs and receipts.
- `build.json`: successful-build receipt, source revision and verified artifact hashes.

The SDK repository consumes these outputs and owns worker bundling, final npm
packaging and proving-parameter acquisition. This repository does not publish npm
packages or ship a JavaScript SDK distribution.

Downloads and Cargo build outputs are cached under `.cache/sdk/`; rustup uses its
normal toolchain directory. The task itself uses Cargo’s normal download cache
and `xtask/target/`. Cargo tracks changes to compilation inputs. To build
again, choose a new output directory while retaining the cache:

```sh
cargo xtask build --output build/sdk-next
```

Use `--cache /absolute/path` to select another dedicated cache, including an empty
one for clean-cache verification. Output directories must be new and separate
from the cache. Failed builds do not receive a successful root `build.json`;
choose a new output path when retrying. Do not run two builds against the same
checkout/cache concurrently. Both default output and cache directories are ignored.
Commit source changes before building so the receipt identifies their exact revision.

The build verifies native unit tests, primitive JS tests, codec source/graph checks
and the wallet WASM interface. SDK wallet lifecycle and browser integration tests
remain in the SDK repository. The optional threaded wallet is not part of this
baseline build. Historical qualification scripts remain for their recorded runs;
`cargo xtask build` is the portable entry point for the current SDK components.
Python is not required by this build. The independent protobuf test oracle and
historical qualification scripts still use Python.

Checks for build failure handling and committed codec generation:

```sh
cargo test --locked --manifest-path xtask/Cargo.toml
cargo xtask generate --check
```

## Repository layout

| Path | Contents |
| --- | --- |
| `crates/core` | `zakura-bindings-core`: all wallet and codec logic, target-neutral. `api.rs` lists the exported surface; `host.rs` is what a front-end supplies (clock, SQLite open/policy, thread-pool readiness). |
| `crates/wasm` | `zakura-bindings-wasm`: `#[wasm_bindgen]` wrappers with the generated `bindings.js` names, the SQLite VFS adapter (`wallet-host/adapter.c`) and the WASM thread pool. |
| `crates/native` | `zakura-bindings-native`: a C ABI (`include/zakura_native.h`) for iOS, Android and host tests, with owner-thread runtimes, native storage (owner lock, `zakura-enc` encryption VFS) and natively verified proving parameters. `js/bindings.mjs` presents the `bindings.js` interface over it. |
| `lightwire`, `transparent-address` | Separately locked codec crates for the WASM codec builds. |
| `*.mjs`, `wallet-host/*.mjs` | JS glue shared by both front-ends. |

## Native (React Native) libraries

```sh
cargo xtask build-mobile --targets android --output build/native   # ANDROID_NDK_HOME (NDK r26+)
cargo xtask build-mobile --targets ios --output build/native-ios   # macOS with Xcode
cargo xtask build-mobile --targets host --output build/native-host # host library + test bridge
```

Outputs: `android/jniLibs/<abi>/libzakura_bindings_native.so` (arm64-v8a, x86_64),
`ios/ZakuraNative.xcframework`, `include/`, `js/` and `native-build.json`, which records
artifact hashes, the source revision, the dependency-graph digest and toolchains.
The libraries report the same revision and digest at runtime (`identity()`). zcash.js
packages them as `@zcashlabs/zcash.js-native`.

Native checks:

```sh
WALLET_TEST_ROOT=$(mktemp -d) cargo test --locked -p zakura-bindings-core --features wallet-storage
cargo test --locked -p zakura-bindings-native
cargo xtask build --output build/sdk && cargo xtask build-mobile --targets host --output build/native-host
node tests/native-parity.mjs build/sdk build/native-host/host/zakura-native-bridge
cc crates/native/tests/abi.c -Icrates/native/include -Lbuild/native-host/host -lzakura_bindings_native -o abi \
  && LD_LIBRARY_PATH=build/native-host/host ./abi
```

The parity suite runs the same inputs through the WASM bindings and the native ABI and
requires identical results and thrown values.
