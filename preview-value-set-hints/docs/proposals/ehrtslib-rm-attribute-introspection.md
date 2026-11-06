# Proposal: RM attribute introspection API for ehrtslib

**Status:** Implemented upstream (ErikSundvall/ehrtslib#63, commit on `main`)  
**Consumer context:** [intEHRgrator](https://github.com/RegionStockholm/intehrgrator) (and any tool that builds UIs or codegen from RM structure)  
**Authoritative sources:** openEHR BMM / RM specs (not hand-maintained UI tables)

> **Landed in ehrtslib:** public API at `meta/mod.ts` — see vendored `docs/RM_ATTRIBUTES.md`. intEHRgrator consumes this via `src/core/rm_meta.ts`.


## Problem

Consumers need a **runtime** answer to:

1. What attributes does RM type `T` have?
2. What is each attribute’s type name?
3. What is its multiplicity / is it mandatory?
4. Which types are `DATA_VALUE` (or subtypes of a given abstract type)?

Today ehrtslib exposes:

| Mechanism | What it gives | Gap |
|-----------|---------------|-----|
| Generated / enhanced RM classes (`openehr_rm.ts`) | Property declarations, getters/setters, `*Init` types | TypeScript types erase at runtime; dual accessors (`value` / `$value` / `_value`) and methods pollute reflection; `?:` in TS ≠ RM optional |
| `TypeRegistry` | Name ↔ constructor | No attributes or multiplicities |
| `TypeInferenceEngine` | Partial parent+property → expected type (serialization) | Incomplete; not multiplicity-aware; not a public schema API |
| `MANDATORY_RM_ATTRIBUTES` (generation helpers) | Incomplete mandatory name lists | Duplicated, not full BMM, not typed |

**Naïve runtime introspection of class instances is insufficient** for UI and progressive disclosure: optional-in-TypeScript is not the same as optional-in-RM, and property enumeration is noisy.

The BMM already carries the needed metadata (`is_mandatory`, `cardinality`, type refs) in the generation pipeline (`tasks/bmm_parser.ts` → `BmmProperty`). That knowledge should be available as a **first-class runtime (or generated) export**, not only as emitted class syntax.

## Goals

- Single source of truth aligned with BMM used to generate classes
- Stable public API for editors, validators, and codegen
- Inheritance-aware attribute lists (own + inherited)
- Clear distinction: **library = RM schema facts**; **apps = OPT/UI policy**

## Non-goals

- OPT / archetype constraint walking (AM layer — already partly covered elsewhere)
- UI-specific “what may the user insert next” filtering (see below)
- Replacing `TypeRegistry` (complement it)

## Proposed API

Suggested module: `enhanced/meta/rm_attributes.ts` (name flexible), generated from BMM as part of the existing codegen pipeline so it cannot drift from classes.

```typescript
export interface RmMultiplicity {
  min: number;
  /** `null` = unbounded */
  max: number | null;
}

export interface RmAttributeMeta {
  name: string;
  /** OpenEHR type name, e.g. `"DV_QUANTITY"`, `"List<LINK>"`, `"PARTY_PROXY"` */
  typeName: string;
  multiplicity: RmMultiplicity;
  /** True when BMM marks the property mandatory (`is_mandatory` / lower bound ≥ 1) */
  mandatory: boolean;
  /** Declaring type in the inheritance chain, e.g. `"LOCATABLE"` */
  declaredIn: string;
  documentation?: string;
  /** True when the attribute type is abstract / polymorphic (e.g. `DATA_VALUE`, `PARTY_PROXY`) */
  polymorphic?: boolean;
}

/** Own + inherited attributes for `rmType`, in a stable order (declaredIn ancestry then name). */
export function attributesFor(rmType: string): RmAttributeMeta[];

/** Only attributes declared directly on `rmType` (no inheritance). */
export function ownAttributesFor(rmType: string): RmAttributeMeta[];

export function isSubtypeOf(rmType: string, ancestor: string): boolean;

export function isDataValueType(rmType: string): boolean;

/** Concrete (non-abstract) subtypes, e.g. `subtypesOf("DATA_VALUE")` → `DV_*` leaves. */
export function subtypesOf(rmType: string, opts?: { concreteOnly?: boolean }): string[];

/** Ancestor chain including `rmType`, root last or first — pick one and document. */
export function ancestorsOf(rmType: string): string[];
```

### Derivation rules (from existing `BmmProperty`)

| BMM | `RmAttributeMeta` |
|-----|-------------------|
| `is_mandatory === true` or cardinality lower ≥ 1 | `mandatory: true`, `multiplicity.min ≥ 1` |
| container + `cardinality` | `min`/`max` from cardinality; `max: null` if `upper_unbounded` |
| single optional property | `{ min: 0, max: 1 }` |
| `type` / `type_def` | normalised `typeName` string (same conventions as TS generator) |

Exclude BMM **functions** from `attributesFor` (methods are not mappable fields).

### Relationship to `TypeRegistry`

```text
TypeRegistry     → construct / deserialize instances
rm_attributes    → describe schema for UI, validation, progressive disclosure
```

Both should agree on type name strings (`"DV_QUANTITY"`, not class `name` quirks).

## Out of scope for ehrtslib: `validAttachments(...)`

An earlier consumer sketch proposed:

```typescript
validAttachments(parentType: string): AttachmentMeta[]
```

**That should not live in ehrtslib.** Reasons:

1. **Not a pure RM operation.** “What can I attach?” in a mapping workbench also depends on:
   - which attributes the **OPT/template already constrains**
   - which children are **already present** on the instance / Blockly tree
   - product policy (hide rarely used LOCATABLE extras, group picker labels, etc.)
2. **ehrtslib already answers the RM half** via `attributesFor(parent)`:
   - optional attributes → candidates for insertion
   - `typeName` + `polymorphic` → which block/types to offer
3. **Keeps the library generic.** Serializers, validators, and non-UI tools should not inherit workbench vocabulary (“attachment”, “picker”).

**Consumer pattern (intEHRgrator):**

```typescript
const candidates = attributesFor(parentRmType)
  .filter((a) => !a.mandatory)
  .filter((a) => !presentAttributes.has(a.name))
  .filter((a) => !templateConstrained.has(a.name));
// map to picker options; resolve polymorphic typeName via subtypesOf(...)
```

Today’s hand-maintained `rm_attachment_catalog.ts` becomes a thin policy layer over `attributesFor`, not a parallel RM encyclopedia.

## Implementation sketch

1. Extend the BMM → TS pipeline (`tasks/ts_generator.ts` / adjacent) to emit a generated meta table, e.g. `generated/rm_attribute_meta.ts`.
2. Re-export a stable facade from `enhanced/meta/` (hand-written thin API over generated data).
3. Unit tests: spot-check against known RM facts, e.g.:
   - `ELEMENT.value` → type `DATA_VALUE`, optional (`0..1`)
   - `LOCATABLE.feeder_audit` → `FEEDER_AUDIT`, `0..1`
   - `LOCATABLE.links` → `List<LINK>` / `0..*`
   - `DV_QUANTITY.magnitude` / `units` multiplicities per BMM
   - `isDataValueType("DV_CODED_TEXT") === true`
4. Optionally deprecate duplicate `MANDATORY_RM_ATTRIBUTES` islands by deriving them from `attributesFor(...).filter(a => a.mandatory)`.

## Why not parse class source / reflect at runtime?

| Approach | Verdict |
|----------|---------|
| Reflect on constructed instances | Noisy; no multiplicities; TS optionality ≠ RM |
| Parse `openehr_rm.ts` AST in the consumer | Fragile; duplicates generator; wrong layer |
| **Generate meta from BMM beside classes** | Same source as classes; runtime-cheap; correct multiplicities |

## Acceptance criteria

- [ ] `attributesFor` / `subtypesOf` / `isDataValueType` public and documented
- [ ] Data generated from BMM (or proven equivalent), not a hand-edited mega-table
- [ ] Inheritance and container multiplicities covered by tests
- [ ] No UI/OPT-specific attachment helper in the library API
- [ ] Version / RM release of the BMM source recorded in generated file header

## Example consumer (Blockly progressive disclosure)

```typescript
const attrs = attributesFor("DV_QUANTITY");
const visible = attrs.filter((a) => a.mandatory);
const more = attrs.filter((a) => !a.mandatory);
// render `visible` inline; expose `more` behind “+ fields”
```

## References

- openEHR BMM / LANG specs (attribute multiplicity)
- ehrtslib `tasks/bmm_parser.ts` (`BmmProperty`)
- ehrtslib `enhanced/serialization/common/type_registry.ts`
- openEHR RM `common` / `data_types` (LOCATABLE feeder_audit/links; DATA_VALUE hierarchy)
