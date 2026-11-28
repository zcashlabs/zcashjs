// Runs on Hermes in zakura-hermes-host: React Native's environment, the companion
// package's URL setup, then the SDK's React Native build with the shared checks.
import './environment.mjs';
import '../../../packages/react-native/url.js';
import * as sdk from '../../../dist/react-native/index.js';
import { viewingChecks } from '../../sdk/viewing-checks.js';
import { birthdayChecks } from '../../sdk/birthday-checks.js';
import { pcztChecks } from '../../sdk/pczt-checks.js';
import { signerChecks } from '../../sdk/signer-checks.js';
import { checks } from '../../../examples/react-native/checks.js';

const directory = globalThis.__hostScratch;
(async () => {
  const results = { engine: typeof HermesInternal === 'object' ? 'hermes' : 'other', wasm: typeof WebAssembly };
  results.viewing = await viewingChecks(sdk);
  results.birthday = await birthdayChecks(sdk);
  results.pczt = await pcztChecks(sdk);
  results.signer = await signerChecks(sdk);
  const lines = [];
  await checks(sdk, directory, line => lines.push(line));
  results.example = lines;
  console.log(JSON.stringify(results));
  globalThis.__hostDone = true;
})().catch(error => {
  globalThis.__hostError = `${error?.code ?? ''} ${error?.message ?? error}\n${error?.stack ?? ''}`;
  globalThis.__hostDone = false;
});
