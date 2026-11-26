# Product stack, juxtaposition, and per-root Instance encoding

- Status: accepted
- Date: 2026-09-15
- Supersedes: [ADR 0008](0008-conversion-start-designates-product.md)

**Conversion start** remains a unique hat that designates the conversion product and is not a Scratch event (that part of ADR 0008 stands). The product is a **Product stack**, not a single capped tree. **Instance roots** have previous *and* next notches so they chain with sibling roots and with `for_each_source` / `for_each_list`. Those loops may wrap roots (product grain) as well as nested containers (today’s grain). Mapping preview and codegen walk the stack.

Fragments are **juxtaposed** with no implicit delimiter, JSON array, or newline. Glue is authorial (**Text document**: JSONL, MIME, Kafka/record framing, brackets). `convert` still returns one payload; splitting onto a queue or into files stays outside the script. `CONTRIBUTION` remains a future **Instance root**, not this stack.

**Instance encoding** lives on each general-model **Instance root**. Factory default is Canonical JSON (`canonical-json`). The dropdown offers the official openEHR instance encodings: Canonical JSON (ITS-JSON), Canonical XML (ITS-XML), Simplified FLAT JSON, Simplified STRUCTURED JSON. Mixed encodings on one stack are allowed; conversion reads the encoding per root. **Text document** has no encoding dropdown. ehrtslib deserialize presets (hybrid / compact / terse) and experimental ZipEHR / YAML are not encodings.

**Considered:** ADR 0008’s no-next-notch cap; a workspace-wide encoding; implicit JSON array / JSONL glue; an untyped statement spine under Start; shipping only ITS-JSON / ITS-XML in the first dropdown. Rejected: the cap blocked product-level loops and authorial concatenation; workspace-wide encoding cannot express MIME parts; implicit glue fights Kafka/MIME delimiters; untyped statements break VMS; FLAT and STRUCTURED are official simplified encodings (ehrtslib `serializeToFlat` / `serializeToStructured`) so they belong in the same dropdown. The hat stays — a wrapping “file” C-block is still less discoverable.
