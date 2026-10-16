import { Blockly } from "./blockly_core.ts";
import { isSkeletonTitleField } from "./field_skeleton_title.ts";
import { BLOCK_OUT_EMOJI_FIELD, isRmTypeEmojiField } from "./rm_type_emoji.ts";
import { isSlotCardinalityField } from "./slot_cardinality.ts";
import { isSlotLabelField } from "./slot_label.ts";
import { isTrailingChromeFieldName, MUTATOR_COG_FIELD } from "./mouth_layout.ts";

export const COMPACT_RENDERER_NAME = "thrasos-compact";

/**
 * Thrasos with tighter padding so mapping blocks spend less vertical space.
 * Puzzle-tab geometry is left at Thrasos defaults so connections still mate.
 * In-row gaps next to ZipEHR type glyphs are reduced so they sit against
 * the class name and the connection notch.
 *
 * When a value input already has a child, Thrasos still appends the empty
 * socket subpath onto the parent `blocklyPath`. Modest-theme CSS strokes
 * every `.blocklyPath` white, so that extra bezier is drawn as a hook on
 * top of the nested child — especially inside a larger inline row. Skip
 * the hole and only position the connection.
 *
 * Row alignment: class chrome (emoji / skeleton title / cog) stays LEFT on
 * the block; slot captions hug their mouths (RIGHT). Prevents HEADER fields
 * from riding a right-aligned value/statement row after inline merges.
 * After packing a compact statement C, pin `statementEdge` to that C so
 * snap/highlight sit on the bump (issue #105). Statement captions hug that
 * C (RIGHT); leftover in the statement column sits left of the caption.
 *
 * Vertical: Thrasos pins statement-row fields to the notch, but still
 * centers fields on tall *value* rows (`row.height / 2`). Schema single-
 * occurrence children are puzzle (value) slots, so attribute captions were
 * floating mid-child. Pin slot captions to the socket/notch like Zelos.
 */
