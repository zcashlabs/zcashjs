# Maintain and publish this guide

The [developer guide](https://zcashlabs.github.io/zcashjs/) is built with VitePress from Markdown and TypeScript fences. `SUMMARY.md` defines its reading order and sidebar. Internal specifications and historical planning documents remain available at their existing URLs outside that navigation. This page retains its `gitbook.html` URL for existing links.

## GitHub Pages

GitHub Pages uses **GitHub Actions** as its publishing source. The **Documentation / GitHub Pages** workflow checks pull requests targeting `main`, pushes to `main`, and manual dispatches. It uses Node from `.nvmrc`, runs `npm ci`, `npm run docs:typecheck`, and `npm run docs:build -- --base /zcashjs/`. Only runs on `main` upload the static site and deploy to the `github-pages` environment at `https://zcashlabs.github.io/zcashjs/`.

These checks build the documentation and typecheck its examples; SDK/native builds and tests are separate contributor checks.

To check the production build locally, run `npm run docs:build -- --base /zcashjs/`, then `npm run docs:preview -- --base /zcashjs/` and open `http://127.0.0.1:4173/zcashjs/`. An ordinary local build or dev server still uses `/`.

## Edit and check

Edit the chapters directly; their displayed TypeScript blocks are the checked examples. Use function parameters for application-supplied configuration instead of fake usable endpoints or manifest digests.

```sh
npm run docs:typecheck
npm run docs:build
npm run docs:dev
```

The typecheck command checks guide snippets against `src/index.ts`, the actual package entry. It also retains the existing internal specification example checks. Typechecking does not execute transactions or prove backend compatibility.

When adding a chapter, include it in `SUMMARY.md`. The site's developer guide sidebar uses that same file. Make documentation changes in a focused PR from synced `main`.
