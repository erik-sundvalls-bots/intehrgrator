/**
 * Copy-paste AI assist: build external prompts and import suggestion envelopes.
 * Response format: docs/AI_SUGGESTION_FORMAT.md (version 2).
 */

import type {
  AiQuestionEntry,
  ImportSuggestionsReport,
  MappingLoop,
  MappingModel,
  MappingSlotReview,
  SchemaIssue,
  SkeletonNode,
  SuggestionBlock,
  SuggestionEnvelope,
  TargetFormatId,
} from "../../types/mod.ts";
import { applyExpressionEdit } from "../mapping_model/mod.ts";
import { validateExpressionSource } from "../expression/mod.ts";
import { Validator, type Schema } from "@cfworker/json-schema";
import { SUGGESTION_FORMAT_SCHEMA } from "./suggestion_schema.ts";
import { loopIndexBinderName, loopLengthBinderName } from "../loop_binders.ts";
import { jsonPointerToDotPath } from "./json_locate.ts";
import {
  type AiQuestion,
  type AiResponseNotes,
  balancedJsonEnd,
  normalizeAiQuestion,
  NOTES_CONVENTION,
  parseAiConfidence,
  parseAiResponseNotes,
} from "./response_notes.ts";
export { parseAiConfidence };
import type { SheetDocument } from "../sheets/mod.ts";
import { buildSlotTree, formatSlotTree, resolveSlotRef, SLOT_TREE_GUIDE } from "./slot_tree.ts";
import { formatModelsBlock, type ModelDescription } from "./models_block.ts";
import type { SlotInfoIndex } from "./slot_info.ts";

export type AiArtifactDelivery = "attach" | "inline" | "uri";
/**
 * Prompt flavour: the three copy & paste deliveries, or `api` for in-app AI
 * chat (Send), where the model has the mapping tools and needs no file bodies.
 */
export type AiPromptDelivery = AiArtifactDelivery | "api";

/** One example in the `api` context's example manifest (bodies via `get_example`). */
export interface AiExampleManifestRow {
  id: string;
  filename: string;
  format: string;
  chars: number;
  active?: boolean;
}

export type AiArtifactRole = "target" | "source-schema" | "example" | "target-fileset";

export interface AiPromptArtifact {
  role: AiArtifactRole;
  filename: string;
  format: string;
  content: string;
  /** Present when loaded from a URL (or GitHub clinical-model root). */
  originUrl?: string;
}

export interface BuildPromptOptions {
  scope: "full" | "slot";
  slotId?: string;
  targetId: string;
  targetFormat: TargetFormatId | string;
  targetFilename: string;
  skeleton: SkeletonNode[];
  model: MappingModel;
  formatDocUrl: string;
  delivery: AiPromptDelivery;
  artifacts: AiPromptArtifact[];
  /** `api` only: indented source path outline (`sourceTreeOutline`), instead of file bodies. */
  sourceOutline?: string;
  /** `api` only: language of the outline's descriptions (`source.lang.1` when the schema has it, #277 §5). */
  sourceDescriptionLanguage?: string;
  /** `api` only: examples the model can read with `get_example`. */
  exampleManifest?: AiExampleManifestRow[];
  sourceFormat?: string;
  activeExampleFilename?: string;
  /** Named Sheets and Decision tables already on the project (headers + sample rows). */
  sheets?: SheetDocument[];
  /** Conversion start Product stack (Instance roots, encodings, product-grain loops). */
  productStack?: Array<{ type: string; encoding?: string; varName?: string; path?: string }>;
  /** Optional RM Insertion catalog (parentSlotId + attachments for `optional_rm_add`). */
  optionalRm?: Array<{
    parentSlotId: string;
    attachments: Array<{ rmType: string; attributeName: string; label?: string }>;
  }>;
  /** Constraint warnings (unmapped mandatory, Decision table lint, abstract RM types). */
  constraintWarnings?: Array<{
    slotId?: string;
    blockId?: string;
    sheetName?: string;
    message: string;
  }>;
  /** `## Models` (#277 §7): target and source models, named once. */
  models?: ModelDescription[];
  /** Copy & paste: attach the raw target file too (off by default, #277 §6). */
  attachOriginalTarget?: boolean;
  /** Descriptions, ranges, value texts per slot (#277 enrichment). */
  slotInfo?: SlotInfoIndex;
  /** Labels in the AI context languages after `target.lang.1` (#279). */
  extraLabels?: Array<[string, Map<string, string>]>;
  /** `source.lang.N` / `target.lang.N` priority lists (#277 §4). */
  languages?: { source: string[]; target: string[] };
}

const VALUE_BLOCK_TYPES = new Set([
  "source_query",
  "source_query_number",
  "source_query_boolean",
  "source_query_node",
  "variables_get",
  "text",
  "text_code",
  "text_handlebars",
  "maps_create_with",
  "maps_create_empty",
  "maps_get",
  "sheet_lookup",
  "decision_table",
  "sheet_get_cell",
  "sheet_get_xy",
  "sheet_get_row",
  "sheet_get_column",
  "sheet_get_header",
  "sheet_get_data",
  "math_number",
  "logic_boolean",
  "text_trim",
  "text_join",
  "math_arithmetic",
  "logic_ternary",
  "logic_compare",
  "logic_operation",
  "logic_negate",
  "logic_list_restriction",
  "logic_current_item",
  "logic_loop_index",
  "logic_loop_length",
  "lists_set_operation",
]);

const MULTIPART_BOUNDARY = "intehrgrator-part";

function isAbsoluteSourcePath(expr: string): boolean {
  return expr.startsWith("$") || expr.startsWith("/");
}

