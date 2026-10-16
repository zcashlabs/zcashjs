import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const book = join(root, 'docs/api');
const summary = await readFile(join(book, 'SUMMARY.md'), 'utf8');
const pages = [...summary.matchAll(/^- \[.+?\]\(([^)]+\.md)\)$/gm)].map(match => match[1]);
const temporary = await mkdtemp(join(tmpdir(), 'zcash-guide-'));
try {
  const files = [];
  for (const page of pages) {
    const markdown = await readFile(join(book, page), 'utf8');
    for (const [index, match] of [...markdown.matchAll(/^```(?:ts|typescript)\n([\s\S]*?)^```/gm)].entries()) {
      const file = join(temporary, `${page}-${index + 1}.ts`);
      await writeFile(file, `export {};\n${match[1]}`);
      files.push(file);
    }
  }
  if (!files.length) throw Error('No guide examples found');
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, noEmit: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    paths: { '@zcashlabs/zcash.js': [resolve(root, 'src/index.ts')] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n',
    }));
  }
  console.log(`Checked ${files.length} displayed TypeScript examples across ${pages.length} guide pages.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
