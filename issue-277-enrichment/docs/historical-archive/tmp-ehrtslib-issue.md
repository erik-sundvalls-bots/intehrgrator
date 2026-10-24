## Bug: AD@git `.t.json` closure does not fetch `TEMPLATE_OVERLAY` parent archetypes

**Area:** `parser/template_json_dependencies.ts`, `parser/github_template_closure.ts`

**Symptom:** After `loadFromGitHubClinicalModelUrl` + `resolveOperational()` + `buildWebTemplate()`, node names fall back to at-codes (`at0002.1`, `at0005.1`) or the template id, instead of ontology texts (“Problem/Diagnosis”, “Systolic”, …). A pre-exported `.wt.json` for the same model is fine.

### Expected

A Better Archetype Designer `.t.json` plus AD@git closure should be equivalent (for names and structure) to a published Web Template, because:

1. The GitHub loader fetches every clinical-model file the template needs from the same repo/branch.
2. `flattenToOperationalTemplate` specialises overlays against those parents (`flattenArchetypeDefinition` uses `parent_archetype_id`).
3. `termTableForArchetype` / `mergeParentArchetypeTerms` merge parent ontology into the overlay’s term table.
4. `buildWebTemplate` then fills `name` / `localizedNames` from scoped terms.

### Actual

For **differential** templates, the closure often contains only:

- the root `.t.json`
- the **template** `parentArchetypeId` (e.g. `openEHR-EHR-COMPOSITION.encounter.v1`)

It does **not** fetch overlay parents such as `openEHR-EHR-EVALUATION.problem_diagnosis.v1`. Flattening then uses the overlay definition + empty overlay `termDefinitions`. Labels collapse to node ids.

Progress UI can still show “Resolving `openEHR-EHR-COMPOSITION.encounter.v1`” and look complete.

The demo-app and intEHRgrator both call `ClinicalModelWorkspace.loadFromGitHubTemplateUrl` → `collectTemplateJsonExternalRefs`. This is not an intEHRgrator-only gap. The demo looks fine because its featured Ehrlibs Accident Report `.t.json` stores **snapshot** overlays (`differential: false`) with full `termDefinitions`.

### Repro

**A — snapshot overlays (looks OK; current demo featured model)**

`https://github.com/Ehrlibs/openEHR-model-examples/blob/main/local/theme-packs/sport-event-details/templates/Accident%20report%20including%20vital%20signs.t.json`

Overlays have `differential: false` and full `termDefinitions` (tens of codes). File-only flatten already yields human names. Overlay parent ADLs are unused for labels.

**B — differential overlays (broken)**

`https://github.com/Ehrlibs/openEHR-model-examples/blob/main/local/theme-packs/simple-diagnose-and-vitals/simple-diagnose-and-vitals.t.json`

- 8× `TEMPLATE_OVERLAY`, all `differential: true`
- overlay `termDefinitions` empty (0 terms; BP overlay only has `ac0.1`)
- `C_ARCHETYPE_ROOT.archetypeRef` is the **overlay** id, e.g. `openEHR-EHR-EVALUATION.ovl-problem_diagnosis-001.v1`
- overlay `parentArchetypeId` is the real archetype, e.g. `openEHR-EHR-EVALUATION.problem_diagnosis.v1`

```ts
const refs = collectTemplateJsonExternalRefsFromText(tJsonText);
// today: typically only COMPOSITION.encounter.v1
// missing: problem_diagnosis.v1, adhoc.v1, blood_pressure.v2, pulse.v2, …
```

```ts
const ws = new ClinicalModelWorkspace();
await ws.loadFromGitHubClinicalModelUrl(SIMPLE_DIAGNOSE_BLOB_URL);
const { operationalTemplate } = ws.resolveOperational();
const wt = buildWebTemplate(operationalTemplate);
// EVALUATION name === "simple-diagnose-and-vitals" (template id)
// ELEMENT names === "at0002.1", "at0005.1", …
```

Mocking the GitHub tree with **only** the `.t.json` produces:

`Unresolved reference: openEHR-EHR-COMPOSITION.encounter.v1`

and **no** unresolved overlay-parent warnings — those ids are never considered.

