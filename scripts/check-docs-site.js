import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { srcExclude } from '../docs/.vitepress/publication.js';

const { values } = parseArgs({ options: { base: { type: 'string', default: '/' } } });
const base = values.base;
if (!/^\/(?:[^?#]*\/)?$/.test(base)) throw Error('--base must start and end with /');
const root = fileURLToPath(new URL('../docs/.vitepress/dist/', import.meta.url));
const entries = await readdir(root, { recursive: true, withFileTypes: true });
const files = new Set(entries.filter(entry => entry.isFile())
  .map(entry => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/')));
const errors = [];
const pages = new Map();
const origin = 'https://docs.invalid';
const excluded = (path) => srcExclude.some(pattern => pattern.endsWith('/**')
  ? path.startsWith(pattern.slice(0, -2))
  : path.replace(/\.(html|md)$/, '') === pattern.slice(0, -3));
const decode = (text) => text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) =>
  entity[0] === '#' ? String.fromCodePoint(entity[1].toLowerCase() === 'x'
    ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
    : ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[entity.toLowerCase()]);

// VitePress emits quoted attributes. Ignore comments and inline script/style text,
// so code examples and JavaScript strings are not mistaken for HTML links.
function attributes(html) {
  const tags = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<(?:script|style)\b[^>]*>)[\s\S]*?<\/(?:script|style)>/gi, '$1');
  return [...tags.matchAll(/<[a-z][^>]*>/gi)].flatMap(([tag]) =>
    [...tag.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map(([, name, double, single]) => [name.toLowerCase(), decode(double ?? single)]));
}

for (const file of files) {
  if (excluded(file)) errors.push(`Excluded output: ${file}`);
  if (file.endsWith('.html')) {
    const attrs = attributes(await readFile(join(root, file), 'utf8'));
    pages.set(file, { attrs, ids: new Set(attrs.filter(([name]) => name === 'id' || name === 'name').map(([, value]) => value)) });
  }
}
if (!pages.has('index.html')) errors.push('Missing index.html; build the site first');

function check(reference, from) {
  try {
    const url = new URL(reference, `${origin}${base}${from}`);
    // Absolute links to our published site are local too; GitHub source URLs are external.
    if (url.origin === 'https://zcashlabs.github.io' && url.pathname.startsWith('/zcashjs/')) {
      url.host = 'docs.invalid';
      url.pathname = base + url.pathname.slice('/zcashjs/'.length);
    }
    if (url.origin !== origin) return;
    if (!url.pathname.startsWith(base)) throw Error('outside deployment base');
    let target = decodeURIComponent(url.pathname.slice(base.length));
    if (excluded(target)) throw Error('excluded page');
    if (!target || target.endsWith('/')) target += 'index.html';
    if (!files.has(target)) throw Error(`missing file ${target}`);
    if (url.hash && pages.has(target)) {
      const fragment = decodeURIComponent(url.hash.slice(1)).split(':~:text=')[0];
      if (fragment && !pages.get(target).ids.has(fragment)) throw Error(`missing anchor #${fragment} in ${target}`);
    }
  } catch (error) {
    errors.push(`${from}: ${reference} (${error.message})`);
  }
}

for (const [file, { attrs }] of pages) {
  for (const [name, value] of attrs) {
    if (['href', 'src', 'poster'].includes(name)) check(value, file);
    if (name === 'srcset' && !value.startsWith('data:')) {
      for (const candidate of value.split(',')) check(candidate.trim().split(/\s+/)[0], file);
    }
  }
}
for (const file of files) {
  if (!file.endsWith('.css')) continue;
  const css = await readFile(join(root, file), 'utf8');
  for (const [, reference] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) check(reference.trim(), file);
}

const indexes = [...files].filter(file => /\/\@localSearchIndex[^/]*\.js$/.test(file));
if (!indexes.length) errors.push('Missing local search index');
let documents = 0;
for (const file of indexes) {
  const index = JSON.parse((await import(pathToFileURL(join(root, file)).href)).default);
  if (!index.documentIds || !Object.keys(index.documentIds).length) errors.push(`Empty search index: ${file}`);
  for (const id of Object.values(index.documentIds ?? {})) {
    documents++;
    // VitePress search IDs omit the deployment base.
    check(base + id.replace(/^\//, ''), file);
  }
}
if (errors.length) throw Error(`Built-site validation failed:\n${errors.join('\n')}`);
console.log(`Validated ${pages.size} HTML pages and ${documents} search entries: no excluded pages, broken local links, assets, or anchors (base ${base}).`);