/** Join loop PATH + relative child steps for import into Mapping Model expressions. */
export function joinLoopPath(loopPath: string, relative: string): string {
  const rel = relative.replace(/^\.\//, "").replace(/^\./, "");
  if (!rel) return loopPath;
  if (isAbsoluteSourcePath(rel)) return rel;
  if (loopPath.startsWith("$")) {
    if (rel.startsWith("[")) return `${loopPath}${rel}`;
    const base = loopPath.replace(/\[\*\]$/, "");
    return `${base}[*].${rel.replace(/^\//, "")}`;
  }
  if (loopPath.startsWith("/")) {
    return `${loopPath.replace(/\/$/, "")}/${rel.replace(/^\//, "")}`;
  }
  return `${loopPath}/${rel}`;
}

/**
 * Stable prompt prefix (#277 §6): task rules, response format, references,
 * slot tree format, block examples. It holds nothing project-specific (no
 * names, ids, counts, revisions or languages), so providers can cache it.
 * Copy & paste prompts start with it; AI chat sends the `api` prefix in the
 * system message and the project context in the first user message.
 */
export function stablePromptPrefix(mode: "api" | "copy", formatDocUrl: string): string {
  const sections: string[] = [
    "# intEHRgrator mapping assist",
    "",
    "Map source data to the loaded target (openEHR Composition, JSON or XML document, or free-form text). The project context (target, models, slot tree, source) follows after this guide.",
    "",
  ];
  if (mode === "api") {
    sections.push(
      "## Response format",
      `Apply mappings with the function tools. \`import_suggestions\` takes an \`intehrgrator-suggestions\` version \`"2"\` envelope with Blockly \`block\` fragments per ${formatDocUrl} (fetch only if needed; same version ⇒ same content).`,
      NOTES_CONVENTION,
      "",
    );
  } else {
    sections.push(
      "## Response format",
      `Respond with exactly one fenced JSON block tagged \`intehrgrator-suggestions\` per: ${formatDocUrl}`,
      "Use version `\"2\"` with Blockly `block` fragments (not JS-shaped xpath wrappers).",
      `The JSON must validate against: ${schemaUrlFromFormatDoc(formatDocUrl)}`,
      "Fetch these only if needed; same version ⇒ same content.",
      NOTES_CONVENTION,
      "",
    );
  }
  sections.push(...referenceSections());
  sections.push("## Slot tree format", SLOT_TREE_GUIDE, "");
  sections.push(
    "",
    "## Block examples",
    "Value slots only — no RM containers or DV shells in suggestions. Prefer **Decision tables** (`decision_table`) when combinational rules (several inputs, don't-care, FIRST/UNIQUE/COLLECT) are easier for humans to read than nested `if`. Prefer **Sheets** (`sheet_lookup`) for 1-key terminology tables. Keep `maps_get` for **default context map** runtime keys. Unconstrained `DV_QUANTITY` units: `maps_create_with` keys `magnitude` + `units` on the quantity slot (not a sibling slot).",
    "",
    "**Terminology translation (ICD-10 → SNOMED CT)** — `sheet_lookup` against a named Sheet (headers `code` / `snomed`), key from source:",
    "```json",
    JSON.stringify({
      slotId: "<group><id of the code slot>",
      block: {
        type: "sheet_lookup",
        fields: { NAME: "icd10_snomed" },
        inputs: {
          MATCH_COL: { block: { type: "text", fields: { TEXT: "code" } } },
          MATCH_VAL: {
            block: {
              type: "source_query",
              fields: { EXPRESSION: "$.diagnosis.icd10" },
            },
          },
          RETURN_COL: { block: { type: "text", fields: { TEXT: "snomed" } } },
        },
      },
      note: "Sheet icd10_snomed: I10→38341003, E11→44054006, …",
    }, null, 2),
    "```",
    "",
    "**Decision table (combinational rules)** — load/replace the grid with `replace_sheets` (`kind: \"decision-table\"`); fill the slot with `decision_table`. Prefer this over nested `logic_ternary` when several independent inputs (with don't-care) map to outputs:",
    "```json",
    JSON.stringify({
      slotId: "<group><id>",
      block: {
        type: "decision_table",
        fields: { NAME: "sbp_band", OUTPUT: "band" },
        inputs: {
          INPUTS: {
            block: {
              type: "maps_create_with",
              extraState: { itemCount: 1 },
              fields: { KEY0: "sbp" },
              inputs: {
                VAL0: {
                  block: {
                    type: "source_query_number",
                    fields: { EXPRESSION: "$.systolic" },
                  },
                },
              },
            },
          },
        },
      },
      note: "Decision table sbp_band: condition sbp, output band (e.g. >=140 → high)",
    }, null, 2),
    "```",
    "",
    "**DV_QUANTITY magnitude + units** — when the slot has no `fixed.units`:",
    "```json",
    JSON.stringify({
      slotId: "<group><id of the quantity slot>",
      loopVar: "item",
      block: {
        type: "maps_create_with",
        extraState: { itemCount: 2 },
        fields: { KEY0: "magnitude", KEY1: "units" },
        inputs: {
          VAL0: {
            block: { type: "source_query_number", fields: { EXPRESSION: "Dose" } },
          },
          VAL1: {
            block: { type: "source_query", fields: { EXPRESSION: "UnitCode" } },
          },
        },
      },
    }, null, 2),
    "```",
    "",
    "**Defaults vs source** — scaffold often pre-wires `maps_get(\"defaults\", …)` for language/territory/facility/time/composer. **Source wins:** when the source has data for such a slot, map with `source_query` (e.g. context start time, healthcare facility, composer name). Omit defaults-only slots only when the source has no value.",
    "",
    "**Source over defaults (time / composer)** — map from source when present:",
    "```json",
    JSON.stringify({
      slotId: "/context/start_time/value",
      block: {
        type: "source_query",
        fields: { EXPRESSION: "$.encounter.startTime" },
      },
    }, null, 2),
    "```",
    "",
    "**Party identity `name` slot** (PARTY_IDENTIFIED container from `list_slots`; source over defaults). Optional identifiers: `maps_create_with` keys `name`, `id`, `type`:",
    "```json",
    JSON.stringify({
      slotId: "/composer",
      block: {
        type: "maps_create_with",
        extraState: { itemCount: 3 },
        fields: { KEY0: "name", KEY1: "id", KEY2: "type" },
        inputs: {
          VAL0: {
            block: { type: "source_query", fields: { EXPRESSION: "$.author.displayName" } },
          },
          VAL1: {
            block: { type: "source_query", fields: { EXPRESSION: "$.author.id" } },
          },
          VAL2: {
            block: { type: "text", fields: { TEXT: "urn:oid:1.2.752.29.4.19" } },
          },
        },
      },
    }, null, 2),
    "```",
    "",
    "**Repeating container** — put `for_each_list` in top-level `loops[]` (`source_query_node` in LIST for source nodes, or a list value for a computed collection); child slots use `loopVar` + relative `EXPRESSION` (groups with `loop` in the slot tree). Loop body reporters `logic_loop_index` / `logic_loop_length` serialize as `var(\"<item>_index\")` / `var(\"<item>_length\")` (0-based; length fixed at loop entry). Grammatical list join (Swedish *och* / Oxford comma) is a 1-arg Blockly Function that loops, appends a FIRST Decision-table snippet, and is called from the slot — not a `join_list` builtin. Optional RM Insertion uses `optional_rm_add` / `optional_rm_remove` tools, not this envelope.",
    'Loop fragment (merge into the envelope; ids from the slot tree): `{"loops":[{"attachSlotId":"<loop group>","block":{"type":"for_each_list","fields":{"VAR":"item"},"inputs":{"LIST":{"block":{"type":"source_query_node","fields":{"EXPRESSION":"$.Items"}}}}}}],"suggestions":[{"slotId":"<group><id of a slot in that group>","loopVar":"item","block":{"type":"source_query","fields":{"EXPRESSION":"Name"}}}]}`.',
    "",
    "## Rules",
    "Build each `slotId` from the slot tree (`group` + `id`). Prefer `source_query*` blocks with fontoxpath in `EXPRESSION`. Use a **Decision table** (`decision_table` + `kind: \"decision-table\"` sheet) when several independent inputs, don't-care cells, or FIRST/UNIQUE/COLLECT hit policies make the mapping more readable to humans than nested `if`. Use `sheet_lookup` for 1-key terminology and code translation (named Sheet). Use `maps_get` for **default context map** **runtime keys** (not scaffold-target path strings). Scaffold often wires Default points — omit those only when the source has no value; when source data exists for time, healthcare facility, composer, or similar, map from source (source takes precedence over defaults). For repeating `multiplicity` (`0..*` / `1..*`), emit `loops` with `for_each_list` (`source_query_node` in LIST, or a list-valued collection) and child suggestions with matching `loopVar` + relative `EXPRESSION` (do not join onto PATH). Do not map source quantities onto ordinal/score fields unless the source is already that score. Leave unmatched slots out rather than inventing a mapping.",
    "",
  );
  return sections.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
}

/** Last line of the stable prefix; the project context starts after it. */
export const PROJECT_CONTEXT_START = "# Project";

export function buildPrompt(options: BuildPromptOptions): string {
  const mapped = new Set(options.model.slots.filter((s) => s.expression).map((s) => s.slotId));
  const slotTree = buildSlotTree(options.skeleton, {
    include: (s) => options.scope === "slot" ? s.slotId === options.slotId : !mapped.has(s.slotId),
    info: options.slotInfo,
    extraLabels: options.extraLabels,
  });

  const api = options.delivery === "api";
  const targetLabel = formatTargetTask(options.targetFormat);
  const sections: string[] = [];
  if (!api) sections.push(stablePromptPrefix("copy", options.formatDocUrl), "");
  sections.push(
    PROJECT_CONTEXT_START,
    "",
    "## Task",
    `Map source data to ${targetLabel} conforming to the loaded target definition.`,
    "",
    "## Target",
    `- format: \`${options.targetFormat}\``,
    `- targetId: \`${options.targetId}\``,
    `- filename: \`${options.targetFilename || "(none)"}\``,
  );
  if (!api && !options.attachOriginalTarget) {
    sections.push("- The original target file is not attached: the slot tree below has what mapping needs. (The user can turn on **Attach original target** in the AI menu.)");
  }
  sections.push(
    "",
    "## Source",
    options.sourceFormat
      ? `- schema format: \`${options.sourceFormat}\``
      : "- (no source schema loaded)",
    options.activeExampleFilename
      ? `- active example: \`${options.activeExampleFilename}\``
      : "- (no active example)",
  );
  const langs = options.languages;
  if (langs && (langs.source.length || langs.target.length > 1)) {
    if (langs.source.length) sections.push(`- source languages: ${langs.source.join(", ")}`);
    if (langs.target.length > 1) {
      sections.push(`- target languages: ${langs.target.join(", ")} (slot tree labels in \`${langs.target[0]}\`)`);
    }
  }
  sections.push(
    "",
    `## Scope: \`${options.scope}\``,
  );
  if (options.slotId) sections.push(`- slotId: \`${options.slotId}\``);
  sections.push("");

  if (options.models?.length) {
    sections.push("## Models", formatModelsBlock(options.models), "");
  }

  sections.push(
    "## Slot tree",
    "```json",
    formatSlotTree(slotTree),
    "```",
    "",
  );

  const sheetSection = compactSheetSection(options.sheets);
  if (sheetSection) sections.push(...sheetSection);

  if (options.productStack?.length) {
    sections.push(
      "## Product stack",
      "Conversion start chain (Instance roots, Instance encoding, product-grain loops). Change encoding with the `set_instance_encoding` Agent API/MCP tool — not this envelope.",
      "```json",
      compactJsonRows(options.productStack),
      "```",
      "",
    );
  }

  if (options.optionalRm?.length && api) {
    const attachments = options.optionalRm.reduce((n, row) => n + row.attachments.length, 0);
    sections.push(
      "## Optional RM Insertion",
      `${attachments} RM-optional attributes on ${options.optionalRm.length} parent slots are not in the envelope. Call \`list_optional_rm\` (optionally with \`parentSlotId\`) for the catalog, then \`optional_rm_add\`.`,
      "",
    );
  } else if (options.optionalRm?.length) {
    sections.push(
      "## Optional RM Insertion",
      "These RM-optional attributes are not in the envelope. Call `optional_rm_add` with `parentSlotId`, `rmType`, and `attributeName` copied from this list (then map any new value slots).",
      "```json",
      compactJsonRows(options.optionalRm),
      "```",
      "",
    );
  }

  if (options.constraintWarnings?.length && api) {
    sections.push(
      "## Constraint warnings",
      `${options.constraintWarnings.length} open (unmapped mandatory slots, Decision table lint, abstract EVENT / ITEM_STRUCTURE). Call \`list_constraint_warnings\` for the list and re-check after mapping.`,
      "",
    );
  } else if (options.constraintWarnings?.length) {
    const sample = options.constraintWarnings.slice(0, 24);
    sections.push(
      "## Constraint warnings",
      "Unmapped mandatory slots, Decision table lint, and abstract EVENT / ITEM_STRUCTURE. Patch with `import_suggestions` / `replace_sheets` / `optional_rm_add`, then re-check `list_constraint_warnings`.",
      "```json",
      compactJsonRows(sample),
      "```",
      "",
    );
  }

  const artifacts = options.attachOriginalTarget ? options.artifacts : options.artifacts.filter((a) => a.role !== "target");
  sections.push(
    ...(api
      ? apiSourceSections(options.sourceOutline, options.exampleManifest, options.sourceDescriptionLanguage)
      : deliverySections(options.delivery as AiArtifactDelivery, artifacts)),
  );
  sections.push(
    "",
    "## Instruction",
    api
      ? "Map with the tools (`map_slot`, `import_suggestions`, `optional_rm_add`, `replace_sheets`), then `run_test`, following the rules in the system message."
      : "Return exactly one `intehrgrator-suggestions` fenced JSON block, following the rules above.",
  );

  if (options.delivery === "inline") {
    const parts = artifacts.filter((a) => a.content.length > 0);
    if (parts.length) {
      sections.push("", formatMultipart(parts));
    }
  }

  return sections.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
}

/** JSON array with one compact row per line: readable, without pretty-print indentation tokens. */
export function compactJsonRows(rows: unknown[]): string {
  if (!rows.length) return "[]";
  return `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]`;
}

/** `api` context: source path outline and example manifest instead of file bodies (#252). */
function apiSourceSections(
  outline: string | undefined,
  examples: AiExampleManifestRow[] | undefined,
  descriptionLanguage?: string,
): string[] {
  const out: string[] = [];
  if (outline?.trim()) {
    const langNote = descriptionLanguage
      ? ` Descriptions in \`${descriptionLanguage}\`; \`(en)\` before one marks another language.`
      : "";
    out.push(
      "## Source tree",
      `One node per line: \`path type [multiplicity] — description\` (first sentence), indented by depth.${langNote} Use these paths in \`map_slot\` / \`source_query\` (\`get_source_tree\` returns full descriptions and example values).`,
      "```text",
      outline,
      "```",
      "",
    );
  } else {
    out.push("## Source tree", "No source schema or example is loaded yet.", "");
  }
  if (examples?.length) {
    out.push(
      "## Examples",
      "Bodies are not included. Read values with `get_example` (`id`, optional `path`); `set_active_example` switches the Test example.",
      "```json",
      compactJsonRows(examples),
      "```",
    );
  }
  return out;
}

function compactSheetSection(sheets: SheetDocument[] | undefined): string[] | null {
  if (!sheets?.length) return null;
  const compact = sheets.map((sheet) => ({
    name: sheet.name,
    kind: sheet.kind === "decision-table" ? "decision-table" : "sheet",
    headers: [...sheet.headers],
    ...(sheet.hitPolicy ? { hitPolicy: sheet.hitPolicy } : {}),
    previewRows: sheet.values.slice(0, 8),
  }));
  return [
    "## Sheets and Decision tables",
    "These grids are already on the project. Terminology / 1-key lookup → `sheet_lookup` on a **Sheet**. Combinational rules that humans should read as a table → **Decision table** (`decision_table` block; inputs Map keys match condition columns). Create or replace grids with the `replace_sheets` Agent API/MCP tool, not this envelope.",
    "```json",
    compactJsonRows(compact),
    "```",
    "",
  ];
}

function formatTargetTask(format: string): string {
  switch (format) {
    case "openehr-template":
      return "an openEHR Composition";
    case "json-schema":
      return "a JSON document";
    case "xml-schema":
      return "an XML document";
    case "free-form":
      return "a free-form text / Handlebars output";
    default:
      return `instances of target format \`${format}\``;
  }
}

/** Generic references, the same for every project (part of the stable prefix). */
function referenceSections(): string[] {
  return [
    "## References",
    "Use authoritative sources — do not invent RM paths, archetype ids, or terminology codes.",
    "",
    "- **openehr-assistant MCP** (recommended for openEHR targets): archetype/template lookup, terminology resolution, spec digests, and ADL/AQL guidance. Install the [openEHR Assistant Plugin](https://github.com/cadasto/openehr-assistant-plugin) in your AI environment when possible.",
    "- **ehrtslib (DeepWiki)**: https://deepwiki.com/ErikSundvall/ehrtslib",
    "- **ehrtslib (GitHub)**: https://github.com/ErikSundvall/ehrtslib",
    "- **openEHR specifications**: https://specifications.openehr.org/ (AI index: https://specifications.openehr.org/llms.txt; RM: https://specifications.openehr.org/releases/RM/latest/)",
    "- **openEHR CKM** (archetypes by id): https://ckm.openehr.org/ckm/",
    "- **XML Schema**: https://www.w3.org/TR/xmlschema11-1/ · **JSON Schema**: https://json-schema.org/specification",
    "",
  ];
}

function deliverySections(
  delivery: AiArtifactDelivery,
  artifacts: AiPromptArtifact[],
): string[] {
  if (!artifacts.length) {
    return ["## Artifacts", "No source/target files are loaded yet."];
  }

  if (delivery === "inline") {
    return [
      "## Artifact delivery: inline multipart",
      "File bodies are appended below as multipart parts (`--intehrgrator-part`). Do not ask the user to upload files.",
      ...artifactSummaryLines(artifacts),
    ];
  }

  if (delivery === "uri") {
    const browsable = artifacts.filter((a) => a.originUrl);
    const local = artifacts.filter((a) => !a.originUrl);
    const out: string[] = [
      "## Artifact delivery: browse URIs",
      "Fetch each URL below and use the response body as that artifact. Do not ask the user to upload these files.",
      "",
      "## Browse URIs",
    ];
    if (browsable.length) {
      for (const a of browsable) {
        out.push(`- ${roleLabel(a)}: ${a.originUrl}`);
      }
    } else {
      out.push("- (none — no URI-loaded artifacts)");
    }
    if (local.length) {
      out.push("", "## Attachments (no URI — upload these)");
      for (const a of local) {
        out.push(`- ${roleLabel(a)}: \`${a.filename}\``);
      }
    }
    return out;
  }

  // attach
  const out: string[] = [
    "## Artifact delivery: attach in chat",
    "Attach these files to the chat before answering. URIs below are for context only — do not assume you can fetch them.",
    "",
    "## Attachments",
  ];
  for (const a of artifacts) {
    const origin = a.originUrl ? `\n  (loaded from \`${a.originUrl}\`)` : "";
    out.push(`- ${roleLabel(a)}: \`${a.filename}\`${origin}`);
  }
  return out;
}

function artifactSummaryLines(artifacts: AiPromptArtifact[]): string[] {
  return [
    "",
    "### Parts included",
    ...artifacts.map((a) => {
      const origin = a.originUrl ? ` · origin ${a.originUrl}` : "";
      return `- ${roleLabel(a)}: \`${a.filename}\`${origin}`;
    }),
  ];
}

function roleLabel(a: AiPromptArtifact): string {
  return `${a.role} (\`${a.format}\`)`;
}

export function formatMultipart(artifacts: AiPromptArtifact[]): string {
  const chunks: string[] = [];
  for (const a of artifacts) {
    chunks.push(`--${MULTIPART_BOUNDARY}`);
    chunks.push(`Content-Type: ${mimeForFilename(a.filename)}; charset=utf-8`);
    chunks.push(`Content-Disposition: attachment; filename="${escapeFilename(a.filename)}"`);
    chunks.push(`X-Intehrgrator-Role: ${a.role}`);
    if (a.originUrl) chunks.push(`X-Intehrgrator-Origin: ${a.originUrl}`);
    chunks.push("");
    chunks.push(a.content);
  }
  chunks.push(`--${MULTIPART_BOUNDARY}--`);
  return chunks.join("\n");
}

export function mimeForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".wt.json") || lower.endsWith(".t.json")) {
    return "application/json";
  }
  if (
    lower.endsWith(".xml") || lower.endsWith(".opt") || lower.endsWith(".opt2") ||
    lower.endsWith(".xsd")
  ) {
    return "application/xml";
  }
  if (lower.endsWith(".adl") || lower.endsWith(".adls")) return "text/plain";
  if (lower.endsWith(".hbs") || lower.endsWith(".handlebars")) return "text/x-handlebars";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".csv")) return "text/csv";
  return "text/plain";
}

