# SmallCats static-site migration

This directory is a parallel, static replacement for the current Express/Eta application in `../site`. It is intentionally isolated so the production application can remain unchanged until the generated site has been compared against it.

## Build

Install the pinned front-end/build dependencies, then build. By default the compiler reads the adjacent `SmallCategories` checkout:

```sh
cd static-site
npm ci
npm run build
```

Use an explicit database checkout when necessary:

```sh
node scripts/build.mjs --database /path/to/SmallCategories/database
```

The generated site is written to `dist/`. It contains the application shell plus sharded JSON representations of the category multiplication tables. Generated output is ignored by Git.

The old site's Bulma 0.9.4 visual language is kept, while the draggable quiver uses only the modular D3 selection, force, and drag packages. The build bundles these assets locally with esbuild, so rendering does not depend on a third-party CDN.

The build reads the database working tree. Check its Git status before building: local deletions or empty category files will be reflected in the output. Production builds should use a clean, pinned database commit.

## Preview

Preview the generated site with its single-page-app fallback:

```sh
npm run preview
```

The preview is available at `http://127.0.0.1:8000`. Cloudflare Pages supplies the equivalent single-page-app fallback automatically because the build intentionally has no top-level `404.html`.

## Supabase export

The basic build uses the canonical text database and supports counts, statistics, browsing, numeric queries, and canonical category detail routes. Before retiring Supabase, create a read-only export containing:

- friendly names and descriptions;
- proposition definitions;
- proposition truth values.

Create a local virtual environment and install the one export dependency:

```sh
cd static-site
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements-export.txt
```

In the Supabase dashboard, open the project, choose **Connect**, and copy a Postgres connection string. Run the exporter and paste the connection string at its hidden prompt; do not paste it into source files, Git, or chat:

```sh
npm run export:supabase
```

The exporter starts a repeatable-read, read-only transaction, validates database relationships, fingerprints multiplication tables, and writes ignored files under `export/`. It makes no database changes. Existing output is never replaced unless `--force` is supplied explicitly.

Build the complete static site with:

```sh
npm run build:export
```

Once the verified export has been preserved in the adjacent database repository, the reproducible production command is:

```sh
npm run build:production
```

The compiler matches exported database rows to canonical multiplication tables by SHA-256 fingerprint. It fails if any exported category is missing or any fact count differs. Neither category nor proposition UUIDs are retained: public category routes use `SmallCat(n,k,i)` coordinates and proposition routes use proposition names. Proposition queries run entirely in the browser.

The export is a migration artifact, not a full Postgres backup. Also capture a logical schema/data backup before cancelling Supabase. Do not cancel Supabase until the export and backup have been preserved, the generated site has been compared with production, DNS has been cut over, and the old site has remained available during a rollback window.

## Cloudflare Pages

The hosted build clones the public database repository at build time and therefore needs no secrets or running database:

```sh
npm run build:cloudflare
```

Use these Pages Git-integration settings after both migration branches have been merged to `master`:

- Framework preset: **None**
- Build command: `npm --prefix static-site ci && npm --prefix static-site run build:cloudflare`
- Build output directory: `static-site/dist`
- Root directory: leave blank

For a branch preview before merging, add the build environment variable `SMALLCATS_DATABASE_REF=migration/cloudflare-static` and ensure that branch has been pushed in both repositories. Remove the variable after merging so hosted builds use `master`.