### Root cause

`collectTemplateJsonExternalRefs` (`parser/template_json_dependencies.ts`) currently:

1. Collects overlay **ids** (`ovl-…`).
2. Adds the **root** `parentArchetypeId`.
3. Walks **only** `root.definition` for `C_ARCHETYPE_ROOT`.
4. **Skips** any `archetypeRef` that matches an overlay id.

It never reads `TEMPLATE_OVERLAY.parentArchetypeId`. Nested `C_ARCHETYPE_ROOT`s that live only inside overlay definitions (pulse, BP, … under the adhoc section overlay) are also missed by the walk.

That is the opposite of what flatten needs: `inlineArchetypeRoot` resolves the overlay id (correctly skip-fetching the overlay file — it is inlined), then `flattenArchetypeDefinition` looks up `overlay.parent_archetype_id` on the **repository**. Those ADL files were never downloaded.

ADL parent **chains** are already followed once a `.adl` is in the queue (`collectDependenciesFromContent` → `parseAdl` → `parent_archetype_id`). Overlay parents never enter the queue.

`test_data/tests/parser/github_template_closure.test.ts` only asserts the MDT fixture’s nested template + `COMPOSITION.review` parent — not overlay parents.

Related nits in the same function:

- `root.templateOverlays ?? root.templateOverlays` (duplicate; should also accept `template_overlays`)
- `applyAuthoredArchetypeFields` already maps `parentArchetypeId` onto `TEMPLATE_OVERLAY.parent_archetype_id` — flatten/term merge are ready once files exist

### Suggested fix

**1. Enqueue overlay parents in `collectTemplateJsonExternalRefs`:**

```ts
for (const raw of asArray(root.templateOverlays ?? root.template_overlays)) {
  if (!raw || typeof raw !== "object") continue;
  const ov = raw as Record<string, unknown>;
  if (jsonType(ov) !== "TEMPLATE_OVERLAY") continue;
  considerRef(archetypeIdValue(ov.parentArchetypeId ?? ov.parent_archetype_id));
  // optional: walk ov.definition for extra C_ARCHETYPE_ROOT refs
}
```

Keep skipping overlay **ids** for `C_ARCHETYPE_ROOT` (those objects are in the `.t.json`). Do **not** skip their `parentArchetypeId`.

**2. Walk overlay `definition` as well as `root.definition`**, so nested `C_ARCHETYPE_ROOT`s that are not themselves overlays (or that point at a different overlay’s parent) are collected.

**3. Tests** (no live GitHub required):

- Fixture or trimmed JSON: one differential overlay, `C_ARCHETYPE_ROOT` → overlay id, `parentArchetypeId` → `openEHR-EHR-EVALUATION.problem_diagnosis.v1`. Assert that id is in `collectTemplateJsonExternalRefs`.
- Closure mock: tree contains `.t.json` + parent `.adl`s; assert those paths are fetched.
- Flatten: overlay with empty `termDefinitions` + parent ADL in `ArchetypeRepository` → `buildWebTemplate` node `name` is the parent ontology text, not `at0002`.
- Regression: Accident report snapshot `.t.json` still flattens without requiring overlay parents for names.

**4. Docs / demo:** note that snapshot vs differential `.t.json` is why Accident Report AD@git looks complete and `simple-diagnose-and-vitals` does not. Optionally add the latter to the demo catalog as a closure test.

### Out of scope / already working

- `flattenArchetypeDefinition` parent specialisation
- `mergeParentArchetypeTerms`
- Recursing ADL `parent_archetype_id` after a file is fetched
- OPT XML / snapshot-overlay `.t.json` name resolution

Once overlay parents are in the fileset, existing flatten + term merge should make `.t.json` ≈ `.wt.json` for labels. If a follow-up still shows at-codes with parents present, that would be a second bug in overlay term-scope tagging (`term_archetype_scope` keyed by overlay id vs parent id).

### Context

Found while loading intEHRgrator example set **Simple-vitals**, whose target is the differential `simple-diagnose-and-vitals.t.json` above. intEHRgrator does detect GitHub `.t.json` and does **not** parse it as a Web Template (`parseWebTemplate` throws `Web template missing tree`).
