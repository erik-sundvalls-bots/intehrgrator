# Redesign: Constants vs. Runtime Context Variables & Scaffolding

**Status:** Proposed design  
**Date:** 2026-09-29  
**Replaces/Extends:** [ADR 0011](../adr/0011-default-context-map-runtime-keys.md), [ADR 0002](../adr/0002-convert-time-defaults.md), [default-context-map.md](default-context-map.md)  
**Parent Initiative:** Usability and pedagogical redesign of intEHRgrator inputs, constants, and runtime context.

---

## 1. Executive Summary & Problem Statement

In test-user evaluations of intEHRgrator, the existing **Default Context Map** (`default_context_map` canvas block) has consistently proven confusing:

1. **Conflation of Constants and Runtime Inputs**:
   - The default context map treats all entries identically. A fixed build-time default (such as default language `"sv"`, character encoding `"UTF-8"`, or fixed territory `"SE"`) is treated the exact same way as a truly dynamic, per-message runtime parameter (such as encounter `time`, active practitioner `composer`, or clinic `facility`).
   - In generated TypeScript and Java code, both are looked up dynamically from an incoming map at runtime (`defaults["language"]` or `defaults.get("language")`). This is inefficient, prevents constant-folding and compiler optimizations, and blurs the architectural contract of what a caller must or can provide.

2. **Opaque Caller Integration**:
   - Downstream integration engineers who receive the generated TypeScript or Java conversion scripts find it unclear how the incoming hash map is passed, which keys are required versus optional, what fallback rules apply, and how to wire the script into real integration pipelines (Node.js/Deno, Camel, Spring Boot, Intersystems, etc.).

3. **Opaque Chip-Based Wildcard Editing**:
   - Scaffold targets on entries currently use a chip-based widget (`FieldScaffoldTargets`) rendered via SVG `foreignObject`. Users cannot edit the target string using the keyboard, and the click behavior (toggling between `*.attribute` and `Class.attribute`) is hidden and counterintuitive. Users need direct, transparent text-field editing for scaffold target wildcards.

4. **Pedagogical Disconnect in Blockly**:
   - Pinned to $(x=20, y=20)$ on the canvas, the monolithic `default_context_map` block feels alien compared to standard visual programming. Users expect to find **Variables** and **Constants** in the toolbox, understand where inputs come from (Source payload vs. Context metadata vs. Static constants), and easily apply or re-apply scaffolding patterns to existing skeletons.

This document sets out the comprehensive architecture to address these problems, establishes clear language-level mechanisms for constants and dynamic context variables, defines the UI/UX improvements, and breaks the implementation down into testable steps.

---

## 2. Core Architectural Model

### 2.1 Constants vs. Runtime Context Variables

We formally separate the concepts of **Constants** and **Runtime Context Variables**:

```
                       ┌────────────────────────────────────────────────────────┐
                       │          intEHRgrator Transformation Inputs            │
                       └────────────────────────────────────────────────────────┘
                                     │                     │
               ┌─────────────────────┴───────────┐         │
               ▼                                 ▼         ▼
     ┌───────────────────┐             ┌──────────────────────┐   ┌───────────────────────┐
     │   Source Data     │             │  Runtime Context     │   │   Script Constants    │
     │  (Message/Doc)    │             │      Variables       │   │   (Static Config)     │
     ├───────────────────┤             ├──────────────────────┤   ├───────────────────────┤
     │ • XML / JSON body │             │ • Encounter time     │   │ • Default language    │
     │ • XPath / JSONPath│             │ • Authenticated user │   │ • Character encoding  │
     │ • Varies per msg  │             │ • Calling facility   │   │ • Default territory   │
     │ • Primary payload │             │ • Passed in Hash Map │   │ • Immutable in script │
     └───────────────────┘             └──────────────────────┘   └───────────────────────┘
```

