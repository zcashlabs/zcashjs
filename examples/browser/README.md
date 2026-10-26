# Browser starter

A plain Vite application using the installed SDK. No framework, proxy, secret
storage, or automatic scanning is added.

Copy this directory outside the SDK repository. Install the candidate tarball
before publication (`npm install /absolute/path/package.tgz`), or install the
version listed in package.json after publication:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Supply your own matching **gRPC-Web** endpoint
with CORS enabled for that origin, select its network, and click **Read chain tip**.
A native gRPC endpoint is not enough. The URL must be an HTTP(S) origin without
a path prefix, query, fragment, or URL credentials; see [light endpoint requirements](../../docs/api/light-client.md).
No provider is selected automatically.

**List local accounts** opens a named OPFS wallet, lists its stored accounts and
closes it. A new wallet returns `[]`; this action does not create accounts or scan.
It requires only the network and wallet name; leave the endpoint blank.
It works offline after assets have loaded. Do not share the same wallet name
between simultaneously open clients. Site-data deletion removes OPFS databases.

Use a current browser with OPFS, WebAssembly, dedicated workers,
`AbortSignal.any`, and lossless JSON reviver context support. Serve on localhost
or HTTPS (a secure context); `file://` is not supported. Baseline wallets do not
require cross-origin isolation.

```sh
npm run build
npm run preview
```

Deploy **all** of `dist/`, including emitted WASM, worker and proving assets.
For a subpath, use `npm run build -- --base /my-app/` and serve it at that path.
The provided Vite config keeps assets separate (`assetsInlineLimit: 0`). Apply
your host's CSP and CORS settings to those files too; do not copy only the JS.

From the SDK repository, `npm run test:example:browser` builds this application
against a freshly packed SDK and executes the local-wallet action in Firefox at
a non-root URL. It requires Firefox and geckodriver. It does not use a live
endpoint or perform a funded transaction.
