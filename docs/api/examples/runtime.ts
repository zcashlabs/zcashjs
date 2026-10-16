import type { RuntimeOptions, WasmArtifact } from "@zcashlabs/zcash.js";

// Application-owned synthetic pins; no deployed artifacts or valid release digests implied.
export const baseline = {
  manifestUrl: 'https://assets.example.invalid/zcash/baseline/manifest.json',
  manifestSha256: '0'.repeat(64),
} satisfies WasmArtifact;
export const threaded = {
  manifestUrl: 'https://assets.example.invalid/zcash/threaded/manifest.json',
  manifestSha256: '1'.repeat(64),
} satisfies WasmArtifact;
export const threading = {
  mode: 'prefer-threaded', artifact: threaded, workers: 2, startupTimeoutMs: 15_000,
} satisfies RuntimeOptions['threading'];