| Dimension | Script Constant | Runtime Context Variable |
|---|---|---|
| **Mutability** | Fixed at authoring/compile time. | Dynamic per conversion execution. |
| **Source of Value** | Authored inside the intEHRgrator project. | Supplied by runtime caller via context map. |
| **Test Execution** | Uses the authored value. | Uses an authored **Test Value** during Test Run. |
| **TypeScript Codegen** | Top-level module `const NAME = ...;` | Key lookup in `context` parameter: `context["key"]`. |
| **Java Codegen** | Class field `private static final ... NAME = ...;` | Key lookup in `context` map: `context.get("key")`. |
| **Go Template Codegen** | Top-level variable definition `{{ $NAME := ... }}`. | Map lookup in pipeline context: `{{ index .Context "key" }}`. |
| **XQuery Codegen** | Module variable `declare variable $local:NAME := ...;`. | Function parameter lookup `$context("key")`. |
| **Scaffolding** | Can specify target wildcards (e.g. `*.language`). Plugs constant reference. | Can specify target wildcards (e.g. `*.time`). Plugs context lookup. |

---

## 3. Language-Specific Code Generation & Runtime Integration

### 3.1 TypeScript / ehrtslib

#### Codegen Pattern
Constants are emitted as module-level constants at the top of the file (or immediately above the conversion function). Context variables are accessed from an explicit, well-documented `context` parameter:

```typescript
// Generated by intEHRgrator — Conversion Script (TypeScript / ehrtslib)
// Template: openEHR-EHR-COMPOSITION.encounter.v1
// 
// === RUNTIME INTEGRATION GUIDE ===
// To execute this conversion script:
//   import { convertSourceToComposition } from "./conversion_script.ts";
//   const result = convertSourceToComposition(sourceCtx, context);
//
// Parameters:
//   1. sourceCtx: { format: "json" | "xml", data: unknown }
//   2. context: Record<string, unknown> (Dynamic context variables):
//        - composer: string | PartyIdentified (Authoring practitioner)
//        - facility: string (Healthcare facility identifier)
//        - encounter_time: string (ISO 8601 timestamp)

import {
  COMPOSITION,
  CODE_PHRASE,
  DV_TEXT,
  PARTY_IDENTIFIED,
} from "ehrtslib/openehr_rm.ts";

// --- Script Constants (Zero-overhead, immutable) ---
const DEFAULT_LANGUAGE = "sv";
const DEFAULT_TERRITORY = "SE";
const DEFAULT_ENCODING = "UTF-8";

export type SourceContext = { format: string; data: unknown };

export function convertSourceToComposition(
  sourceCtx: SourceContext,
  context: Record<string, unknown> = {},
  sheets: Record<string, unknown> = {},
): COMPOSITION {
  return new COMPOSITION({
    language: new CODE_PHRASE({
      terminology_id: "ISO_639-1",
      code_string: DEFAULT_LANGUAGE, // Direct constant reference!
    }),
    territory: new CODE_PHRASE({
      terminology_id: "ISO_3166-1",
      code_string: DEFAULT_TERRITORY, // Direct constant reference!
    }),
    composer: new PARTY_IDENTIFIED({
      name: String(context["composer"] ?? "Unspecified"), // Runtime context lookup!
    }),
    // ...
  });
}
```

### 3.2 Java / Archie

#### Codegen Pattern
Constants are emitted as `private static final` fields. The `convert` method receives `Map<String, Object> context`:

