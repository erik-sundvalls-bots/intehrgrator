import type { SheetDocument } from "../core/sheets/types.ts";

export const MODEL_VERSION = 3;

/** Conversion script language. Deliberately separate from Target instance format. */
export type ConversionScriptLanguage = "typescript" | "java" | "handlebars" | "xquery" | "go-template";

export type ExportTarget = ConversionScriptLanguage;

export const CONVERSION_SCRIPT_LANGUAGES: readonly ConversionScriptLanguage[] = [
  "typescript",
  "java",
  "handlebars",
  "xquery",
  "go-template",
];

/** Target & Previews header select. Mapping preview is not a script dialect. */
export type OutputMode = "preview" | ConversionScriptLanguage;

export const MAPPING_PREVIEW_SCRIPT_PLACEHOLDER =
  "// Pick a conversion script language above to generate conversion code.\n";

export function isConversionScriptLanguage(
  value: string,
): value is ConversionScriptLanguage {
  return (CONVERSION_SCRIPT_LANGUAGES as readonly string[]).includes(value);
}

export function isOutputMode(value: string): value is OutputMode {
  return value === "preview" || isConversionScriptLanguage(value);
}

export function conversionScriptLanguageLabel(
  language: ConversionScriptLanguage,
): string {
  if (language === "typescript") return "TypeScript";
  if (language === "java") return "Java";
  if (language === "handlebars") return "Handlebars";
  if (language === "go-template") return "Go Template";
  return "XQuery";
}

export function unimplementedTestRunMessage(language: ConversionScriptLanguage): string {
  return `// Conversion Test Run for ${conversionScriptLanguageLabel(language)} is not implemented yet.\n`;
}

/** Desired openEHR instance serialization (session-only; affects XQuery export / Test Run). */
export type OpenEhrInstanceShape = "json" | "xml";

/**
 * How an Instance root serializes a produced instance (persisted on the block).
 * Official openEHR encodings only — not ehrtslib hybrid/compact/terse presets.
 */
export type InstanceEncoding =
  | "canonical-json"
  | "canonical-xml"
  | "flat-json"
  | "structured-json";

export const DEFAULT_INSTANCE_ENCODING: InstanceEncoding = "canonical-json";

export const INSTANCE_ENCODING_OPTIONS: ReadonlyArray<{
  id: InstanceEncoding;
  label: string;
}> = [
  { id: "canonical-json", label: "Canonical JSON" },
  { id: "canonical-xml", label: "Canonical XML" },
  { id: "flat-json", label: "Simplified FLAT" },
  { id: "structured-json", label: "Simplified STRUCTURED" },
];

export const INSTANCE_ENCODINGS: readonly InstanceEncoding[] = INSTANCE_ENCODING_OPTIONS
  .map((option) => option.id);

export function isInstanceEncoding(value: string): value is InstanceEncoding {
  return (INSTANCE_ENCODINGS as readonly string[]).includes(value);
}

export function isJsonFamilyEncoding(encoding: InstanceEncoding): boolean {
  return encoding !== "canonical-xml";
}

export function instanceEncodingDropdownOptions(): Array<[string, string]> {
  return INSTANCE_ENCODING_OPTIONS.map((option) => [option.label, option.id]);
}

/** Structure produced by a conversion. */
export type TargetFormatId =
  | "openehr-template"
  | "json-schema"
  | "xml-schema"
  | "free-form";

export type MappingEscapeKind = "text_code" | "text_handlebars";

/** Kind of Blockly Function in the derived Mapping Model. */
export type MappingFunctionKind = "return" | "statement";

/**
 * Derived index of a canvas Blockly Function (`procedures_defreturn` /
 * `procedures_defnoreturn`). Value Functions serialize as Mapping Expression
 * `call("name", …)` and codegen emits a reusable named function where the
 * Conversion script language allows it.
 */
export interface MappingFunction {
  name: string;
  kind: MappingFunctionKind;
  params: string[];
  /** Mapping Expression body for value Functions. */
  body?: string;
}

/** Escape-hatch metadata on a value slot (`text_code` LANG or Handlebars). */
export interface MappingSlotHatch {
  kind: MappingEscapeKind;
  /** `text_code` LANG dropdown (plain, handlebars, go-template, …). */
  lang?: string;
}

export interface MappingSlot {
  slotId: string;
  rmType: string;
  expression: string;
  returnType: string;
  label?: string;
  mandatory?: boolean;
  hatch?: MappingSlotHatch;
  /** Unreviewed AI suggestion marker (note / confidence); cleared on edit or *Mark as reviewed*. */
  review?: MappingSlotReview;
}

