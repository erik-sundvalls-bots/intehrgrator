# TakeCare CasenoteWrite target schema

Two XML Schema files describe the TakeCare `ProfdocHISMessage` casenote-write
envelope. **Use `TakeCare-CasenoteWrite-edit01.xsd`** as the canonical target.

| File | Role |
|------|------|
| `TakeCare-CasenoteWrite-edit01.xsd` | Canonical. Matches the XML order and fields in `casenote_write_documentation.pdf`. |
| `schema.xsd` | Was an Earlier draft via Cut&paste from TakeCare documentation. Now removed from directory|
| `casenote_write_documentation.pdf` | Vendor documentation for the write API. |

`edit01` is the better schema because:

1. **`Signed` comes before `Signer`**, matching the XML instances.
2. **`Signed` is a valid `xs:simpleType` restriction** (integer 0–1). The draft
   puts `minInclusive` / `maxInclusive` on `xs:element`, which is not legal XSD.
3. Numeric, datetime, and user keywords include a **`Value`** child, which the
   sample XML uses.
4. **`Note` is optional** on those keyword types (required only on `TextKeyWord`).

Load this file as the mapping **target** (not the source schema). A GitHub blob
or raw URL works; a local `.xsd` file should too — `.xsd` is picked with its own
filter so Windows does not hide it under generic XML types.