```java
package se.regionstockholm.intehrgrator.generated;

import com.nedap.archie.rm.composition.Composition;
import com.nedap.archie.rm.datatypes.CodePhrase;
import com.nedap.archie.rm.generic.PartyIdentified;
import java.util.Map;
import java.util.LinkedHashMap;

/**
 * Generated by intEHRgrator — Conversion Script (Java / Archie)
 * Template: openEHR-EHR-COMPOSITION.encounter.v1
 *
 * RUNTIME USAGE:
 *   ConversionScript script = new ConversionScript();
 *   Map<String, Object> context = Map.of(
 *       "composer", "Dr. Jane Doe",
 *       "facility", "Karolinska University Hospital",
 *       "encounter_time", "2026-09-29T08:00:00Z"
 *   );
 *   Composition comp = script.convert(sourcePayload, context);
 */
public class ConversionScript {
  // --- Script Constants (JIT-optimized static constants) ---
  private static final String DEFAULT_LANGUAGE = "sv";
  private static final String DEFAULT_TERRITORY = "SE";
  private static final String DEFAULT_ENCODING = "UTF-8";

  private Object sourceRoot;
  private Map<String, Object> context = Map.of();
  private Map<String, Sheet> sheets = Map.of();

  public Composition convert(Object source, Map<String, Object> context) {
    return convert(source, context, Map.of());
  }

  public Composition convert(Object source, Map<String, Object> context, Map<String, Sheet> sheets) {
    this.sourceRoot = source;
    this.context = context != null ? context : new LinkedHashMap<>();
    this.sheets = sheets != null ? sheets : new LinkedHashMap<>();

    Composition composition = new Composition();
    composition.setLanguage(new CodePhrase(DEFAULT_LANGUAGE));
    composition.setTerritory(new CodePhrase(DEFAULT_TERRITORY));
    
    PartyIdentified composer = new PartyIdentified();
    composer.setName(asString(this.context.get("composer")));
    composition.setComposer(composer);

    return composition;
  }
}
```

### 3.3 Test Run Environment (ehrtslib / Workbench)

In the Workbench mapping preview:
- Constants always evaluate to their authored static value.
- Runtime Context Variables evaluate to their specified **Test Value** (e.g. `composer: "Dr. Alice Smith"`).
- In the **Conversion Test Run(s)** tab in the right-hand drawer:
  - An interactive **Runtime Context** sub-panel displays the active test values.
  - Test users can tweak context values (e.g. simulate a missing facility or a different clinician) and immediately observe the Test Run output without altering the canvas definition blocks.

---

## 4. Scaffolding & Wildcards: From Opaque Chips to Editable Block Fields

### 4.1 The Problem with the Current Chip Widget
In the current implementation:
- `FieldScaffoldTargets` is a custom SVG `foreignObject` rendering mini HTML buttons.
- Clicking a chip toggles between `*.attr` and `Parent.attr`.
- There is no text cursor, no copy-paste capability, and no keyboard accessibility.
- Entering a custom path or wildcard (e.g. `OBSERVATION.*.time`) is impossible through the UI without code edits.

### 4.2 The Solution: Direct In-Block Text Field Editing
We replace the opaque chip widget with an explicit **Scaffold Target Field** (`FieldTextInput`):

```
┌─ Constant ────────────────────────────────────────────────────────┐
│ Name: [ DEFAULT_LANGUAGE ]    Value: [ "sv" ]                    │
│ Scaffold Target: [ *.language                              ] [⚡] │
└───────────────────────────────────────────────────────────────────┘

┌─ Context Variable ────────────────────────────────────────────────┐
│ Name: [ composer ]            Test Value: [ "Dr. Alice" ]        │
│ Scaffold Target: [ COMPOSITION.composer                    ] [⚡] │
└───────────────────────────────────────────────────────────────────┘
```

#### Key Capabilities:
1. **Direct Keyboard Editing**:
   - The user can click into the field and type any target expression:
     - Wildcard: `*.language` (matches `language` in any container)
     - Qualified path: `COMPOSITION.composer`
     - Nested wildcard: `EVENT_CONTEXT.health_care_facility`
     - Multiple comma-separated targets: `*.language, COMPOSITION.language`
2. **Drag & Drop Target Schema Integration**:
   - When a user drags a node or leaf from the **Target schema** tree over the block, dropping it populates or appends to the text field automatically.
3. **Syntax Helper / Quick Toggle Button `[⚡]`**:
   - A small action icon next to the field allows one-click toggling:
     - `COMPOSITION.composer` $\leftrightarrow$ `*.composer`
   - Shows a clean popover explaining wildcard rules if clicked with help.

---

## 5. Pedagogical Placement in Blockly: "Variables & Constants"