/**
 * AI-estimated probability (integer percent 0–100) that a suggested mapping is
 * correct. Kept raw so it can feed later calibration against user outcomes.
 */
export type AiConfidence = number;

/** What the user later did with an AI-marked mapping (calibration signal). */
export type AiReviewOutcome = "reviewed" | "edited";

export interface MappingSlotReview {
  confidence?: AiConfidence;
  note?: string;
  /** Set when the user marks it reviewed or edits it; the canvas marker hides then. */
  outcome?: AiReviewOutcome;
  /** ISO timestamp of `outcome`. */
  outcomeAt?: string;
}

export interface OptionalRmInsertion {
  attachmentSlotId: string;
  rmType: string;
  attributeName: string;
}

export type MappingLoopKind = "source" | "list";

export interface MappingLoop {
  attachSlotId: string;
  varName: string;
  /** Absolute source path of the iterated nodes (source loops). Empty for list loops. */
  path: string;
  kind?: MappingLoopKind;
  /** Mapping Expression for the iterated list (`for_each_list`). */
  collection?: string;
}

export type MappingUnsupportedReason = "escape" | "unsupported" | "removed";

/** Block that is not first-class IR — recorded so exporters do not drop it silently. */
export interface MappingUnsupportedBlock {
  blockType: string;
  slotId?: string;
  reason: MappingUnsupportedReason;
  /** `text_code` LANG when `reason` is `"escape"`. */
  lang?: string;
}

/** Nested RM / schema tree extracted from the canvas. */
export interface TargetSignatureNode {
  slotId: string;
  rmType: string;
  label?: string;
  optional?: boolean;
  children: TargetSignatureNode[];
}

export interface MappingModel {
  modelVersion: number;
  /** Target definition id (openEHR template id, schema id, or free-form name). */
  templateId: string;
  targetFormat?: TargetFormatId;
  slots: MappingSlot[];
  optionalRm: OptionalRmInsertion[];
  /** Repeatable iteration (`for_each_list`; source-node grain when LIST is a source query). */
  loops?: MappingLoop[];
  /** Nested target structure (optional RM / schema extras marked `optional`). */
  targetSignature?: TargetSignatureNode[];
  /** Escape-hatch, leftover Remove-list, or unknown blocks. */
  unsupported?: MappingUnsupportedBlock[];
  /** Sheet documents referenced by accessors or `sheet` declarations. */
  sheetNames?: string[];
  /**
   * Instance encoding of each COMPOSITION (and later CONTRIBUTION) on the
   * Product stack, in stack order. Text document roots are omitted.
   */
  instanceEncodings?: InstanceEncoding[];
  /** Blockly Functions derived from `procedures_def*` on the canvas. */
  functions?: MappingFunction[];
}

export type SkeletonNodeKind = "container" | "value";

/**
 * RM BMM vs effective OPT interval for one Attribute mouth (or a prohibited
 * Optional RM Insertion row). Blockly captions are a view of this pair.
 */
export interface AttributeConstraint {
  name: string;
  /** Compact RM BMM multiplicity, e.g. `0..1` / `0..*`. */
  rmCardinality: string;
  /** Compact effective OPT existence or cardinality. */
  effectiveCardinality: string;
  /** True when the OPT prohibits the attribute (`max=0`). */
  prohibited?: boolean;
}

/** One member of a template-constrained coded/string value set. */
export interface AllowedValue {
  code: string;
  label: string;
  terminologyId?: string;
  /** True when this choice is the template/AOM `assumed_value`. */
  assumed?: boolean;
}

/** One member of a template-constrained `DV_ORDINAL` / `DV_SCALE` value set. */
export interface AllowedOrdinal {
  value: number;
  code: string;
  label: string;
  terminologyId?: string;
  /** True when this choice is the template/AOM `assumed_value`. */
  assumed?: boolean;
}