export function registerCompactThrasosRenderer(): string {
  // deno-lint-ignore no-explicit-any
  const Base = Blockly.thrasos.Renderer as any;
  // deno-lint-ignore no-explicit-any
  const BaseInfo = Blockly.thrasos.RenderInfo as any;
  // deno-lint-ignore no-explicit-any
  const BaseDrawer = Blockly.blockRendering.Drawer as any;
  const AlignLeft = Blockly.inputs?.Align?.LEFT ?? -1;
  const AlignRight = Blockly.inputs?.Align?.RIGHT ?? 1;

  class CompactRenderInfo extends (BaseInfo ?? Object) {
    // deno-lint-ignore no-explicit-any
    getInRowSpacing_(prev: any, next: any) {
      const spacing = super.getInRowSpacing_(prev, next);
      if (isZeroSizeMeasurable(prev) || isZeroSizeMeasurable(next)) return 0;
      // Keep a readable inset before the first field on a row (class chrome,
      // titles) so glyphs/labels do not sit flush on the block edge.
      if (!prev && next?.field) {
        const edge = Number(this.constants_?.MEDIUM_PADDING ?? COMPACT_PADDING.MEDIUM);
        return Math.max(spacing, edge);
      }
      // Hug statement/value mouths: slot captions and any field sitting
      // immediately before a statement/external input get tight spacing.
      if (
        isRmEmojiMeasurable(prev) || isRmEmojiMeasurable(next) ||
        isSlotCardMeasurable(prev) || isSlotCardMeasurable(next) ||
        isSlotLabelMeasurable(prev) || isSlotLabelMeasurable(next) ||
        isFieldBeforeMouth_(prev, next)
      ) {
        return Math.min(spacing, 1);
      }
      // Tighten gaps between consecutive in-row fields (title, labels, +).
      if (prev?.field && next?.field) {
        return Math.min(spacing, 2);
      }
      return spacing;
    }

    // deno-lint-ignore no-explicit-any
    addAlignmentPadding_(row: any, missingSpace: number) {
      applyOpenEhrRowAlign_(row, AlignLeft, AlignRight);
      if (padBeforeTrailingChrome_(row, missingSpace)) return;
      return super.addAlignmentPadding_(row, missingSpace);
    }

    /**
     * Statement captions hug the C (RIGHT): leftover in the statement column
     * sits left of the caption. Stock `alignStatementRow_` then stretches the
     * C to the right — do not pad that remainder onto the first spacer or the
     * C slides to the far right tooth (issue #105).
     */
    // deno-lint-ignore no-explicit-any
    alignStatementRow_(row: any) {
      applyOpenEhrRowAlign_(row, AlignLeft, AlignRight);
      super.alignStatementRow_(row);
      const notchX = pinStatementRowNotch_(row);
      const connected = Number(row.connectedBlockWidths ?? 0);
      row.widthWithConnectedBlocks = Math.max(
        Number(row.width ?? 0),
        notchX + connected,
      );
    }

    // deno-lint-ignore no-explicit-any
    getElemCenterline_(row: any, elem: any) {
      if (shouldPinSlotCaptionToMouth_(row, elem)) {
        return pinnedSlotCaptionCenterline_(row, elem, this.constants_);
      }
      return super.getElemCenterline_(row, elem);
    }
  }

  class CompactDrawer extends (BaseDrawer ?? Object) {
    // deno-lint-ignore no-explicit-any
    drawInlineInput_(input: any) {
      if (input?.connectedBlock) {
        this.positionInlineInputConnection_(input);
        return;
      }
      super.drawInlineInput_(input);
    }

    // deno-lint-ignore no-explicit-any
    positionStatementInputConnection_(row: any) {
      pinStatementRowNotch_(row);
      return super.positionStatementInputConnection_(row);
    }
  }

  class CompactThrasosRenderer extends Base {
    makeConstants_() {
      const constants = super.makeConstants_();
      applyCompactConstants(constants);
      return constants;
    }

    // deno-lint-ignore no-explicit-any
    init(theme: any, overrides?: any) {
      super.init(theme, overrides);
      applyCompactConstants(this.getConstants?.() ?? this.constants_);
    }

    // deno-lint-ignore no-explicit-any
    makeRenderInfo_(block: any) {
      // deno-lint-ignore no-explicit-any
      if (BaseInfo) return new (CompactRenderInfo as any)(this, block);
      return super.makeRenderInfo_(block);
    }

    // deno-lint-ignore no-explicit-any
    makeDrawer_(block: any, info: any) {
      // deno-lint-ignore no-explicit-any
      if (BaseDrawer) return new (CompactDrawer as any)(block, info);
      return super.makeDrawer_(block, info);
    }
  }
  // unregister() warns when the name is absent. The first boot has nothing to remove.
  if (Blockly.registry.hasItem(Blockly.registry.Type.RENDERER, COMPACT_RENDERER_NAME)) {
    Blockly.blockRendering.unregister(COMPACT_RENDERER_NAME);
  }
  Blockly.blockRendering.register(
    COMPACT_RENDERER_NAME,
    // deno-lint-ignore no-explicit-any
    CompactThrasosRenderer as any,
  );
  return COMPACT_RENDERER_NAME;
}

/**
 * Compact padding that still leaves room for labels/icons at block edges and
 * for statement children inside parent mouths (issue #66). Blockly defaults
 * are SMALL=3, MEDIUM=5, LARGE=10, STATEMENT_INPUT_PADDING_LEFT=20.
 */
export const COMPACT_PADDING = {
  SMALL: 3,
  MEDIUM: 4,
  LARGE: 8,
  /** Left inset of statement-stack children inside a C-mouth (was 1 → too deep). */
  STATEMENT_INPUT_LEFT: 14,
  STATEMENT_BOTTOM: 6,
  BETWEEN_STATEMENT_Y: 2,
} as const;

