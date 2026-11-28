import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

// Portable code goes through src/abort.ts and src/hash.ts (React Native lacks both APIs).
const portability = [
  { selector: "MemberExpression[object.name='AbortSignal'][property.name=/^(any|timeout)$/]",
    message: 'Use anySignal/timeoutSignal from src/abort.ts.' },
  { selector: "MemberExpression[property.name='subtle']", message: 'Use sha256 from src/hash.ts.' },
];

export default defineConfig({
  files: ['src/**/*.{ts,mts}'],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    stylistic.configs.customize({ indent: 2, quotes: 'single', semi: true, jsx: false, braceStyle: '1tbs' }),
  ],
  rules: {
    // Keep short unbraced guard returns; expand blocks and consecutive statements.
    '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
    '@stylistic/max-statements-per-line': ['error', { max: 1 }],
    '@stylistic/one-var-declaration-per-line': ['error', 'always'],
    '@stylistic/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
    '@stylistic/max-len': ['error', {
      code: 120,
      ignoreComments: true,
      ignoreUrls: true,
      ignoreRegExpLiterals: true,
      // Authenticated protocol identifiers and asset hashes stay unbroken.
      ignorePattern: "^\\s*(?:const (?:protocolRevision|revision) = |blake2b512: )'[a-z0-9:]+'[,;]?$",
    }],
    '@stylistic/no-mixed-operators': 'off',
    curly: ['error', 'multi-line'],
    'no-restricted-syntax': ['error', ...portability],
  },
}, {
  // Fallback implementations and Node-only entries may use the platform APIs directly.
  files: ['src/abort.ts', 'src/hash.ts', 'src/testing.ts', 'src/clients/grpc-node.ts'],
  rules: { 'no-restricted-syntax': 'off' },
});
