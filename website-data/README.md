# Website build data

Two small files, and between them the only content here that a human wrote.

- `propositions.json`: the eighteen proposition names, descriptions, and their
  stable bit assignments. The bit order must match `NAMES` in
  `SmallCategories/smallcats/src/propositions.rs`; changing it would silently
  reinterpret every stored mask.
- `names.json`: friendly names and descriptions, each pinned to a category by
  `(morphisms, objects, index)`. Add a row to name another category.

Everything else the site shows about a category — all eighteen propositions — is
a property of its multiplication table, computed in the generator and stored
beside the tables as `database/props<n>-<k>.txt`. There is no fingerprint join
any more, and nothing here can fall out of step with the database.

This used to also hold `categories.ndjson`, a 34 MB snapshot of proposition
masks keyed by table fingerprint. It was retired on 2026-08-25: the masks are
recomputed, and recomputing them fixed 428 categories whose `has_equalizers` and
`has_coequalizers` values were wrong.
