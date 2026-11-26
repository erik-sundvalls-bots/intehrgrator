> **⚠️ SUPERSEDED** — This file is an early brainstorming draft. Do not use it for implementation decisions.
>
> **Canonical sources:**
> - [INITIAL_PROMPT.md](INITIAL_PROMPT.md) (this archive) — project goals, two-step process, deliverables
> - [CONTEXT.md](CONTEXT.md) — domain glossary (resolved terminology)
> - [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md) — UI layout, panes, interactions, v1 scope
> - [docs/BLOCKLY_INTEGRATION.md](docs/BLOCKLY_INTEGRATION.md) — Blockly blocks and generators
> - [docs/SOURCE_FORMATS.md](docs/SOURCE_FORMATS.md) · [docs/SOURCE_QUERY.md](docs/SOURCE_QUERY.md) — source formats and fontoxpath
> - [docs/PROJECT_PERSISTENCE.md](docs/PROJECT_PERSISTENCE.md) — Project Bundle / Mapping Model
> - [docs/AI_SUGGESTION_FORMAT.md](docs/AI_SUGGESTION_FORMAT.md) — copy-paste AI assist format
> - [docs/future/](docs/future/) — deferred features (wildcard mapping, integrated AI, XSD, text-first editor)
>
> Preserved below for historical reference only.

---

You are a Principal Software Architect and TypeScript expert specializing in healthcare interoperability, specifically the openEHR standard. You have deep expertise in building visual programming interfaces using Blockly and CodeMirror.

I am building a visual integration and mapping tool for healthcare informaticians. The goal is to map source data (JSON/XML schemas or instances) to target openEHR formats. The output will be an executable TypeScript conversion script using the ehrtslib library (https://github.com/ErikSundvall/ehrtslib).

## The Target Structure Challenge

 The target structure is not just a flat list of classes. It is a large, hierarchical tree primarily driven by a user-selected openEHR Template. This template defines the mandatory and template-specific Reference Model (RM) objects. However, the informatician must also be able to insert other valid RM structures (e.g., adding a feeder_audit object) at allowed positions in the tree, even if those structures are not explicitly mentioned in the template.

I need you to design the architecture and write the core TypeScript logic for this tool.

## Key Requirements:

1. Template-Driven & RM-Aware Blockly Generator
   * Write a TypeScript generator that parses an openEHR template definition and generates the corresponding "skeleton" of Blockly blocks (representing the mandatory and template-constrained tree structure).
   * Crucial: Implement a mechanism (e.g., a context menu or dynamic toolbox) that uses the ehrtslib RM definitions to allow users to insert optional, valid RM classes (like feeder_audit) at permitted attachment points within the template skeleton, enforcing RM compliance. One option is to have non-mandatory blockly slots for such extre RM information
   * Include standard Blockly control flow (loops, conditionals), string manipulation, and math calculation blocks for complex transformations.
2. Code Generation (Blockly to TypeScript)
   * Write the corresponding Blockly code generator functions (Blockly.TypeScript[...]) for these openEHR blocks.
   * The evaluated blocks must generate valid, executable TypeScript code that instantiates and populates the tree of ehrtslib classes. Note that ehrtslib has support for compact radable typescript generation for openEHR.
3. Split-Screen UI & Interaction Model Architecture
 Provide the conceptual architectural design and the core TypeScript event-listener logic for this UI:
   * Left Pane (Source): Displays a tree view of the source format (JSON/XML schema or instance).
   * Right Pane (Target): Displays the template-driven Blockly/CodeMirror workspace.
   * The Mapping Hook: Write the logic where an informatician focuses on (selects?) a field in the target Blockly structure, clicks a specific node in the Left Pane, and an expression referencing that source node's path (e.g., sourceData.patient.id) is automatically inserted. An alternative way of work could be to have a "wildcard" blockly block that the informaticien can insert at a point and then in the next step click on source node to replace the wildcard with a specific source node mapping
   * The RM Insertion Hook: Briefly describe the UI interaction for adding an unmentioned RM object (like feeder_audit) to a valid node in the template skeleton. Again, one option is to have non-mandatory blockly slots for such extra RM fields.


## Deliverables:
  * TypeScript code for the generator that handles both the template skeleton and optional RM insertions based on ehrtslib. (Note that ehrtslib can generate three detail levels of examples from an operational template or a fileset from archetype designer)
  * An example of the Blockly-to-TypeScript code generation for an RM class.
  * The TypeScript event handling code for the click-to-map UI interaction.
  * A brief architectural explanation of how the UI ensures users can only add optional RM blocks at valid structural attachment points.
 

Further clarifications: 
1. Add a second Target format, in addition to the typescript version we also want to be able to create conversion scripts in Java using the openEHR library Archie https://github.com/openEHR/archie . Preferably the blockly structure should be the same for typescript and Java so that the user can choose to produce conversion scripts in either of the languages
2. make it clear that this is a two-step implementation process. First We need to create the General openEHR blockly blocks and multiple code generators (for both Java and typescript). Preferably this process should be deterministic to start with based on openEHRs formal machine readable definitions that you can find represented in the Ehrtslib. Then we will use this as building blocks when creating the rest of the logic and user interface of the integration workbench application
3. Make the user interface sketch using pencil.dev So that the developer can adjust it before it is being implemented , and also to make it easier to modify it during the Project