function escapeFilename(name: string): string {
  return name.replace(/["\r\n]/g, "_");
}

export interface ParseSuggestionsOptions {
  /** Used when the AI omitted `target` (common in chat replies). */
  fallbackTarget?: { format: string; targetId: string };
}

const BLOCK_TYPE_ALIASES: Record<string, string> = {
  source_query_string: "source_query",
  source_query_text: "source_query",
};

/** Blockly serialization noise AIs often include; strip rather than reject. */
const IGNORED_BLOCK_KEYS = new Set([
  "id",
  "x",
  "y",
  "mutation",
  "icons",
  "enabled",
  "inline",
  "collapsed",
  "deletable",
  "movable",
  "editable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when clipboard/paste looks like a suggestion envelope, not a Copy AI Prompt. */
export function looksLikeSuggestionsPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("# intEHRgrator")) return false;
  try {
    const parsed = extractSuggestionsJson(trimmed);
    return isRecord(parsed) && Array.isArray(parsed.suggestions);
  } catch {
    return false;
  }
}

export function extractSuggestionsJson(text: string): unknown {
  const trimmed = text.trim();
  const tagged = trimmed.match(/```intehrgrator-suggestions\s*([\s\S]*?)```/);
  if (tagged?.[1]) return JSON.parse(tagged[1].trim());

  const jsonFence = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (jsonFence?.[1]) {
    const inner = JSON.parse(jsonFence[1].trim());
    if (isRecord(inner) && Array.isArray(inner.suggestions)) return inner;
  }

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      // Raw JSON followed by `### Notes` / `### Questions` prose.
      const end = balancedJsonEnd(trimmed, 0);
      if (end > 0 && trimmed.slice(end).trim()) return JSON.parse(trimmed.slice(0, end));
      throw err;
    }
  }

  throw new Error("No suggestion JSON found (expected an object or intehrgrator-suggestions fence)");
}