### 5.1 Category Organization in Toolbox

To align with user intuition, we establish a clean mental model in the toolbox:

```
┌────────────────────────────────────────────────────────┐
│  TOOLBOX CATEGORIES                                    │
├────────────────────────────────────────────────────────┤
│  🔍 Search                                             │
│                                                        │
│  [📥 Source]               <-- Incoming document payload│
│                                (XPath, JSON queries)   │
│                                                        │
│  [📐 Variables & Constants] <-- Metadata, parameters &  │
│                                static definitions      │
│                                                        │
│  [🏥 openEHR Types]        <-- Target structure blocks │
│                                (COMPOSITION, DV_TEXT)  │
│                                                        │
│  [⚙️ Logic & Math]          <-- Transforms & helpers    │
│  [📝 Text]                                             │
│  [📊 Lists & Maps]                                     │
│  [📋 Sheets]               <-- Decision tables & grids │
└────────────────────────────────────────────────────────┘
```

#### Why Not Combine Source with Variables?
- **Source** blocks represent *queries* against the incoming XML/JSON hierarchical document (they evaluate XPath or JSONPath).
- **Variables & Constants** represent *declared scalar/object values* (constants and runtime parameters).
- Keeping them as adjacent, distinct categories is pedagogically clear:
  1. *Source*: "What values do I extract from the message payload?"
  2. *Variables & Constants*: "What static values or runtime parameters do I have?"
  3. *openEHR Types*: "What target slots am I filling?"

### 5.2 Contents of "Variables & Constants" Drawer

Inside the **Variables & Constants** category:
1. **Constant Definition**:
   - Block: `define_constant`
   - Fields: `NAME`, `VALUE` (input connection), `SCAFFOLD_TARGET` (text field).
2. **Constant Getter**:
   - Block: `constant_get`
   - Dropdown of declared constants (or text field): `constant [ DEFAULT_LANGUAGE ]`.
3. **Context Variable Definition**:
   - Block: `define_context_var`
   - Fields: `NAME`, `TEST_VALUE` (input connection), `SCAFFOLD_TARGET` (text field).
4. **Context Variable Getter**:
   - Block: `context_var_get`
   - Dropdown of declared context variables: `context var [ composer ]`.
5. **Standard Blockly Variables**:
   - `for_each_list` iteration items, loop index/length, local scratch variables.

### 5.3 Canvas Organization

Instead of an intimidating monolithic table pinned to $(20, 20)$ that users don't know how to interact with:
- **Modular Declarations**:
  - Constants and Context Variables can be defined as structured declaration blocks.
  - They can be grouped in a clean container or placed cleanly in a dedicated "Definitions" header area of the canvas.
  - Existing openEHR factory presets (e.g. language, territory, encoding, composer, facility, time) load cleanly separated into:
    - **Constants**: `DEFAULT_LANGUAGE` ("sv"), `DEFAULT_TERRITORY` ("SE"), `DEFAULT_ENCODING` ("UTF-8").
    - **Context Variables**: `composer`, `facility`, `encounter_time`.

---

## 6. Applying Patterns to the Current Existing Scaffold

### 6.1 The User Requirement
When a user:
1. Modifies a scaffold target (e.g. changes `COMPOSITION.composer` to `*.composer`),
2. Adds a new constant (e.g. `DEFAULT_ENCODING = "UTF-8"` targeting `*.encoding`), or
3. Changes a variable definition,

they need to **apply the updated patterns to the current canvas scaffold without destroying existing work**.

### 6.2 Scaffolding Algorithm & Safety Rules

1. **Rule 1: Source Over Defaults (Strict Inviolability)**:
   - If a target slot is already connected to a `source_query` block (or any custom logic mapping source fields), **it must NEVER be overwritten**. Source mappings always take precedence.
2. **Rule 2: Update Unmapped & Default Slots**:
   - If a target slot is currently empty (holding a shadow block) OR is currently connected to an existing `constant_get` / `context_var_get` / `maps_get("defaults", ...)`:
     - Match the slot against all active scaffold targets from Constants and Context Variables.
     - Specificity scoring: exact class matches (`COMPOSITION.composer`) score higher than wildcards (`*.composer`).
     - Wire the winning definition's getter block (`constant_get` or `context_var_get`) into the slot.
