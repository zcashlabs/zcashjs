import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitepress';

const summary = readFileSync(new URL('../api/SUMMARY.md', import.meta.url), 'utf8');
const book = [...summary.matchAll(/^- \[(.+?)\]\(([^)]+)\.md\)$/gm)]
  .map(([, text, slug]) => ({ text, link: `/api/${slug}` }));

export default defineConfig({
  title: 'zcash.js',
  description: 'Practical TypeScript guides for zcash.js clients, wallets, signing, and payment recovery.',
  lang: 'en-US',
  base: '/',
  cleanUrls: false,
  ignoreDeadLinks: false,
  themeConfig: {
    siteTitle: 'zcash.js / docs',
    nav: [
      { text: 'Developer guide', link: '/api/README', activeMatch: '/api/' },
      { text: 'Walkthrough', link: '/api/walkthrough' },
    ],
    sidebar: [
      { text: 'Start here', items: [
        { text: 'Introduction', link: '/' },
        { text: 'Repository overview', link: '/repository' },
        { text: 'Contributing', link: '/contributing' },
      ] },
      { text: 'Developer guide', items: book },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'On this page' },
    docFooter: { prev: 'Previous page', next: 'Next page' },
    returnToTopLabel: 'Back to top',
  },
  markdown: {
    // Preserve repository-relative Markdown links on GitHub, adapting only the
    // rendered site. Included root documents are served as repository pages.
    config(md) {
      md.core.ruler.after('inline', 'repository-links', (state) => {
        for (const block of state.tokens) {
          for (const token of block.children ?? []) {
            if (token.type !== 'link_open') continue;
            let href = token.attrGet('href');
            if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) continue;
            href = href
              .replace(/^(?:\.\.\/)?CONTRIBUTING\.md(?=#|$)/, '/contributing')
              .replace(/^docs\//, '/')
              .replace(/^(?:\.\/)?\.\.\//, '/')
              .replace(/public-api\.ts(?=#|$)/, 'public-api');
            token.attrSet('href', href);
          }
        }
      });
    },
  },
});