/** Theme `init()` rewrites dummy/inline heights from TAB_HEIGHT; re-apply after. */
// deno-lint-ignore no-explicit-any
export function applyCompactConstants(constants: any): void {
  if (!constants) return;
  constants.SMALL_PADDING = COMPACT_PADDING.SMALL;
  constants.MEDIUM_PADDING = COMPACT_PADDING.MEDIUM;
  constants.LARGE_PADDING = COMPACT_PADDING.LARGE;
  constants.FIELD_BORDER_RECT_X_PADDING = 2;
  constants.FIELD_BORDER_RECT_Y_PADDING = 1;
  constants.FIELD_TEXT_HEIGHT = 14;
  constants.FIELD_TEXT_BASELINE = 11;
  constants.BETWEEN_STATEMENT_PADDING_Y = COMPACT_PADDING.BETWEEN_STATEMENT_Y;
  constants.STATEMENT_BOTTOM_SPACER = COMPACT_PADDING.STATEMENT_BOTTOM;
  constants.STATEMENT_INPUT_PADDING_LEFT = COMPACT_PADDING.STATEMENT_INPUT_LEFT;
  const tabHeight = Number(constants.TAB_HEIGHT ?? 15);
  const tabRoom = tabHeight + 11;
  constants.MIN_BLOCK_HEIGHT = Math.max(24, tabRoom);
  // Assign (do not Math.max with theme): init() inflates dummy/inline mins
  // from TAB_HEIGHT and would keep that extra vertical gap under HEADER.
  constants.DUMMY_INPUT_MIN_HEIGHT = tabRoom;
  constants.EMPTY_INLINE_INPUT_HEIGHT = tabRoom;
}

/**
 * Blockly Drawer.positionStatementInputConnection_ uses
 * `connX = row.xPos + row.statementEdge + notchOffset`.
 * After leftover width is padded on the left, `statementEdge` from
 * computeBounds_ is still the leftover field column. Pin it to the
 * visual C bump so snap/highlight match COMPOSITION.content.
 */
export type StatementRowNotch = {
  xPos?: number;
  width?: number;
  statementEdge?: number;
  getLastInput?: () => { width?: number; notchOffset?: number; xPos?: number } | null | undefined;
};

export function pinStatementRowNotch_(row: StatementRowNotch): number {
  const input = row.getLastInput?.();
  const rowX = Number(row.xPos ?? 0);
  const drawnX = Number(input?.xPos ?? 0);
  // Drawer.drawStatementInput_ uses input.xPos for the visual tooth.
  // `row.width - input.width` is the pre-finalize_ proxy; it collapses to 0
  // when Thrasos stretched the C across the row (mutator STACK, XML document).
  const fromDrawn = drawnX - rowX;
  const fromWidth = Number(row.width ?? 0) - Number(input?.width ?? 0);
  const notchX = fromDrawn > 0 ? fromDrawn : fromWidth;
  row.statementEdge = notchX;
  return notchX;
}

/** True when the render row carries a statement/value mouth (not a dummy HEADER). */
// deno-lint-ignore no-explicit-any
export function isMouthRow_(row: any): boolean {
  return Boolean(row?.hasStatement || row?.hasExternalInput || row?.hasInlineInput);
}

/**
 * Statement and value captions hug their mouths (RIGHT). Class chrome lives
 * on a dummy HEADER (see `ensureClassChromeHeader`). Exported for unit tests.
 */
// deno-lint-ignore no-explicit-any
export function applyOpenEhrRowAlign_(row: any, alignLeft: number, alignRight: number): void {
  if (!row?.elements) return;
  if (row?.hasStatement) {
    row.align = alignRight;
    return;
  }
  if (isMouthRow_(row)) {
    row.align = alignRight;
    return;
  }
  let hasClassChrome = false;
  let hasSlotCaption = false;
  for (const elem of row.elements) {
    const field = elem?.field;
    if (!field) continue;
    if (isSlotLabelField(field)) hasSlotCaption = true;
    if (isSkeletonTitleField(field)) hasClassChrome = true;
    if (isRmTypeEmojiField(field) && field.name === BLOCK_OUT_EMOJI_FIELD) {
      hasClassChrome = true;
    }
    if (field.name === BLOCK_OUT_EMOJI_FIELD) hasClassChrome = true;
    if (field.name === MUTATOR_COG_FIELD) hasClassChrome = true;
  }
  if (hasClassChrome) row.align = alignLeft;
  else if (hasSlotCaption) row.align = alignRight;
}