/**
 * Notes / Questions prose and per-suggestion `note` fields of an AI answer
 * (pasted, approve-first, or the final apply-directly text).
 */
export function parseAiAnswerNotes(text: string): AiResponseNotes {
  let envelope: unknown;
  try {
    envelope = extractSuggestionsJson(text);
  } catch {
    envelope = undefined;
  }
  return parseAiResponseNotes(text, envelope);
}

const SCHEMA_WRAPPERS = new Set([
  "A subschema had errors.",
  "Items did not match schema.",
]);

const EXTRA_BLOCK_KEYS = new Set(["mutation", "id", "x", "y", "icons", "enabled", "inline", "collapsed"]);

function pointerLeaf(pointer: string): string {
  const parts = pointer.replace(/^#/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function keepSchemaError(keyword: string | undefined, pointer: string, raw: string): boolean {
  if (!keyword) return false;
  if (SCHEMA_WRAPPERS.has(raw)) return false;
  if (/^Property "[^"]+" does not match schema\.$/.test(raw)) return false;
  if (keyword === "required" || keyword === "enum" || keyword === "const") return true;
  const extra = /Property "([^"]+)" does not match additional properties schema/.exec(raw)?.[1]
    ?? (keyword === "false" ? pointerLeaf(pointer) : undefined);
  if (extra && EXTRA_BLOCK_KEYS.has(extra)) return true;
  if (/^#\/suggestions\/\d+\/(attachSlotId|for_each_source|suggestions)$/.test(pointer)) return true;
  return false;
}

