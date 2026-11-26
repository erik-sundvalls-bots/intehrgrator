# XQuery engine golden tests (Cloud Agents)

Generated `.xq` conversion scripts **can** execute in-app Test Run (lazy-loaded fontoxpath + slimdom; issue #78). To verify mappings against a real XQuery 3.1 engine in CI or Cloud Agent VMs, use **BaseX**.

## Recommended engine: BaseX

| Criterion | BaseX | Saxon-HE | eXist-db |
|-----------|-------|----------|----------|
| Install size | Small (~15 MB zip) | Java jar + license file | Server footprint |
| XQuery 3.1 + maps | Yes (`json:parse`) | Yes | Yes (config varies) |
| CLI one-shot | `basex -q '…'` | `java -jar saxon-he.jar -qs:…` | Needs running DB |
| Cloud Agent fit | **Best** — download zip, add to `PATH` | Good (Java 21 already on image) | Heavier |

**Choice:** BaseX 11.x for optional golden tests (`test/xquery_engine_test.ts`). Saxon-HE remains a valid alternative for teams already on Saxon; the generated `.xq` targets XQuery 3.1 without engine-specific extensions.

## Cloud Agent / CI setup

### BaseX (preferred)

```bash
# One-time in environment setup or snapshot
BASEX_VERSION=11.0
curl -fsSL "https://files.basex.org/releases/${BASEX_VERSION}/BaseX110.zip" \
  -o /tmp/BaseX110.zip
unzip -q /tmp/BaseX110.zip -d "$HOME"
export PATH="$HOME/basex/bin:$PATH"
```

Verify:

```bash
basex -v
deno test -A test/xquery_engine_test.ts
```

Override the binary with `BASEX_CMD=/opt/basex/basex/bin/basex` if `basex` is not on `PATH`.

### Saxon-HE (alternative)

Java 21 is on the Cloud Agent image. Download Saxon-HE 12.x, then:

```bash
java -jar saxon-he-12.5.jar -qs:"declare variable \$source external; …" -s:.
```

External JSON maps need a small wrapper (Saxon does not ship `json:parse` in all editions the same way BaseX does). Prefer BaseX for map-shaped Example Instance JSON unless you already standardise on Saxon.

## Binding `$source`, `$defaults`, and `$sheets`

Export emits:

```xquery
declare variable $source external;
declare variable $defaults as map(*) external := map {};
declare variable $sheets as map(*) external := map {};
```

**JSON Example Instance** (typical intEHRgrator Test Run input):

1. Parse once in the query prolog (what `test/xquery_engine_test.ts` does):

   ```xquery
   declare variable $source as map(*) := parse-json('{"measurements":[{"pulse":72}]}');
   ```

   BaseX 11 implements XPath 3.1 `parse-json`; older `json:parse` returns a document node and is **not** compatible with map `?key` navigation in generated scripts.

2. Or pass a file path from BaseX:

   ```bash
   basex -b 'source=parse-json(unparsed-text("source.json"))' convert.xq
   ```

**XML source:** bind `$source` to a document node (`doc('source.xml')/*`).

**Defaults map:** bind `$defaults` when slots use `maps_get("defaults", …)`:

```bash
basex -b 'defaults=map{"language":"en"}' convert.xq
```

## Sheet accessors (`$sheets`)

Project Sheets bind as a nested map (readable in BaseX/Saxon step-through):

```xquery
map {
  "icd10_snomed": map {
    "headers": ["code", "snomed", "rubric"],
    "rows": [ map { "code": "I10", "snomed": "38341003", "rubric": "Hypertension" } ],
    "values": [ ["I10", "38341003", "Hypertension"] ],
    "kind": "sheet"
  }
}
```

Decision tables add `hitPolicy`, `decisionColumns`, `rowCatchAll`, `collectJoin`, and `collectDedupe`. Generated helpers: `local:sheet-lookup`, `local:sheet-get-*`, `local:decision-table`.

BaseX JSON bind (same `parse-json` style as `$source`):

```xquery
declare variable $sheets as map(*) := parse-json('{
  "icd10_snomed": {
    "headers": ["code", "snomed"],
    "rows": [{ "code": "I10", "snomed": "38341003" }],
    "values": [["I10", "38341003"]],
    "kind": "sheet"
  }
}');
```

In-app Test Run passes the convert-time Sheet bag through the same shape (`sheetsBagToXQueryMap`).

## What golden tests assert today

`test/xquery_engine_test.ts` (skipped when `basex` is missing):

- `for_each_source` over `$.measurements` produces one `<loop>` per source item
- Relative paths (`pulse`, `timestamp`) resolve against the loop variable
- `DV_QUANTITY` / `DV_DATE_TIME` magnitudes and values match the Example Instance JSON
- In-app path: `test/xquery_runtime_test.ts` (fontoxpath; no BaseX required)

Full COMPOSITION RM XML emit uses `generate(model, "xquery", { skeleton, instanceShape: "xml" })` (issue #75). Preview ≡ XQuery clinical values are covered in `test/vms_golden_test.ts`.

## Related

- [xquery-export-investigation.md](../future/xquery-export-investigation.md) — emission model
- [ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md) — preview vs generated script oracles
