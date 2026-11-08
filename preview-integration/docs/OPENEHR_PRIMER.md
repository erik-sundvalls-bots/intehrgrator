# openEHR Primer for AI Agents

This document provides essential background on the openEHR standard to help AI agents working on this project understand the domain model and key concepts.

## What is openEHR?

[openEHR](https://www.openehr.org/) is an open standard for electronic health records (EHR). It uses a **two-level modelling** approach that cleanly separates:

1. **Reference Model (RM):** A stable, generic information model defining fundamental data types and structures (Compositions, Sections, Entries, Clusters, Elements, etc.). See the [RM specification](https://specifications.openehr.org/releases/RM/latest).
2. **Archetype Model (AM):** A constraint-based formalism that defines clinical concepts (e.g., "Blood Pressure", "Medication Order") by constraining RM classes. See the [AM specification](https://specifications.openehr.org/releases/AM/latest).

## Key RM Classes (Hierarchy)

The RM is organized as a tree of containment:

```
COMPOSITION
├── SECTION (organizes content, optional, recursive)
│   └── ENTRY (clinical content)
│       ├── OBSERVATION (measured/observed data)
│       ├── EVALUATION (clinical assessments/opinions)
│       ├── INSTRUCTION (orders/prescriptions)
│       └── ACTION (activities performed)
└── ENTRY (can also appear directly under COMPOSITION.content)
```

Each ENTRY type contains structured data via:
- **ITEM_TREE** / **ITEM_LIST** / **ITEM_TABLE** — structural containers
- **CLUSTER** — groups of related items (recursive)
- **ELEMENT** — leaf data holder, contains a `value` of a DATA_VALUE type

### Important DATA_VALUE Types
| Type | Description | Example |
|------|-------------|---------|
| `DV_TEXT` | Plain text | "Patient feels well" |
| `DV_CODED_TEXT` | Coded term (terminology binding) | SNOMED CT: 386661006 |
| `DV_QUANTITY` | Numeric + units | 120 mmHg |
| `DV_DATE_TIME` | ISO 8601 date/time | 2026-03-17T10:30:00Z |
| `DV_ORDINAL` | Ordered value from a set | Pain scale 0-10 |
| `DV_BOOLEAN` | True/false | true |
| `DV_COUNT` | Integer count | 3 |
| `DV_PROPORTION` | Ratio/percentage | 50% |
| `DV_DURATION` | ISO 8601 duration | PT30M |
| `DV_URI` | URI reference | https://example.com |
| `DV_IDENTIFIER` | Identifier with authority | MRN: 12345 |
| `DV_MULTIMEDIA` | Binary/media content | JPEG image |

### Cross-Cutting RM Structures
Optional RM classes can appear at many levels and are **not always mentioned in templates**:
- **`FEEDER_AUDIT`** — provenance/audit trail for imported data (attached to `LOCATABLE`)
- **`PARTICIPATION`** — additional participants in clinical acts
- **`PARTY_IDENTIFIED` / `PARTY_RELATED`** — actor identification
- **`LINK`** — cross-references between entries

This is critical for the mapping tool: even if a template does not mention `feeder_audit`, it is a valid RM attribute on `ENTRY` and should be insertable.

## Archetypes and Templates

- **Archetype:** A reusable, maximal-use definition of a clinical concept (e.g., `openEHR-EHR-OBSERVATION.blood_pressure.v2`). Published in the international [Clinical Knowledge Manager (CKM)](https://ckm.openehr.org/ckm/).
- **Template:** A local combination + further constraint of archetypes for a specific use case (e.g., "Vitals SignsEncounter"). Templates define what fields are mandatory, optional, excluded, or have fixed values.
- **Operational Template (OPT):** The computed, fully-expanded template used by systems at runtime. Available in XML (OPT 1.4) and JSON formats.

### The RM/AM Relationship (Critical for This Tool)

The AM (template/archetype) acts as a **schema** over the RM. Where the template is **silent** about an RM attribute:
- That attribute is **allowed in full** as defined by the RM
- But in practice, users rarely need all optional RM features
- The UI should support **progressive disclosure**: show template-defined structure first, allow expanding optional RM structures on demand

## Libraries Used in This Project

### TypeScript: `ehrtslib`
- Repository: [ErikSundvall/ehrtslib](https://github.com/ErikSundvall/ehrtslib)
- Provides TypeScript type definitions for RM classes
- Useful for generating type-safe mapping code

### Java: `Archie`
- Repository: [openEHR/archie](https://github.com/openEHR/archie)
- Full openEHR library: RM classes, template parsing, validation, serialization
- Conversion script language `java` emits Archie RM constructors (`generate(model, "java")`). Maven/Gradle coordinates and the convert-then-validate hook: [JAVA_EXPORT.md](JAVA_EXPORT.md).

## Useful Specification Links

| Resource | URL |
|----------|-----|
| openEHR Specifications (all) | https://specifications.openehr.org/ |
| RM Latest | https://specifications.openehr.org/releases/RM/latest |
| AM Latest | https://specifications.openehr.org/releases/AM/latest |
| BMM (Basic Meta-Model) | https://specifications.openehr.org/releases/LANG/latest/bmm.html |
| AOM2 (Archetype Object Model) | https://specifications.openehr.org/releases/AM/latest/AOM2.html |
| OPT2 Specification | https://specifications.openehr.org/releases/AM/latest/OPT2.html |
| Clinical Knowledge Manager | https://ckm.openehr.org/ckm/ |
| CKM-mirror (GitHub) | https://github.com/openEHR/CKM-mirror |
| openEHR REST API | https://specifications.openehr.org/releases/ITS-REST/latest |