/** Validate extracted JSON against docs/AI_SUGGESTION_FORMAT.schema.json. */
export function validateSuggestionEnvelope(instance: unknown): SchemaIssue[] {
  const validator = new Validator(SUGGESTION_FORMAT_SCHEMA as Schema, "2020-12", false);
  const result = validator.validate(instance);
  const extra = confidenceIssues(instance);
  if (result.valid) return extra;

  const issues: SchemaIssue[] = [];
  const seen = new Set<string>();
  for (const error of result.errors) {
    if (!keepSchemaError(error.keyword, error.instanceLocation, error.error)) continue;
    const path = jsonPointerToDotPath(error.instanceLocation);
    const message = explainSuggestionSchemaIssue(path, error.error, error.keyword, error.instanceLocation);
    const key = `${path}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ path, message, keyword: error.keyword });
  }
  return [...collapseSchemaIssues(issues), ...extra];
}

function collapseSchemaIssues(issues: SchemaIssue[]): SchemaIssue[] {
  const nestedParents = new Set<string>();
  const out: SchemaIssue[] = [];
  const hasMutationLeaf = issues.some((issue) => issue.path.endsWith(".mutation"));
  for (const issue of issues) {
    const nested = /^(.*suggestions\[\d+\])\.(attachSlotId|for_each_source|suggestions)$/.exec(issue.path);
    if (nested) {
      const parent = nested[1]!;
      if (nestedParents.has(parent)) continue;
      nestedParents.add(parent);
      out.push({
        path: parent,
        keyword: issue.keyword,
        message:
          `${parent}: nested loops are not allowed here. Put repeating work in top-level loops[] with for_each_list { VAR, LIST: source_query_node or list }, and child fills in suggestions[] with matching loopVar.`,
      });
      continue;
    }
    if (hasMutationLeaf && issue.path.endsWith(".block") && issue.message.includes("mutation")) {
      continue;
    }
    out.push(issue);
  }
  return out;
}

export function explainSuggestionSchemaIssue(
  path: string,
  raw: string,
  keyword?: string,
  pointer = "",
): string {
  const extra = /Property "([^"]+)" does not match additional properties schema/.exec(raw)?.[1]
    ?? pointerLeaf(pointer);

  if (EXTRA_BLOCK_KEYS.has(extra)) {
    return `${path}: unexpected "${extra}". Blocks allow only type, fields, inputs, extraState.`;
  }
  if (/^#\/suggestions\/\d+\/(attachSlotId|for_each_source|suggestions)$/.test(pointer)) {
    return `${path}: nested loops are not allowed here. Put repeating work in top-level loops[] with for_each_list { VAR, LIST: source_query_node or list }, and child fills in suggestions[] with matching loopVar.`;
  }
  if (keyword === "enum" || /does not match any of/i.test(raw)) {
    if (/\.type$/.test(path)) {
      return `${path}: invalid block type. Use source_query, source_query_number, source_query_boolean, source_query_node, text, text_code, text_handlebars, maps_get, sheet_lookup, decision_table, or maps_create_* (not source_query_string). Loops use for_each_list only in loops[].`;
    }
  }
  if (keyword === "const") {
    if (path === "$.format") return `${path}: format must be the string "intehrgrator-suggestions".`;
    if (path === "$.version") return `${path}: version must be the string "2" (not the number 2).`;
  }
  if (keyword === "required" || /required property/i.test(raw)) {
    const cleaned = raw.replace(/^Instance does not have required property/, "Missing required property");
    if (path === "$") {
      return `${path}: ${cleaned} Envelope requires format, version, target, and suggestions.`;
    }
    return `${path}: ${cleaned}`;
  }
  return `${path}: ${raw}`;
}

export interface FollowUpOptions {
  formatDocUrl: string;
  schemaUrl: string;
  payload: string;
  schemaIssues: SchemaIssue[];
  errors: string[];
}

/** Markdown the user can paste back into the AI chat to request a corrected envelope. */
export function formatImportFollowUp(options: FollowUpOptions): string {
  const lines: string[] = [
    "The previous `intehrgrator-suggestions` JSON did not validate. Please return exactly one corrected fenced block tagged `intehrgrator-suggestions` (version `\"2\"`).",
    "",
    `Format: ${options.formatDocUrl}`,
    `JSON Schema: ${options.schemaUrl}`,
    "",
    "### Errors",
  ];
  const issues = [
    ...options.schemaIssues.map((issue) => `- \`${issue.path}\`: ${issue.message}`),
    ...options.errors.map((err) => `- ${err}`),
  ];
  if (!issues.length) issues.push("- (no structured errors)");
  lines.push(...issues);
  lines.push(
    "",
    "Fix every error. Copy each `slotId` / `attachSlotId` from the original prompt. Put repeating source nodes in top-level `loops[]` (`for_each_list` with `source_query_node` in LIST, or a list-valued collection); child mappings use `loopVar` and a **relative** `EXPRESSION`. Prefer Decision tables when combinational rules are clearer than nested if. Do not emit `mutation`, `id`, `x`, `y`, or `source_query_string` (use `source_query` for strings).",
    "",
    "### Previous payload",
    "```json",
    options.payload.trim(),
    "```",
  );
  return lines.join("\n");
}

export function schemaUrlFromFormatDoc(formatDocUrl: string): string {
  return formatDocUrl.replace(/AI_SUGGESTION_FORMAT\.md/i, "AI_SUGGESTION_FORMAT.schema.json");
}

export function parseSuggestionsPayload(
  text: string,
  options: ParseSuggestionsOptions = {},
): SuggestionEnvelope {
  const parsed = extractSuggestionsJson(text);
  return normalizeSuggestionEnvelope(parsed, options.fallbackTarget);
}

function normalizeSuggestionEnvelope(
  raw: unknown,
  fallbackTarget?: { format: string; targetId: string },
): SuggestionEnvelope {
  if (!isRecord(raw)) throw new Error("Suggestions payload must be a JSON object");
  if (raw.format != null && raw.format !== "intehrgrator-suggestions") {
    throw new Error("Invalid format field");
  }
  const version = String(raw.version ?? "");
  if (version !== "2") {
    throw new Error(`Unsupported version: ${raw.version} (expected "2")`);
  }
  if (!Array.isArray(raw.suggestions)) {
    throw new Error("Missing suggestions array");
  }

  const targetRaw = isRecord(raw.target) ? raw.target : {};
  const targetId = String(targetRaw.targetId ?? fallbackTarget?.targetId ?? "");
  const targetFormat = String(targetRaw.format ?? fallbackTarget?.format ?? "");
  if (!targetId || !targetFormat) {
    throw new Error("Missing target.targetId or target.format");
  }

  const { loops, suggestions } = flattenSuggestionGroups(raw);
  const notes = stringList(raw.notes);
  const questions = questionList(raw.questions);
  return {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: targetFormat, targetId },
    ...(loops.length ? { loops } : {}),
    suggestions,
    ...(notes.length ? { notes } : {}),
    ...(questions.length ? { questions } : {}),
  };
}

type RawLoop = NonNullable<SuggestionEnvelope["loops"]>[number];
type RawSuggestion = SuggestionEnvelope["suggestions"][number];

/**
 * AIs often nest `for_each_source` groups inside `suggestions[]` instead of
 * emitting top-level `loops[]`. Flatten that into the documented shape.
 */
function flattenSuggestionGroups(raw: Record<string, unknown>): {
  loops: RawLoop[];
  suggestions: RawSuggestion[];
} {
  const loops: RawLoop[] = [];
  const suggestions: RawSuggestion[] = [];

  if (Array.isArray(raw.loops)) {
    for (const item of raw.loops) {
      if (!isRecord(item)) continue;
      const attachSlotId = String(item.attachSlotId ?? "");
      const block = coerceLoopBlock(item);
      if (attachSlotId && block) loops.push({ attachSlotId, block, note: optionalNote(item.note) });
    }
  }

  collectSuggestionItems(raw.suggestions, loops, suggestions, undefined);
  return { loops, suggestions };
}

function collectSuggestionItems(
  items: unknown,
  loops: RawLoop[],
  suggestions: RawSuggestion[],
  inheritedLoopVar: string | undefined,
): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const nested = Array.isArray(item.suggestions) ? item.suggestions : null;
    const attachSlotId = typeof item.attachSlotId === "string" ? item.attachSlotId : "";
    if (attachSlotId && nested) {
      const loopVar = String(item.loopVar ?? "item");
      const block = coerceLoopBlock(item);
      if (block) loops.push({ attachSlotId, block, note: optionalNote(item.note) });
      collectSuggestionItems(nested, loops, suggestions, loopVar);
      continue;
    }
    if (typeof item.slotId === "string" && isRecord(item.block)) {
      suggestions.push({
        slotId: item.slotId,
        block: sanitizeBlock(item.block) as SuggestionBlock,
        loopVar: typeof item.loopVar === "string" ? item.loopVar : inheritedLoopVar,
        note: optionalNote(item.note),
        ...(parseAiConfidence(item.confidence) !== undefined
          ? { confidence: parseAiConfidence(item.confidence) }
          : {}),
      });
    }
  }
}

function coerceLoopBlock(item: Record<string, unknown>): SuggestionBlock | null {
  if (isRecord(item.block) && item.block.type === "for_each_list") {
    return sanitizeBlock(item.block) as SuggestionBlock;
  }
  if (isRecord(item.for_each_list) && item.for_each_list.type === "for_each_list") {
    return sanitizeBlock(item.for_each_list) as SuggestionBlock;
  }
  const sourceBlock = isRecord(item.block) && item.block.type === "for_each_source"
    ? item.block
    : isRecord(item.for_each_source) && item.for_each_source.type === "for_each_source"
    ? item.for_each_source
    : null;
  if (sourceBlock) {
    const fields = isRecord(sourceBlock.fields) ? sourceBlock.fields : {};
    return sourceLoopBlock(String(fields.VAR ?? item.loopVar ?? "item"), String(fields.PATH ?? ""));
  }
  const path = typeof item.for_each_source === "string"
    ? item.for_each_source
    : typeof item.PATH === "string"
    ? item.PATH
    : "";
  if (!path) return null;
  return sourceLoopBlock(String(item.loopVar ?? "item"), path);
}

function sourceLoopBlock(varName: string, path: string): SuggestionBlock {
  return {
    type: "for_each_list",
    fields: { VAR: varName || "item" },
    inputs: {
      LIST: {
        block: { type: "source_query_node", fields: { EXPRESSION: path } },
      },
    },
  };
}

