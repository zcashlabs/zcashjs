// Compile-only specification consistency; never imports or executes SDK examples.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function compile(configPath) {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath));
  assert.equal(config.errors.length, 0);
  const program = ts.createProgram(config.fileNames, config.options);
  return ts.getPreEmitDiagnostics(program);
}
const positive = compile(join(root, 'docs/api/examples/tsconfig.json'));
assert.equal(positive.length, 0, ts.formatDiagnosticsWithColorAndContext(positive, {
  getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n',
}));
console.log('PASS: complete compile-only example suite');
const temp = mkdtempSync(join(tmpdir(), 'zcash-recovery-negative-'));
try {
  const source = readFileSync(join(root, 'docs/api/examples/recovery-policy.ts'), 'utf8');
  const lines = source.split('\n');
  const expected = lines.flatMap((line, index) => {
    if (!line.includes('@ts-expect-error')) return [];
    const match = line.match(/@ts-expect-error TS(\d+):/);
    assert.ok(match, `negative assertion on line ${index + 1} needs an expected TS code`);
    return [{ line: index + 2, code: Number(match[1]) }];
  });
  assert.equal(expected.length, 9, 'review the negative contract inventory when changing cases');
  // Preserve line numbers; remove only the suppression, not the forbidden expression.
  writeFileSync(join(temp, 'negative.ts'), lines.map(line => line.includes('@ts-expect-error') ? '' : line).join('\n'));
  const config = JSON.parse(readFileSync(join(root, 'docs/api/examples/tsconfig.json'), 'utf8'));
  config.compilerOptions.paths = { '@zcashlabs/zcash.js': [join(root, 'docs/api/public-api.ts')] };
  config.include = ['./negative.ts'];
  writeFileSync(join(temp, 'tsconfig.json'), JSON.stringify(config));
  const negative = compile(join(temp, 'tsconfig.json'));
  const errors = negative.map(diagnostic => {
    assert.equal(diagnostic.file?.fileName, join(temp, 'negative.ts'));
    assert.notEqual(diagnostic.start, undefined);
    return { line: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1, code: diagnostic.code };
  });
  assert.deepEqual(errors, expected, 'every forbidden expression must have its expected diagnostic location and code');
  console.log(`PASS: all ${expected.length} forbidden cases independently produce the expected diagnostic codes`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
for (const name of readdirSync(join(root, 'docs/api/examples')).filter(name => name.endsWith('.ts'))) {
  const source = readFileSync(join(root, 'docs/api/examples', name), 'utf8');
  assert.doesNotMatch(source, /\b(?:saveOperationId|loadOperationId|savedOperationId)\b/, name);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, '@zcashlabs/zcash.js');
console.log('PASS: ID-free active examples and package identity');
console.log('No runtime recovery, protocol or durability test was executed.');
