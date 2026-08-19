# SmallCats static-site migration

This directory is a parallel, static replacement for the current Express/Eta application in `../site`. It is intentionally isolated so the production application can remain unchanged until the generated site has been compared against it.

## Build

The build has no npm dependencies. By default it reads the adjacent `SmallCategories` checkout:

```sh
cd static-site
npm run build
```

Use an explicit database checkout when necessary:

```sh
node scripts/build.mjs --database /path/to/SmallCategories/database
```

The generated site is written to `dist/`. It contains the application shell plus sharded JSON representations of the category multiplication tables. Generated output is ignored by Git.

The build reads the database working tree. Check its Git status before building: local deletions or empty category files will be reflected in the output. Production builds should use a clean, pinned database commit.

## Preview

Any static HTTP server with single-page-app fallback can serve `dist/`. For a quick preview of top-level pages:

```sh
python3 -m http.server --directory dist 8000
```

Direct nested routes require SPA fallback, as configured for Cloudflare by `src/_redirects`.

## Supabase export

The basic build uses the canonical text database and supports counts, statistics, browsing, numeric queries, and canonical category detail routes. Before retiring Supabase, create a read-only export containing:

- existing category UUIDs;
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

The compiler matches exported database rows to canonical multiplication tables by SHA-256 fingerprint, not by a potentially stale numeric index. It fails if any exported category is missing or any fact count differs. The resulting site preserves legacy UUID URLs and supports proposition queries entirely in the browser.

The export is a migration artifact, not a full Postgres backup. Also capture a logical schema/data backup before cancelling Supabase. Do not cancel Supabase until the export and backup have been preserved, the generated site has been compared with production, DNS has been cut over, and the old site has remained available during a rollback window.