function optionalNote(note: unknown): string | undefined {
  return typeof note === "string" ? note : undefined;
}


/** Valid `questions[]` entries (string or `{ text, options? }`), normalized; others dropped. */
function questionList(value: unknown): AiQuestionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAiQuestion).filter((q): q is AiQuestion => !!q).map((q) =>
    q.options.length
      ? { text: q.text, options: q.options.map((o) => o.recommended ? { text: o.text, recommended: true } : o.text) }
      : q.text
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

/** Warnings for `confidence` values that are present but not a 0..100 number (they are ignored on import). */
function confidenceIssues(instance: unknown): SchemaIssue[] {
  if (!isRecord(instance)) return [];
  const issues: SchemaIssue[] = [];
  const walk = (items: unknown, base: string) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, i) => {
      if (!isRecord(item)) return;
      const path = `${base}[${i}]`;
      if (item.confidence !== undefined && parseAiConfidence(item.confidence) === undefined) {
        issues.push({
          path: `${path}.confidence`,
          keyword: "confidence",
          message: `${path}.confidence: must be a number 0–100 (percent); got ${
            JSON.stringify(item.confidence)
          }. Ignored.`,
        });
      }
      walk(item.suggestions, `${path}.suggestions`);
    });
  };
  walk(instance.suggestions, "$.suggestions");
  return issues;
}

function sanitizeBlock(raw: Record<string, unknown>): Record<string, unknown> {
  const type = BLOCK_TYPE_ALIASES[String(raw.type ?? "")] ?? String(raw.type ?? "");
  const out: Record<string, unknown> = { type };
  if (isRecord(raw.fields)) out.fields = raw.fields;
  if (raw.extraState !== undefined) out.extraState = raw.extraState;
  if (isRecord(raw.inputs)) {
    const inputs: Record<string, unknown> = {};
    for (const [name, input] of Object.entries(raw.inputs)) {
      if (!isRecord(input)) continue;
      const next: Record<string, unknown> = {};
      if (isRecord(input.block)) next.block = sanitizeBlock(input.block);
      if (isRecord(input.shadow)) next.shadow = sanitizeBlock(input.shadow);
      inputs[name] = next;
    }
    out.inputs = inputs;
  }
  return out;
}

/**
 * A slot id from an AI answer as a known skeleton id: exact, `templateId//path`
 * vs `templateId/path`, the compact slot-tree id, or a unique tail (#277).
 */
export function resolveKnownSlotId(slotId: string, knownSlotIds: Set<string>): string | null {
  return resolveSlotRef(slotId, knownSlotIds);
}

/** `$item?pulse` / `$item.pulse` → `pulse` when `loopVar` is `item`. */
export function rewriteLoopRelativePath(expr: string, loopVar: string): string {
  const trimmed = expr.trim();
  if (!loopVar) return trimmed;
  const escaped = loopVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (trimmed === `$${loopVar}`) return ".";
  const lookup = new RegExp(`^\\$${escaped}\\?`);
  if (lookup.test(trimmed)) return trimmed.replace(lookup, "");
  const dotted = new RegExp(`^\\$${escaped}\\.`);
  if (dotted.test(trimmed)) return trimmed.replace(dotted, "");
  return trimmed;
}

