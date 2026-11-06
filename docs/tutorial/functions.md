# Functions

A Blockly Function is a named piece of mapping logic (the definition, plus any decision tables it uses) that you can reuse in this project or hand to someone else.

Back to the [tutorial index](../TUTORIAL.md).

## Open Functions

Click **Functions** in the toolbar.

- **On this canvas** lists functions already in the mapping. Save one to disk as a function bundle.
- **Load from disk…** brings a bundle into this mapping. If the name is already used, you choose whether to replace it.
- **Function library** loads a catalog (the GitHub library, or a catalog URL you paste) so you can drop a published function onto the canvas.
- **Contribute** files a GitHub issue for review. It does not merge the function into the library by itself.

Decision tables that belong to the function travel with the bundle. Grids that are only project lookup data stay with the project; see [Sheets and decision tables](sheets-and-decision-tables.md).


## Coded text and term mappings from a Sheet

Load **Sheet coded text with equivalent term mappings** (`coded_text_from_sheet`)
from the Function library. Call it in a coded-text slot's **value** mouth; leave
**defining_code** empty. The call returns the complete `DV_CODED_TEXT`, not just
its display text. It also works as a complete value in a compatible value socket.

| Parameter | Meaning |
|---|---|
| `sheet_name` | Name of a project Sheet (not a decision table) |
| `key_column`, `key` | Header name and lookup value; first exact match wins |
| `value_column`, `code_column` | Header names for the primary display text and code |
| `primary_terminology` | Terminology ID for the primary code, not the mapped code |
| `mapping_columns` | Map of target terminology ID → code-column header |

For example, with headers `source_key`, `text`, `code`, `snomed`, `other_code`:

```text
call("coded_text_from_sheet", "medicines", "source_key", "A",
     "text", "code", "Local medicine codes",
     map("SNOMED-CT", "snomed", "Other terminology", "other_code"))
```

Each nonblank mapping cell becomes a `TERM_MAPPING` with `match = "="` and that
terminology/code as its target. Use an empty map for primary coding only. Empty
mapping cells are omitted; a missing key, display text, primary code or primary
terminology returns no value. No terminology codes are inferred. Keep code
columns as **text** to preserve leading zeroes and decimal spellings. Column
references are exact header names; missing mapping headers behave like empty
cells. The function assumes that your project data contains **equivalent**
concepts—review the clinical mappings before using them.

The bundle contains no lookup data. Keep Sheets in the project. Mapping preview,
TypeScript, Java and XQuery support the accessor. Go templates do not support
this object-valued Function.

### Cytodos / Karda examples

The mapped order set uses `beredningsform` and `administreringsvag` with
`Form_CodeValue` / `Route_CodeValue`, `text`, `code`, `snomed`. Primary terminology
remains `Cytodos value set`; only the equivalent mappings use `SNOMED-CT`. The
existing `code` column holds the template-valid codes (`2`, not `2.0000`); the
original source spelling remains in the key column. Older target goldens contain
decimal primary codes and some different labels, so they are not byte-for-byte
comparisons with this OPT. Their SNOMED mapping rows remain the reference.

The mapped treatment set reuses the function for its existing organisation role
codes (`organisation_roles` Sheet, no additional mappings). Its source schema,
instances and constrained OPT contain **no form/route fields**. No form/route,
ATC-to-SNOMED or ICD-to-SNOMED equivalences have been invented, and its target
goldens are unchanged. Adding such mappings requires supplied source data,
corresponding target slots and reviewed terminology rows.