3. **Rule 3: User Invocation & Feedback**:
   - An explicit action: **"Apply Variables & Constants to Scaffold"** available:
     - On the declaration block header (checkmark icon).
     - In the canvas context menu.
     - In the Target & Previews pane header.
   - When executed, intEHRgrator displays a clear toast notification:
     *"Scaffolding updated: 4 slots wired (2 language, 1 composer, 1 time). 3 source-mapped slots preserved."*

---

## 7. Migration & Backward Compatibility: Clean Cutover (No Runtime Dual-Read)

Since intEHRgrator has no external production users (only test users), we do not need to support legacy defaults maps at runtime or build complex in-memory dual-read migration layers:

1. **One-Time Example Sets & Fixture Conversion**:
   - All in-repo Example Sets (`examples/example-sets.json`), catalog definitions, test fixtures, and Agent hydration tests will be converted directly to the new **Constants** and **Context Variables** format as part of this change.
2. **Generic Map Functions Remain Untouched**:
   - Generic `Map` creation (`maps_create_with`), `maps_get`, and related blocks in the **Lists & maps** drawer remain fully supported for general 1D lookups and nested data. Any workspace utilizing generic maps for other purposes continues to work without disruption.
3. **Removal of the Defaults Block**:
   - The unique `default_context_map` canvas block (and legacy `defaults_block`) is retired and removed.
   - Consequently, the old defaults scaffolding engine (which looked for `default_context_map` and wired `maps_get("defaults", ...)`) is retired; scaffolding will exclusively be driven by the new **Constants** and **Context Variables** blocks.

---

## 8. Implementation Steps & GitHub Issues Plan

Tracked by main parent issue: **[#209](https://github.com/regionstockholm/intehrgrator/issues/209)**.

The redesign is split into three testable sub-issues:

### Step 1: Core Domain Model & Codegen Separation (Constants vs. Runtime Context) — [#210](https://github.com/regionstockholm/intehrgrator/issues/210)
- **Scope**:
  - Domain models for `MappingConstant` and `MappingContextVar`.
  - Update TypeScript codegen: emit top-level `const`, emit `context[...]` lookups, generate integration doc header.
  - Update Java codegen: emit `private static final`, emit `context.get(...)`.
  - Update Go template and XQuery codegen.
  - Update `test_runner`: supply test values to `runGeneratedTypeScript`.
- **Testing**:
  - Unit tests verifying generated code has `const` / `static final` without map lookups for constants.
  - Unit tests verifying `context` parameter execution in `test_runner`.

### Step 2: Block Redesign & Editable Text-Field Scaffold Targets — [#211](https://github.com/regionstockholm/intehrgrator/issues/211)
- **Scope**:
  - Replace chip widget in `FieldScaffoldTargets` with accessible, editable text field with wildcard syntax support.
  - Update definition blocks to distinguish Constants from Context Variables.
  - Support drag-and-drop from Target Schema tree into target text fields.
  - Support test value inputs for Context Variables.
- **Testing**:
  - Unit tests for target parsing, specificity scoring, and block serialization.
  - UI tests for typing and editing target paths.

### Step 3: Toolbox Pedagogical Organization ("Variables & Constants") & Re-apply Scaffolding — [#212](https://github.com/regionstockholm/intehrgrator/issues/212)
- **Scope**:
  - Add "Variables & Constants" category to `toolbox_demo.ts`.
  - Add `constant_get` and `context_var_get` getter blocks.
  - Add Toast feedback for applied scaffold updates.
  - Convert all in-repo Example Sets and fixtures; retire the legacy `default_context_map` block.
- **Testing**:
  - UI green-path test for applying constants and context variables to a loaded openEHR template.
  - Verification that existing `source_query` mappings are preserved when re-applying scaffold.
