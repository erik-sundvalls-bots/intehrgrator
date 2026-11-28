# Number formats in Conversion Script output

Conversion Script languages (Mapping preview, TypeScript, Handlebars, XQuery,
Go Template, Java) write numbers with a shared helper (`numeric_format.ts`,
mirrored in the Go, Java and XQuery runtimes). The spelling is chosen from the
**output document** and, when known, the **schema or RM type** of the field —
not from the language's default `String(n)` / `fn:string`.

A conversion warning is logged only when the chosen target cannot express the
value exactly (for example an integer outside ±2⁵³−1, or NaN written into
JSON). Values that are expressible, including very large or very small finite
numbers, do not warn just because languages used to print exponents
differently.

## Standards

| Target | Lexical / canonical form | Citations |
| --- | --- | --- |
| JSON (free-form JSON Schema, openEHR canonical / FLAT / STRUCTURED numbers) | RFC 8259 §6 / ECMA-404: `[minus] int [frac] [exp]`, no leading zeros, no `NaN` / `Infinity`. Shortest round-trip (ECMA-262 NumberToString / RFC 8785). Integers without `.0` (`3`, not `3.0`), unless a schema type requires a real and we still prefer the shortest valid JSON number (JSON has one number type; `3` and `3.0` are the same value). | [RFC 8259 §6](https://www.rfc-editor.org/rfc/rfc8259#section-6), [ECMA-404](https://www.ecma-international.org/publications-and-standards/standards/ecma-404/), [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) |
| XML Schema `xs:integer` (and `xs:int`, `xs:long`, …) | Optional `-`, digits only; no `+`, leading zeros, decimal point or exponent. Out-of-range values for a derived type (e.g. `xs:int`) are an error. | [XSD 1.1 Part 2 §3.4.13](https://www.w3.org/TR/xmlschema11-2/#integer) |
| XML Schema `xs:decimal` | Plain decimal, **never an exponent**. Integer-valued → no decimal point (`3`). Otherwise a decimal point, no trailing zeros, at least one digit on each side. `NaN` / `INF` are errors. | [XSD 1.1 Part 2 §3.3.3](https://www.w3.org/TR/xmlschema11-2/#decimal) |
| XML Schema `xs:double` / `xs:float` | `INF`, `-INF` and `NaN` are allowed; otherwise the same readable plain decimal as `xs:decimal` (a legal lexical form). | [XSD 1.1 Part 2 §3.3.5](https://www.w3.org/TR/xmlschema11-2/#double) |
| openEHR `DV_COUNT.magnitude` | Integer (Integer64 in later BASE). | [RM Data Types — DV_COUNT](https://specifications.openehr.org/releases/RM/latest/data_types.html#_dv_count_class) |
| openEHR `DV_QUANTITY.magnitude` | Real / Double. ITS-XML uses `xs:double` (SPECITS-53). Canonical JSON uses a JSON number. Optional `precision` is a sibling integer: `0` = integral, `-1` = unlimited, `N` = decimal places. Trailing zeros are applied in XML when `precision ≥ 0`; JSON cannot keep them, so the shortest number is used and precision stays on the attribute. | [RM Data Types — DV_QUANTITY](https://specifications.openehr.org/releases/RM/latest/data_types.html#_dv_quantity_class) |
| openEHR `DV_PROPORTION` | Numerator / denominator are Real (same forms as a quantity magnitude); `precision` as above. | [RM Data Types — DV_PROPORTION](https://specifications.openehr.org/releases/RM/latest/data_types.html#_dv_proportion_class) |
| TakeCare / example XSDs | `TemplateId` / `TemplateType` are `xs:integer`, `TermId` is `xs:int`, `Value` is `xs:decimal` (`test/fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd`). Unknown XML fields default to the `xs:decimal` form so an exponent cannot break validation. | TakeCare Casenote Write XSD in the example fixtures |

## Unexpressible values

These fail with a clear error rather than a silent `null` or a token the
schema will reject:

- `NaN`, `Infinity`, `-Infinity` in JSON, `xs:decimal` or `xs:integer`
- A non-integer in `xs:integer` / JSON Schema `integer` / `DV_COUNT.magnitude`
- A value outside the range of a derived integer type such as `xs:int`

`xs:double` may emit `NaN` / `INF` / `-INF`. Negative zero is `0` in JSON and
`xs:decimal` / `xs:integer` (no distinct value), and `-0` in `xs:double`.
