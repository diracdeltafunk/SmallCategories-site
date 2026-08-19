# SmallCategories-site

This repository contains the static website for [smallcats.info](https://smallcats.info), a browser and query interface for the [SmallCategories database](https://github.com/diracdeltafunk/SmallCategories).

The application lives in [`static-site`](static-site), while [`website-data`](website-data) preserves the public metadata and proposition values used by the build. A production build combines those files with the canonical multiplication tables from an adjacent `SmallCategories` checkout. It runs entirely in the browser and is hosted by Cloudflare Pages; it has no application server or live database dependency.

## Develop

With both repositories checked out next to one another:

```sh
npm --prefix static-site ci
npm --prefix static-site run build:production
npm --prefix static-site run preview
```

The preview is served at <http://127.0.0.1:8000>. Page markup is under `static-site/src/pages`, shared browser code is under `static-site/src`, and build scripts are under `static-site/scripts`.

Run the checks with:

```sh
npm --prefix static-site run check
npm --prefix static-site test
```

See [`static-site/README.md`](static-site/README.md) for build inputs, architecture, and deployment settings. Contributions, bug reports, and suggestions are welcome.