export interface SkeletonNode {
  slotId: string;
  blockType: string;
  rmType: string;
  label: string;
  archetypeNodeId?: string;
  /** Template id prefix used in slot paths. */
  archetypeId?: string;
  /** openEHR archetype id owning this node's at-code terminology. */
  archetypeRef?: string;
  /** Short archetype name for at-code disambiguation in the UI. */
  archetypeShortName?: string;
  /** Template-constrained LOCATABLE.name (`C_STRING` list / AQL name hint). */
  nameConstraint?: string;
  /**
   * The term in the target's primary language (the first language in the OPT),
   * set when `label` is in another language. Output names never follow the
   * display language.
   */
  primaryName?: string;
  kind: SkeletonNodeKind;
  /** RM attribute on the parent object this node occupies (e.g. data, items, value). */
  rmAttribute?: string;
  mandatory: boolean;
  silentMandatory?: boolean;
  fixedValue?: string;
  fixedFields?: Record<string, string>;
  /**
   * Template-constrained value set (C_CODE_PHRASE `code_list`, C_STRING list, …)
   * when more than one code/string is allowed. Scaffolded as a Blockly list of
   * complete `DV_CODED_TEXT` / `CODE_PHRASE` objects wrapped in `lists_getIndex`.
   */
  allowedValues?: AllowedValue[];
  /**
   * Template-constrained ordinal/scale choices (`C_ORDINAL` / `C_DV_ORDINAL` list)
   * when more than one value is allowed. Scaffolded as a Blockly list of complete
   * `DV_ORDINAL` / `DV_SCALE` objects wrapped in `lists_getIndex`.
   */
  allowedOrdinals?: AllowedOrdinal[];
  /**
   * Template-constrained quantity units (`C_QUANTITY` / `C_DV_QUANTITY` list)
   * when more than one unit is allowed. A single constrained unit is stored in
   * `fixedFields.units` instead.
   */
  allowedUnits?: string[];
  /** Format-native target path (JSON Pointer, XML path, or openEHR slot path). */
  targetPath?: string;
  /** Compact target cardinality, e.g. `1`, `0..1`, `0..*`, `1..*`. */
  multiplicity?: string;
  /** Cardinality of the parent attribute slot this node occupies. */
  slotCardinality?: string;
  /** RM BMM multiplicity of the parent attribute this node occupies. */
  rmCardinality?: string;
  /** Effective OPT existence/cardinality of that parent attribute. */
  effectiveCardinality?: string;
  /**
   * Per-attribute RM vs effective intervals on this RM class, including
   * template-prohibited (`max=0`) attributes that never become mouths.
   */
  attributeConstraints?: AttributeConstraint[];
  /**
   * Free-text documentation for the help popup (JSON Schema `description`,
   * XSD `xs:documentation`). openEHR RM class/attr prose comes from ehrtslib
   * `spec` instead.
   */
  documentation?: string;
  /** XML Schema only: attribute vs child element. */
  xmlKind?: "element" | "attribute";
  children: SkeletonNode[];
  attachmentPoint?: string;
}

export interface AttachmentOption {
  rmType: string;
  attributeName: string;
  label: string;
  cardinality: { min: number; max: number | null };
}

export interface SchemaTreeNode {
  path: string;
  name: string;
  type: string;
  value?: unknown;
  /** Compact cardinality, e.g. `1`, `0..1`, `0..*`, `1..*`. */
  multiplicity?: string;
  /** JSON Schema `description` or similar prose for the help popup. */
  description?: string;
  /** Language of `description` when known (XSD `xml:lang`, JSON Schema `x-i18n` key / `x-lang`) (#277 §5). */
  descriptionLang?: string;
  children: SchemaTreeNode[];
}

/**
 * Source payload format id. It is intentionally open so registered adapters
 * do not require widening a union in every caller.
 */
export type SourceFormatId = string;

export interface ExampleInstance {
  id: string;
  filename: string;
  format: SourceFormatId;
  content: string;
}

export interface ClinicalModelFileset {
  sourceUrl?: string;
  rootPath: string;
  files: Array<{ path: string; content: string }>;
}

export type OpenEhrJsonDeserializeMode =
  | "canonical-strict"
  | "default"
  | "compact"
  | "hybrid"
  | "terse";

export interface ProjectSettings {
  /** Session Output mode. Not restored from a Project Bundle. */
  exportTarget: OutputMode;
  /**
   * Session openEHR JSON vs XML instance preference. Affects XQuery export and
   * XQuery Conversion Test Run. Not a Conversion script language.
   */
  openEhrInstanceShape: OpenEhrInstanceShape;
  theme: "karolinska";
  /** ehrtslib JSON deserializer preset when validating openEHR Conversion Test Run output. */
  openEhrJsonDeserializeMode: OpenEhrJsonDeserializeMode;
  autoscroll: boolean;
  autoplay: boolean;
  /** Ontology / localizedNames language the target is currently shown in. */
  modelLanguage?: string;
  /** `source.lang.N` set by the user (#277 §4); unset = detected from the source. */
  sourceLanguages?: string[];
  /** Which target languages' labels go to the AI (#279); default `matched`. */
  aiContextLanguages?: "matched" | "lang1" | "all";
  /** Display languages chosen in the 💬 widgets (#279); unset = `lang.1`. */
  display?: { targetLabelLang?: string; sourceLabelLang?: string };
  /** Copy & paste AI prompt also attaches the raw target file (#277; off: slot tree only). */
  aiAttachOriginalTarget?: boolean;
}