/**
 * Dummy HEADER leftover goes *before* the cog so the cog sits on the far
 * right. The output-type glyph stays on the left with the title.
 */
export function padBeforeTrailingChrome_(row: {
  elements?: Array<{ field?: { name?: string }; width?: number }>;
}, missingSpace: number): boolean {
  if (!row?.elements || missingSpace <= 0) return false;
  const chromeAt = firstTrailingChromeElementIndex_(row.elements);
  if (chromeAt < 0) return false;
  for (let i = chromeAt - 1; i >= 0; i--) {
    const el = row.elements[i];
    if (el?.field) continue;
    if (typeof el?.width === "number") {
      el.width += missingSpace;
      return true;
    }
  }
  row.elements.splice(chromeAt, 0, { width: missingSpace });
  return true;
}

export function firstTrailingChromeElementIndex_(
  elements: Array<{ field?: { name?: string } }>,
): number {
  for (let i = 0; i < elements.length; i++) {
    if (isTrailingChromeFieldName(elements[i]?.field?.name)) return i;
  }
  return -1;
}

/**
 * Captions on value/statement rows with a tall connected child should sit by
 * the mouth, not at the vertical midpoint of that child. Applies to any field
 * on the row (stock Blockly labels included), not only FieldSlotLabel.
 */
// deno-lint-ignore no-explicit-any
export function shouldPinSlotCaptionToMouth_(row: any, elem: any): boolean {
  if (!row || !elem?.field) return false;
  return isMouthRow_(row);
}

/** Centerline Y for a slot caption pinned to the input mouth / notch. */
// deno-lint-ignore no-explicit-any
export function pinnedSlotCaptionCenterline_(row: any, elem: any, constants: any): number {
  const y = Number(row?.yPos ?? 0);
  if (row?.hasStatement) {
    // Match Zelos: empty statement mouth height, not the connected stack.
    const emptyH = Number(
      constants?.EMPTY_STATEMENT_INPUT_HEIGHT ??
        constants?.MIN_BLOCK_HEIGHT ??
        24,
    );
    const fieldH = Number(elem?.height ?? 0);
    // A 90°-stood caption is taller than the empty C: grow downward from the
    // row top so the glyph stays at the mouth instead of centering mid-child.
    if (fieldH > emptyH) return y + fieldH / 2;
    return y + emptyH / 2;
  }
  // Value socket (inline or external): offset from the top of the row.
  const offset = Number(
    constants?.TALL_INPUT_FIELD_OFFSET_Y ?? constants?.MEDIUM_PADDING ?? 3,
  );
  return y + offset + Number(elem?.height ?? 0) / 2;
}

// deno-lint-ignore no-explicit-any
function isRmEmojiMeasurable(elem: any): boolean {
  return isRmTypeEmojiField(elem?.field ?? null);
}

// deno-lint-ignore no-explicit-any
function isZeroSizeMeasurable(elem: any): boolean {
  return Boolean(elem?.field) && Number(elem?.width ?? 0) === 0 && Number(elem?.height ?? 0) === 0;
}

// deno-lint-ignore no-explicit-any
function isSlotCardMeasurable(elem: any): boolean {
  return isSlotCardinalityField(elem?.field ?? null);
}

// deno-lint-ignore no-explicit-any
function isSlotLabelMeasurable(elem: any): boolean {
  return isSlotLabelField(elem?.field ?? null);
}

/** Field immediately before a statement / external-value mouth. */
// deno-lint-ignore no-explicit-any
function isFieldBeforeMouth_(prev: any, next: any): boolean {
  if (!prev?.field || !next) return false;
  const Types = Blockly.blockRendering?.Types;
  if (!Types) {
    return Boolean(next.input || next.connectedBlock !== undefined || next.connectionOffsetY !== undefined);
  }
  try {
    return Boolean(
      Types.isStatementInput?.(next) ||
        Types.isExternalInput?.(next) ||
        (Types.isInput?.(next) && !Types.isDummyInput?.(next)),
    );
  } catch {
    return Boolean(next.input);
  }
}
