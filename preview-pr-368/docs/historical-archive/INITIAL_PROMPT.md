# Integration Workbench Project Prompt

## Role
You are a Principal Software Architect and full-stack Expert specializing in healthcare interoperability, specifically the [openEHR standard](https://www.openehr.org/). You have deep expertise in building visual programming interfaces using [Blockly](https://developers.google.com/blockly) and [CodeMirror](https://codemirror.net/) and configuring widgets for tree-structured data (e.g. JSON/XML schema or instance).

## Context & Goal
We are building a visual integration and mapping tool for healthcare informaticians. The goal is to map source data (JSON/XML schemas or instances) to target [openEHR](https://specifications.openehr.org/) formats — specifically into openEHR [Compositions](https://specifications.openehr.org/releases/RM/latest/ehr.html#_composition_class) conforming to [Operational Templates (OPT)](https://specifications.openehr.org/releases/AM/latest/OPT2.html).

For a concise overview of the openEHR data model and key concepts, see [docs/OPENEHR_PRIMER.md](docs/OPENEHR_PRIMER.md).

### Run Environments
The application must be architected to run in two primary environments:
A. As a **local-first web app**, served from GitHub Pages without requiring server-side calls.
B. As a **tool/plugin inside VS Code**, providing a native developer experience.

This means that shared code in the editor will be in TypeScript and that test-running of generated Java versions of conversion scripts might not be implemented to begin with, but rather be added later.

## Two-Step Implementation Process
The implementation will be deterministic to start with, based on either openEHR's formal machine-readable definitions (RM/AM/BMM) originating from the ehrtslib library (`https://github.com/ErikSundvall/ehrtslib`).

We will tackle this project in two distinct phases:

### Step 1: Foundational Blockly Blocks & Generators
We will create the general openEHR [Blockly](https://developers.google.com/blockly/guides/overview) blocks and their corresponding [code generators](https://developers.google.com/blockly/guides/create-custom-blocks/generating-code). For the detailed block design and generation strategy, see [docs/BLOCKLY_INTEGRATION.md](docs/BLOCKLY_INTEGRATION.md).
* This process should be deterministic based on openEHR's formal definitions.
* **Target Formats:** The output must support generating executable conversion scripts in both:
  1. **TypeScript** (using `ehrtslib`)
  2. **Java** (using the `openEHR/archie` library)
* **Blockly Structure:** The visual Blockly structure is must be uniform and language independend target languages (so same for both TypeScript and Java targets) so users can seamlessly switch between exporting to either language without rebuilding the visual mapping. The visual structure must also be preserved (saved/loaded) to allow later editing.
* The library of blocks must include standard control flow (loops, conditionals), string manipulation, and math calculations for complex transformations.

### Step 2: Workbench UI & Application Logic
Using the foundational blocks from Step 1, we will construct the rest of the application's logic and user interface. For the detailed split-screen layout, interaction design, and environment abstraction, see [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md).
* **Split-Screen UI:** 
  * Left Pane (Source): Displays a hierarchical tree view of the source format (JSON/XML schema (top) and instance(s) (bottom).
  * Mid Pane (Target mapping): Displays the template-driven Blockly/CodeMirror workspace for the openEHR target.
  * Right Pane (Mapped output example): An optional separate test runner pane/panel that can be used to test the mapping from example source files to generated output via the mapping script being authored in the mid pane.
* **The Mapping Hook:** An informatician focuses on an input field in the target Blockly structure, clicks a specific node in the Left Pane source tree, and an expression referencing that source node's path (e.g., `sourceData.patient.id`) is automatically inserted.
* **AI-Assisted Mapping:** Provide a feature allowing the user to call AI agents to help generate mapping suggestions. This should work both for generating suggestion of the mapping of the entire source -> target structure, and for suggesting a mapping for a specific, individual node (node selected).
* **The Template Challenge:** OpenEHR templates define/constrain the use of  template-specific Reference Model (RM) objects. However, users must also be able to insert valid RM structures (e.g., a `feeder_audit`) at allowed positions, even if those are not explicitly mentioned in the template. The UI must provide a mechanism (based on RM definitions) to allow inserting these optional valid RM classes natively (in Blockly that can be slots for inserting certain other blocks of the correct kinds). Also note that some mandatory RM classes/attributes might not be mentioned in the template, but must of course be represented in the "skeleton" mapping/target structure. 

One way of describing the AM/RM relation in openEHR is: The AM is a bit like a schema. If the AM structure (in the form of a template and its contained archetypes) does not say anything about a certain RM attribute/class, then it is allowed to be used to its fullest as described in the RM — but in reality one often just wants to use some of the optional parts, and showing all at once may lead to cognitive overload (especially recursive/expandable structures). See the [RM specification](https://specifications.openehr.org/releases/RM/latest) and [AOM2 specification](https://specifications.openehr.org/releases/AM/latest/AOM2.html) for details. The [docs/OPENEHR_PRIMER.md](docs/OPENEHR_PRIMER.md) document explains this relationship further.

## Deliverables

1. **UI Sketch (Pencil.dev):** A visual wireframe/sketch of the application interface to allow design adjustments before implementation. Note that the Pencil MCP is installed. Use design language similar to Google Material Design, but not too much fluff and whitespace. Use color scheme inspired from  https://www.karolinska.se/vard/patient-och-besokare/
2a. **Blockly blocks:** Initial generation of generic reusable Blockly blocks representing openEHR RM classes based on the RM specification and with blocky slots for adding optional substructures.
2b. **Deterministic Generator Code:** TypeScript logic that parses a template and generates the "skeleton" of Blockly blocks
2c. **Mapping UI** Combined editor with Blockly and CodeMirror views, including the mechanism to handle optional RM structure insertions securely based on the openehr RM specification. (see https://blockpy-edu.github.io/BlockMirror/docs/ for inspiration).
3. **Blockly Code Generators:** Functions that convert the visual blocks into executable TypeScript (`ehrtslib`) and Java (`Archie`) code.
4. **UI Event Logic:** The core cross-pane TypeScript logic for the "click-to-map" interaction and the AI agent calling routines.
5. **Architecture Document:** An explanation covering:
   * How the structural attachment points are validated.
   * Modularity requirements for swapping between the GitHub Pages Web App & VS Code environment bindings.

## Possible future extensions
* The above tool only helps creating the mapping scripts. Deployment, runtime hosting, and integration with EHR backends are out of scope for now.
* Integration with [openEHR REST API](https://specifications.openehr.org/releases/ITS-REST/latest) for uploading templates and compositions to live CDRs.
* Support for [FHIR](https://hl7.org/fhir/) source formats and FHIR-to-openEHR mapping.

## Supporting Documentation

**Start here:** [CONTEXT.md](CONTEXT.md) — resolved domain glossary from design sessions.

| Document | Contents |
|----------|----------|
| [docs/OPENEHR_PRIMER.md](docs/OPENEHR_PRIMER.md) | openEHR data model overview |
| [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md) | UI layout, panes, interactions, v1 scope (authoritative over early wireframes) |
| [docs/BLOCKLY_INTEGRATION.md](docs/BLOCKLY_INTEGRATION.md) | Blockly blocks and code generation |
| [docs/MAPPING_SPECIFICATION.md](docs/MAPPING_SPECIFICATION.md) | Center-pane DSL (not export code) |
| [docs/SOURCE_FORMATS.md](docs/SOURCE_FORMATS.md) | JSON/XML schema and example instances |
| [docs/SOURCE_QUERY.md](docs/SOURCE_QUERY.md) | fontoxpath source querying |
| [docs/PROJECT_PERSISTENCE.md](docs/PROJECT_PERSISTENCE.md) | Project Bundle and Mapping Model |
| [docs/AI_SUGGESTION_FORMAT.md](docs/AI_SUGGESTION_FORMAT.md) | Copy-paste AI assist response format |
| [docs/assets/prototype-ui-v1-consolidated.png](docs/assets/prototype-ui-v1-consolidated.png) | Consolidated v1 UI mockup |
| [docs/future/](docs/future/) | Deferred features |

> [old-clippings.md](old-clippings.md) is **superseded** — kept for historical reference only.