export interface ProjectBundle {
  version: number;
  projectId: string;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  target: {
    format: TargetFormatId;
    filename: string;
    targetId: string;
    content: string;
    skeleton: SkeletonNode[];
    fileset?: ClinicalModelFileset;
    language?: string;
    languages?: string[];
    webTemplateJson?: string;
  } | null;
  sourceSchema: {
    filename: string;
    format?: SourceFormatId;
    content: string;
    tree: SchemaTreeNode[];
  } | null;
  examples: ExampleInstance[];
  activeExampleId: string | null;
  mapping: {
    blocklyState: unknown;
    model: MappingModel;
    /** Retired Template tab string; canvas `text_handlebars` is canonical. */
    handlebarsTemplate?: string;
    /** Named 2D Sheet / Decision table documents (widget is a view). */
    sheets?: SheetDocument[];
  };
  settings: ProjectSettings;
  /** Recent schema / example / target URLs (including GitHub .t.json closures). */
  urlHistory?: {
    schema: string[];
    example: string[];
    target: string[];
  };
  aiAssist?: {
    lastPrompt?: string;
    lastImportReport?: string;
  };
}

export interface OutputValidationMessage {
  path: string;
  message: string;
  severity: "error" | "warning" | "info";
  /** Best-effort line in the Conversion Test Run JSON (not from ehrtslib). */
  line?: number;
}

export interface OutputValidation {
  /** False when Target instance format is not an openEHR template. */
  applicable: boolean;
  valid: boolean;
  messages: OutputValidationMessage[];
}

export interface TestResult {
  ok: boolean;
  /** Format-neutral conversion result. */
  output?: unknown;
  error?: string;
  warnings: string[];
  outputValidation?: OutputValidation;
}

/** Blockly JSON fragment allowed in AI suggestion envelopes (version 2). */
export interface SuggestionBlock {
  type: string;
  fields?: Record<string, string | number | boolean>;
  inputs?: Record<string, { block?: SuggestionBlock; shadow?: SuggestionBlock }>;
  extraState?: unknown;
}

/** `questions[]` item: a string, or `{ text, options? }` (option: string or `{ text, recommended? }`). */
export type AiQuestionEntry =
  | string
  | { text: string; options?: Array<string | { text: string; recommended?: boolean }> };

export interface SuggestionEnvelope {
  format: "intehrgrator-suggestions";
  version: "2";
  target: {
    format: TargetFormatId | string;
    targetId: string;
  };
  /** Repeatable source→target iteration (`for_each_list`). */
  loops?: Array<{
    attachSlotId: string;
    block: SuggestionBlock;
    note?: string;
  }>;
  suggestions: Array<{
    slotId: string;
    block: SuggestionBlock;
    /** When set, `block` EXPRESSION is relative to that loop VAR's PATH. */
    loopVar?: string;
    note?: string;
    /** Integer percent 0–100; omitted when the model is confident (≥ ~90). */
    confidence?: AiConfidence;
  }>;
  /** Top-level risks for the user (sparingly). */
  notes?: string[];
  /** Questions for the user: plain text, or text plus suggested answers. */
  questions?: AiQuestionEntry[];
}

export interface SchemaIssue {
  path: string;
  message: string;
  keyword?: string;
}

export interface ImportSuggestionsReport {
  applied: number;
  skipped: number;
  errors: string[];
  /** Validated `loops[]` entries; the canvas wraps `attachSlotId` with `for_each_list`. */
  loopsAccepted: number;
  /** JSON Schema issues against docs/AI_SUGGESTION_FORMAT.schema.json. */
  schemaIssues: SchemaIssue[];
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  exportTarget: "preview",
  theme: "karolinska",
  openEhrJsonDeserializeMode: "canonical-strict",
  openEhrInstanceShape: "json",
  autoscroll: true,
  /** Auto-run Conversion Test Run(s) for all test files after edits (#246). Pause is opt-in. */
  autoplay: true,
};