export function importSuggestions(
  model: MappingModel,
  payload: SuggestionEnvelope,
  knownSlotIds: Set<string>,
  slotMeta?: Map<string, { rmType: string; returnType: string; label?: string; mandatory?: boolean }>,
): { model: MappingModel; report: ImportSuggestionsReport } {
  if (payload.target.targetId !== model.templateId) {
    throw new Error(
      `targetId mismatch: expected ${model.templateId}, got ${payload.target.targetId}`,
    );
  }
  if (model.targetFormat && payload.target.format !== model.targetFormat) {
    throw new Error(
      `target format mismatch: expected ${model.targetFormat}, got ${payload.target.format}`,
    );
  }

  let next = model;
  const report: ImportSuggestionsReport = {
    applied: 0,
    skipped: 0,
    errors: [],
    loopsAccepted: 0,
    schemaIssues: [],
  };

  const loopPaths = new Map<string, string>();
  const acceptedLoops: MappingLoop[] = [];
  for (const loop of payload.loops ?? []) {
    const attachSlotId = resolveKnownSlotId(loop.attachSlotId, knownSlotIds) ?? loop.attachSlotId;
    try {
      const block = coerceLoopBlock({ block: loop.block as unknown as Record<string, unknown> }) ??
        sanitizeBlock(loop.block as unknown as Record<string, unknown>) as SuggestionBlock;
      validateLoopEntry(block);
      if (!knownSlotIds.has(attachSlotId)) {
        throw new Error(`Unknown attachSlotId: ${loop.attachSlotId}`);
      }
      const varName = String(block.fields?.VAR ?? "");
      if (!varName) throw new Error(`${block.type} requires VAR`);
      if (block.type === "for_each_list") {
        const listBlock = block.inputs?.LIST?.block;
        if (!listBlock) throw new Error("for_each_list requires inputs.LIST");
        const sourcePath = sourceQueryExpression(listBlock);
        if (sourcePath) {
          const existingPath = loopPaths.get(varName);
          if (existingPath && existingPath !== sourcePath) {
            throw new Error(`Duplicate loop VAR: ${varName} with a different collection`);
          }
          loopPaths.set(varName, sourcePath);
          acceptedLoops.push({ attachSlotId, varName, path: sourcePath, kind: "source" });
          report.loopsAccepted++;
          continue;
        }
        const collection = suggestionBlockToExpression(listBlock);
        const existingPath = loopPaths.get(varName);
        if (existingPath && existingPath !== collection) {
          throw new Error(`Duplicate loop VAR: ${varName} with a different collection`);
        }
        loopPaths.set(varName, collection);
        acceptedLoops.push({
          attachSlotId,
          varName,
          path: "",
          kind: "list",
          collection,
        });
        report.loopsAccepted++;
        continue;
      }
      const path = String(block.fields?.PATH ?? sourceQueryExpression(block.inputs?.LIST?.block) ?? "");
      if (!path) throw new Error("source loop requires a source query in LIST or a PATH");
      const existingPath = loopPaths.get(varName);
      if (existingPath && existingPath !== path) {
        throw new Error(`Duplicate loop VAR: ${varName} with a different PATH`);
      }
      loopPaths.set(varName, path);
      acceptedLoops.push({ attachSlotId, varName, path });
      report.loopsAccepted++;
    } catch (e) {
      report.skipped++;
      report.errors.push(
        `loop ${loop.attachSlotId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (acceptedLoops.length) {
    const kept = (model.loops ?? []).filter(
      (existing) => !acceptedLoops.some((loop) => loop.attachSlotId === existing.attachSlotId),
    );
    next = { ...next, loops: [...kept, ...acceptedLoops] };
  }

  for (const suggestion of payload.suggestions) {
    const slotId = resolveKnownSlotId(suggestion.slotId, knownSlotIds);
    if (!slotId) {
      report.skipped++;
      report.errors.push(`Unknown slotId: ${suggestion.slotId}`);
      continue;
    }
    let expression: string;
    try {
      const block = sanitizeBlock(suggestion.block as unknown as Record<string, unknown>) as SuggestionBlock;
      if (block.type === "for_each_source" || block.type === "for_each_list") {
        throw new Error(`${block.type} belongs in loops[], not suggestions[].block`);
      }
      if (suggestion.loopVar && !loopPaths.has(suggestion.loopVar)) {
        throw new Error(`Unknown loopVar: ${suggestion.loopVar}`);
      }
      const rewrite = suggestion.loopVar
        ? (xpath: string) => rewriteLoopRelativePath(xpath, suggestion.loopVar!)
        : undefined;
      expression = suggestionBlockToExpression(block, rewrite);
    } catch (e) {
      report.skipped++;
      report.errors.push(
        `${suggestion.slotId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const err = validateExpressionSource(expression);
    if (err) {
      report.skipped++;
      report.errors.push(`${suggestion.slotId}: ${err}`);
      continue;
    }
    const meta = slotMeta?.get(slotId);
    next = applyExpressionEdit(next, slotId, expression, meta);
    const review = slotReviewFrom(suggestion.note, suggestion.confidence);
    if (review) next = withSlotReview(next, slotId, review);
    report.applied++;
  }

  return { model: next, report };
}

/** JSON-Schema fragments for the tools-mode `note` / `confidence` parameters (map_slot, import_suggestions). */
export const TOOL_REVIEW_PARAMS = {
  note: {
    type: "string",
    description: "Only for risks (ambiguous source, unit/coding mismatch, lossy conversion, guessed path).",
  },
  confidence: {
    type: "integer",
    minimum: 0,
    maximum: 100,
    description: "Estimated % chance the mapping is correct (0–100). Include only when below 90 or when asked.",
  },
} as const;

/**
 * Tools mode `import_suggestions { text, note?, confidence? }`: the call-level
 * `note` / `confidence` become defaults for suggestions that carry none.
 */
export function applySuggestionReviewDefaults(text: string, note: unknown, confidence: unknown): string {
  const pct = parseAiConfidence(confidence);
  const text0 = typeof note === "string" ? note.trim() : "";
  if (pct === undefined && !text0) return text;
  let envelope: unknown;
  try {
    envelope = extractSuggestionsJson(text);
  } catch {
    return text;
  }
  if (!isRecord(envelope) || !Array.isArray(envelope.suggestions)) return text;
  const suggestions = envelope.suggestions.map((item) => {
    if (!isRecord(item)) return item;
    return {
      ...item,
      ...(text0 && item.note === undefined ? { note: text0 } : {}),
      ...(pct !== undefined && item.confidence === undefined ? { confidence: pct } : {}),
    };
  });
  return "```intehrgrator-suggestions\n" + JSON.stringify({ ...envelope, suggestions }, null, 2) + "\n```";
}

/** AI review marker for a mapped slot: only when there is a note or a confidence value. */
export function slotReviewFrom(note: unknown, confidence: unknown): MappingSlotReview | undefined {
  const text = typeof note === "string" ? note.trim() : "";
  const pct = parseAiConfidence(confidence);
  if (!text && pct === undefined) return undefined;
  return { ...(pct !== undefined ? { confidence: pct } : {}), ...(text ? { note: text } : {}) };
}

export function withSlotReview(model: MappingModel, slotId: string, review: MappingSlotReview): MappingModel {
  return {
    ...model,
    slots: model.slots.map((slot) => slot.slotId === slotId ? { ...slot, review } : slot),
  };
}

/** Convert a v2 Blockly suggestion fragment into a Mapping Model expression string. */
export function suggestionBlockToExpression(
  block: SuggestionBlock,
  rewriteSourcePath?: (xpath: string) => string,
): string {
  const clean = sanitizeBlock(block as unknown as Record<string, unknown>) as SuggestionBlock;
  validateBlockShape(clean);
  const expr = blockJsonToExpression(clean, rewriteSourcePath);
  if (!expr) throw new Error(`Unsupported or empty block type: ${clean.type}`);
  return expr;
}

function sourceQueryExpression(block: SuggestionBlock | undefined): string | null {
  if (!block) return null;
  const type = BLOCK_TYPE_ALIASES[block.type] ?? block.type;
  if (
    type !== "source_query" && type !== "source_query_number" &&
    type !== "source_query_boolean" && type !== "source_query_node"
  ) {
    return null;
  }
  const expr = String(block.fields?.EXPRESSION ?? "");
  return expr || null;
}

function validateLoopEntry(block: SuggestionBlock): void {
  if (block?.type === "for_each_source") {
    if (block.inputs?.DO?.block) {
      throw new Error("Leave for_each_source DO empty; put value fills in suggestions[]");
    }
    return;
  }
  if (block?.type === "for_each_list") {
    if (block.inputs?.DO?.block) {
      throw new Error("Leave for_each_list DO empty; put value fills in suggestions[]");
    }
    return;
  }
  throw new Error("loops[].block must be type for_each_list");
}

function validateBlockShape(block: SuggestionBlock, depth = 0): void {
  if (depth > 12) throw new Error("Block tree too deep");
  if (!block || typeof block !== "object") throw new Error("Invalid block");
  const type = BLOCK_TYPE_ALIASES[block.type] ?? block.type;
  if (typeof type !== "string" || !VALUE_BLOCK_TYPES.has(type)) {
    throw new Error(`Disallowed block type: ${String(block?.type)}`);
  }
  for (const key of Object.keys(block)) {
    if (IGNORED_BLOCK_KEYS.has(key)) continue;
    if (!["type", "fields", "inputs", "extraState"].includes(key)) {
      throw new Error(`Disallowed block key: ${key}`);
    }
  }
  if (block.inputs) {
    for (const input of Object.values(block.inputs)) {
      if (input.shadow) throw new Error("Shadow blocks are not allowed; use block");
      if (input.block) validateBlockShape(input.block, depth + 1);
    }
  }
}

/** `logic_list_restriction` OP → Mapping Expression call (mirrors the Blockly block). */
const RESTRICTION_OP_CALLS: Record<string, string> = {
  ALL: "all_of",
  ANY: "any_of",
  NONE: "none_of",
  AT_LEAST: "at_least",
  AT_MOST: "at_most",
  EXACTLY: "exactly",
};

/** Operators the `NONEMPTY` guard applies to; the rest already exclude the empty list. */
const RESTRICTION_OPS_HOLDING_ON_EMPTY = ["ALL", "NONE", "AT_MOST"];

function blockJsonToExpression(
  block: SuggestionBlock,
  rewriteSourcePath?: (xpath: string) => string,
): string | null {
  const fields = block.fields ?? {};
  const child = (name: string) => block.inputs?.[name]?.block ?? null;

  switch (block.type) {
    case "source_query":
    case "source_query_number":
    case "source_query_boolean":
    case "source_query_node": {
      let xpath = String(fields.EXPRESSION ?? "");
      if (rewriteSourcePath) xpath = rewriteSourcePath(xpath);
      const fn = block.type === "source_query_number"
        ? "xpathNumber"
        : block.type === "source_query_boolean"
        ? "xpathBoolean"
        : block.type === "source_query_node"
        ? "xpathNode"
        : "xpathString";
      return `${fn}(${JSON.stringify(xpath)})`;
    }
    case "variables_get": {
      const name = String(fields.VAR ?? "item");
      return `var(${JSON.stringify(name)})`;
    }
    case "text":
    case "text_code":
      return JSON.stringify(textFieldValue(fields));
    case "text_handlebars": {
      const script = child("SCRIPT")
        ? blockJsonToExpression(child("SCRIPT")!, rewriteSourcePath)
        : '""';
      const context = child("CONTEXT")
        ? blockJsonToExpression(child("CONTEXT")!, rewriteSourcePath)
        : "map()";
      return `handlebars(${script ?? '""'}, ${context ?? "map()"})`;
    }
    case "maps_create_empty":
      return "map()";
    case "maps_create_with": {
      const itemCount = Number(
        (block.extraState as { itemCount?: number } | undefined)?.itemCount ?? 0,
      );
      const parts: string[] = [];
      for (let i = 0; i < itemCount; i++) {
        parts.push(JSON.stringify(String(fields[`KEY${i}`] ?? "")));
        const val = child(`VAL${i}`);
        parts.push(val ? blockJsonToExpression(val, rewriteSourcePath) ?? "null" : "null");
      }
      return `map(${parts.join(", ")})`;
    }
    case "maps_get": {
      const name = String(fields.NAME ?? "defaults");
      const key = child("KEY")
        ? blockJsonToExpression(child("KEY")!, rewriteSourcePath)
        : '""';
      return `maps_get(${JSON.stringify(name)}, ${key ?? '""'})`;
    }
    case "sheet_lookup": {
      const name = String(fields.NAME ?? "Sheet1");
      const col = child("MATCH_COL")
        ? blockJsonToExpression(child("MATCH_COL")!, rewriteSourcePath)
        : '""';
      const val = child("MATCH_VAL")
        ? blockJsonToExpression(child("MATCH_VAL")!, rewriteSourcePath)
        : '""';
      const ret = child("RETURN_COL")
        ? blockJsonToExpression(child("RETURN_COL")!, rewriteSourcePath)
        : '""';
      return `sheet_lookup(${JSON.stringify(name)}, ${col ?? '""'}, ${val ?? '""'}, ${ret ?? '""'})`;
    }
    case "sheet_get_cell": {
      const name = String(fields.NAME ?? "Sheet1");
      const a1 = child("A1")
        ? blockJsonToExpression(child("A1")!, rewriteSourcePath)
        : '"A1"';
      return `sheet_get_cell(${JSON.stringify(name)}, ${a1 ?? '"A1"'})`;
    }
    case "sheet_get_xy": {
      const name = String(fields.NAME ?? "Sheet1");
      const x = child("X") ? blockJsonToExpression(child("X")!, rewriteSourcePath) : "0";
      const y = child("Y") ? blockJsonToExpression(child("Y")!, rewriteSourcePath) : "0";
      return `sheet_get_xy(${JSON.stringify(name)}, ${x ?? "0"}, ${y ?? "0"})`;
    }
    case "sheet_get_row": {
      const name = String(fields.NAME ?? "Sheet1");
      const y = child("Y") ? blockJsonToExpression(child("Y")!, rewriteSourcePath) : "0";
      return `sheet_get_row(${JSON.stringify(name)}, ${y ?? "0"})`;
    }
    case "sheet_get_column": {
      const name = String(fields.NAME ?? "Sheet1");
      const x = child("X") ? blockJsonToExpression(child("X")!, rewriteSourcePath) : "0";
      return `sheet_get_column(${JSON.stringify(name)}, ${x ?? "0"})`;
    }
    case "sheet_get_header": {
      const name = String(fields.NAME ?? "Sheet1");
      const x = child("X") ? blockJsonToExpression(child("X")!, rewriteSourcePath) : "0";
      return `sheet_get_header(${JSON.stringify(name)}, ${x ?? "0"})`;
    }
    case "sheet_get_data": {
      const name = String(fields.NAME ?? "Sheet1");
      return `sheet_get_data(${JSON.stringify(name)})`;
    }
    case "decision_table": {
      const name = String(fields.NAME ?? "Decision1");
      const inputs = child("INPUTS")
        ? blockJsonToExpression(child("INPUTS")!, rewriteSourcePath)
        : "map()";
      const output = String(fields.OUTPUT ?? "out");
      return `decision_table(${JSON.stringify(name)}, ${inputs ?? "map()"}, ${JSON.stringify(output)})`;
    }
    case "math_number":
      return String(fields.NUM ?? 0);
    case "logic_boolean":
      return fields.BOOL === "TRUE" || fields.BOOL === true ? "true" : "false";
    case "text_trim": {
      const inner = child("TEXT")
        ? blockJsonToExpression(child("TEXT")!, rewriteSourcePath)
        : '""';
      return `trim(${inner ?? '""'})`;
    }
    case "text_changeCase": {
      const inner = child("TEXT")
        ? blockJsonToExpression(child("TEXT")!, rewriteSourcePath)
        : '""';
      const mode = String(fields.CASE ?? "LOWERCASE");
      return `change_case(${inner ?? '""'}, ${JSON.stringify(mode)})`;
    }
    case "text_join": {
      const itemCount = Number(
        (block.extraState as { itemCount?: number } | undefined)?.itemCount ??
          Object.keys(block.inputs ?? {}).filter((k) => k.startsWith("ADD")).length ??
          2,
      );
      const parts: string[] = [];
      for (let i = 0; i < itemCount; i++) {
        const c = child(`ADD${i}`);
        parts.push(c ? blockJsonToExpression(c, rewriteSourcePath) ?? '""' : '""');
      }
      if (parts.length === 0) return '""';
      if (parts.length === 1) return parts[0]!;
      return `concat(${parts.join(", ")})`;
    }
    case "logic_ternary": {
      const cond = child("IF")
        ? blockJsonToExpression(child("IF")!, rewriteSourcePath)
        : "false";
      const thenV = child("THEN")
        ? blockJsonToExpression(child("THEN")!, rewriteSourcePath)
        : "null";
      const elseV = child("ELSE")
        ? blockJsonToExpression(child("ELSE")!, rewriteSourcePath)
        : "null";
      return `if(${cond}, ${thenV}, ${elseV})`;
    }
    case "math_arithmetic": {
      const a = child("A") ? blockJsonToExpression(child("A")!, rewriteSourcePath) : "0";
      const b = child("B") ? blockJsonToExpression(child("B")!, rewriteSourcePath) : "0";
      const opMap: Record<string, string> = {
        ADD: "+",
        MINUS: "-",
        MULTIPLY: "*",
        DIVIDE: "/",
      };
      const op = opMap[String(fields.OP ?? "ADD")] ?? "+";
      return `(${a} ${op} ${b})`;
    }
    case "logic_compare": {
      const a = child("A") ? blockJsonToExpression(child("A")!, rewriteSourcePath) : "false";
      const b = child("B") ? blockJsonToExpression(child("B")!, rewriteSourcePath) : "false";
      const opMap: Record<string, string> = {
        EQ: "eq",
        NEQ: "ne",
        LT: "lt",
        LTE: "le",
        GT: "gt",
        GTE: "ge",
      };
      const fn = opMap[String(fields.OP ?? "EQ")] ?? "eq";
      return `${fn}(${a}, ${b})`;
    }
    case "logic_operation": {
      const a = child("A") ? blockJsonToExpression(child("A")!, rewriteSourcePath) : "false";
      const b = child("B") ? blockJsonToExpression(child("B")!, rewriteSourcePath) : "false";
      const fn = String(fields.OP ?? "AND") === "OR" ? "or" : "and";
      return `${fn}(${a}, ${b})`;
    }
    case "logic_negate": {
      const inner = child("BOOL")
        ? blockJsonToExpression(child("BOOL")!, rewriteSourcePath)
        : "false";
      return `not(${inner})`;
    }
    case "logic_list_restriction": {
      const list = child("LIST")
        ? blockJsonToExpression(child("LIST")!, rewriteSourcePath)
        : "list()";
      const pred = child("PRED")
        ? blockJsonToExpression(child("PRED")!, rewriteSourcePath)
        : "true";
      const name = JSON.stringify(String(fields.VAR ?? "item"));
      const op = String(fields.OP ?? "ALL");
      const fn = RESTRICTION_OP_CALLS[op] ?? "all_of";
      let call = `${fn}(${list}, ${name}, ${pred})`;
      if (op === "AT_LEAST" || op === "AT_MOST" || op === "EXACTLY") {
        const n = Number(fields.N ?? 0);
        call = `${fn}(${list}, ${Number.isFinite(n) ? n : 0}, ${name}, ${pred})`;
      }
      const guarded = fields.NONEMPTY === true || fields.NONEMPTY === "TRUE";
      if (!guarded || !RESTRICTION_OPS_HOLDING_ON_EMPTY.includes(op)) return call;
      return `and(any_of(${list}, ${name}, true), ${call})`;
    }
    case "logic_current_item":
      return `var(${JSON.stringify(String(fields.VAR || "item"))})`;
    case "logic_loop_index": {
      const loopItem = String(fields.VAR || "item") || "item";
      return `var(${JSON.stringify(loopIndexBinderName(loopItem))})`;
    }
    case "logic_loop_length": {
      const loopItem = String(fields.VAR || "item") || "item";
      return `var(${JSON.stringify(loopLengthBinderName(loopItem))})`;
    }
    case "lists_set_operation": {
      const a = child("A") ? blockJsonToExpression(child("A")!, rewriteSourcePath) : "list()";
      const b = child("B") ? blockJsonToExpression(child("B")!, rewriteSourcePath) : "list()";
      const op = String(fields.OP ?? "BOTH");
      const fn = op === "EITHER" ? "union" : op === "NOT_IN" ? "difference" : "intersection";
      return `${fn}(${a}, ${b})`;
    }
    default:
      return null;
  }
}

function textFieldValue(fields: Record<string, unknown>): string {
  const text = fields.TEXT;
  if (typeof text === "string") return text;
  if (text && typeof text === "object" && typeof (text as { text?: unknown }).text === "string") {
    return (text as { text: string }).text;
  }
  return "";
}
