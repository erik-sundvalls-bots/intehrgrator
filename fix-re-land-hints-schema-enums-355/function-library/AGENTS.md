# Accepting Function library contributions

Contribute files a GitHub issue (`Function library: <name>`); humans review. Do not auto-merge.

When an issue is accepted:

1. Save the issue’s Function definition JSON as `function-library/<safe-name>.intehr-function.json` (`kind` `intehrgrator-function`, `version` 1). Keep the author’s description. Accept both **value** (`procedures_defreturn`, `hasReturn: true`) and **statement** (`procedures_defnoreturn`, `hasReturn: false`) Functions. `procedures_ifreturn` belongs in the definition body, not as its own library entry.
2. Append one object to `catalog.json` `functions[]`: unique `id`, `name`, `title`, `description`, relative `file`, plus `locale` / `parameters` / `hasReturn` / `returns` / `decisionTables` when known.
3. Add one row to `index.md` (id, name, locale, params, returns, Decision tables, one-line what).
4. Name clash with an existing `id` or Function name: rename the incoming Function and its Decision tables unless the issue explicitly replaces the starter.
5. Starters only: regenerate Swedish/Oxford JSON with `deno task generate:function-library` when `grammatical_join.ts` changes — not for third-party contributions.

Done when `catalog.json`, the JSON file, and `index.md` all name the same `id`.
