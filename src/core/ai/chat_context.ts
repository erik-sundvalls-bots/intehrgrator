/**
 * AI chat **Context chips**: references to source / target nodes and Blockly
 * blocks that the user adds with "Add to AI chat". In the input they are short
 * inline pills; on send they expand into a fixed "Context attachments" block so
 * the model does not have to guess paths or types.
 */

export type ContextChipKind = "source-schema" | "source-example" | "target" | "block";

export interface ContextChip {
  kind: ContextChipKind;
  /** Short pill text (node name, slot label, block type). */
  label: string;
  /** Source schema / example / target template filename. */
  filename?: string;
  /** Source path, target slot path, … */
  path?: string;
  /** Source schema type or block type. */
  type?: string;
  /** Example instance value (source) when cheaply available. */
  exampleValue?: string;
  /** Target slot id. */
  slotId?: string;
  /** Target RM type. */
  rmType?: string;
  /** Units / constraints when cheaply available. */
  constraints?: string;
  /** Blockly block id. */
  blockId?: string;
  /** Slot the block is bound to (nearest `SLOT_ID`). */
  boundSlot?: string;
  /** Source path the block reads (nearest `EXPRESSION`). */
  boundSourcePath?: string;
}

/** One piece of the chat input: plain text or an inline chip. */
export type ChatInputPart = { text: string } | { chip: ContextChip };

const KIND_HEADER: Record<ContextChipKind, string> = {
  "source-schema": "SOURCE NODE (schema)",
  "source-example": "SOURCE NODE (example instance)",
  "target": "TARGET NODE",
  "block": "BLOCKLY BLOCK",
};

const KIND_SHORT: Record<ContextChipKind, string> = {
  "source-schema": "Source",
  "source-example": "Source",
  "target": "Target",
  "block": "Block",
};

/** Stable identity so the same node is only described once per chat. */
export function chipKey(chip: ContextChip): string {
  if (chip.kind === "block") return `block:${chip.blockId ?? chip.label}`;
  if (chip.kind === "target") return `target:${chip.slotId ?? chip.path ?? chip.label}`;
  return `${chip.kind}:${chip.filename ?? ""}:${chip.path ?? chip.label}`;
}

/** Inline reference text used in the message body, e.g. `[@Source: systolic]`. */
export function chipReference(chip: ContextChip): string {
  return `[@${KIND_SHORT[chip.kind]}: ${chip.label}]`;
}

/** Label/value rows for the hover popover (and the attachments block). */
export function chipDetails(chip: ContextChip): Array<[string, string]> {
  const rows: Array<[string, string | undefined]> = [];
  switch (chip.kind) {
    case "source-schema":
    case "source-example":
      rows.push(
        ["File", chip.filename],
        ["Path", chip.path],
        ["Type", chip.type],
        ["Example value", chip.exampleValue],
      );
      break;
    case "target":
      rows.push(
        ["Template", chip.filename],
        ["Slot", chip.slotId],
        ["Path", chip.path && chip.path !== chip.slotId ? chip.path : undefined],
        ["RM type", chip.rmType],
      );
      break;
    case "block":
      rows.push(
        ["Block type", chip.type],
        ["Block id", chip.blockId],
        ["Bound slot", chip.boundSlot],
        ["Source path", chip.boundSourcePath],
      );
      break;
  }
  rows.push(["Constraints", chip.constraints]);
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

export function chipHeader(chip: ContextChip): string {
  return KIND_HEADER[chip.kind];
}

/** Multi-line plain text for a `title` tooltip / popover. */
export function chipHoverText(chip: ContextChip): string {
  return [chipHeader(chip), ...chipDetails(chip).map(([k, v]) => `${k}: ${v}`)].join("\n");
}

export function chipAttachmentLine(chip: ContextChip): string {
  const details = chipDetails(chip).map(([k, v]) => `${k}: \`${v}\``).join(" · ");
  return `- ${chipReference(chip)} (${chipHeader(chip)}) ${details}`.trimEnd();
}

export const CONTEXT_ATTACHMENTS_HEADING = "### Context attachments";

export function formatContextAttachments(chips: ContextChip[]): string {
  if (!chips.length) return "";
  return [CONTEXT_ATTACHMENTS_HEADING, ...chips.map(chipAttachmentLine)].join("\n");
}

/** Normalize adjacent text parts and drop empty ones. */
export function normalizeParts(parts: ChatInputPart[]): ChatInputPart[] {
  const out: ChatInputPart[] = [];
  for (const part of parts) {
    if ("text" in part) {
      if (!part.text) continue;
      const last = out[out.length - 1];
      if (last && "text" in last) last.text += part.text;
      else out.push({ text: part.text });
    } else {
      out.push(part);
    }
  }
  return out;
}

export function partsChips(parts: ChatInputPart[]): ContextChip[] {
  const seen = new Set<string>();
  const chips: ContextChip[] = [];
  for (const part of parts) {
    if (!("chip" in part)) continue;
    const key = chipKey(part.chip);
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push(part.chip);
  }
  return chips;
}

export interface ComposedUserMessage {
  /** Text sent to the model (inline references + attachments for new chips). */
  text: string;
  /** User text with inline chip references, no attachments (chat display). */
  displayText: string;
  /** Chips whose details were attached in this message. */
  attachedKeys: string[];
}

/**
 * Turn the chat input into the user message. Chips already described earlier
 * in the conversation (`alreadyAttached`) are referenced inline only.
 */
export function composeUserMessage(
  parts: ChatInputPart[],
  alreadyAttached: Iterable<string> = [],
): ComposedUserMessage {
  const sent = new Set(alreadyAttached);
  const displayText = normalizeParts(parts)
    .map((part) => ("text" in part ? part.text : chipReference(part.chip)))
    .join("")
    .trim();
  const fresh = partsChips(parts).filter((chip) => !sent.has(chipKey(chip)));
  const attachments = formatContextAttachments(fresh);
  return {
    text: attachments ? `${displayText}\n\n${attachments}` : displayText,
    displayText,
    attachedKeys: fresh.map(chipKey),
  };
}

export const SOURCE_NODE_PLACEHOLDER = "{source_node}";
export const TARGET_NODE_PLACEHOLDER = "{target_node}";

function isSourceChip(chip: ContextChip): boolean {
  return chip.kind === "source-schema" || chip.kind === "source-example";
}

/**
 * Expand a Stored prompt into input parts. `{source_node}` takes the first
 * source chip; `{target_node}` the first target chip, else the first block chip.
 * A placeholder without a matching chip stays visible as text.
 */
export function fillPromptPlaceholders(text: string, chips: ContextChip[]): ChatInputPart[] {
  const source = chips.find(isSourceChip);
  const target = chips.find((chip) => chip.kind === "target") ??
    chips.find((chip) => chip.kind === "block");
  const parts: ChatInputPart[] = [];
  const re = /\{source_node\}|\{target_node\}/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    parts.push({ text: text.slice(last, index) });
    const chip = match[0] === SOURCE_NODE_PLACEHOLDER ? source : target;
    parts.push(chip ? { chip } : { text: match[0] });
    last = index + match[0].length;
  }
  parts.push({ text: text.slice(last) });
  return normalizeParts(parts);
}
