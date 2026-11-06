/**
 * Single left-of-socket caption: `attr [min..max] glyph` with spaces only.
 * Attribute name is hover-underlined / clickable when ehrtslib `spec` (or
 * schema documentation) has help text for that RM attribute.
 */
import type { Field, Input } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { deprecatedRmField } from "../core/rm_deprecation.ts";
import { documentationHelp, rmAttributeHelp } from "../core/spec_help.ts";
import { dismissSpecHelpPopup, showSpecHelpPopup } from "../ui/spec_help_popup.ts";
import {
  connectionPointGlyph,
  isAbstractPlaceholderType,
  isHardToReadRmEmoji,
  rmEmojiFontPx,
  rmTypeConnectionTooltip,
} from "./rm_type_emoji.ts";
import {
  formatSlotCardinality,
  isStrictNarrowing,
  type SlotCardinality,
  OVERLAY_DELTA,
  constraintOverlayHelp,
} from "./slot_cardinality.ts";
import {
  SLOT_OVERLAY_DELTA_FILL,
  SLOT_OVERLAY_RM_FILL,
} from "./block_colours.ts";
import { isStatementInput } from "./mouth_layout.ts";

export const SLOT_LABEL_FIELD_PREFIX = "SLOT_LABEL_";

/** Second line under a deprecated attribute name. */
const DEPRECATED_CAPTION = "deprecated";
const DEPRECATED_FONT_PX = 9;
const DEPRECATED_LINE_PX = 11;

/** Which overlay field-level showEditor_ should open when both could apply. */
export type SlotLabelOverlay = "abstract-tip" | "help" | null;

/**
 * Abstract ⁇ tip wins over attribute/spec help so concrete-implementation
 * lists stay reachable on RM slots that also have BMM documentation.
 */
export function slotLabelOverlayForEditor(options: {
  isAbstractSlot: boolean;
  hasAttrHelp: boolean;
}): SlotLabelOverlay {
  if (options.isAbstractSlot) return "abstract-tip";
  if (options.hasAttrHelp) return "help";
  return null;
}

// deno-lint-ignore no-explicit-any
const FieldLabelBase = Blockly.FieldLabel as any;

export class FieldSlotLabel extends FieldLabelBase {
  readonly isSlotLabelField = true;
  EDITABLE = false;
  SERIALIZABLE = false;
  CURSOR = "default";

  attrLabel = "";
  min = 0;
  max: number | null = 1;
  hasCard = false;
  unmet = false;
  hasOverlay = false;
  rmMin = 0;
  rmMax: number | null = 1;
  private hasRmCard_ = false;
  private rmType_ = "";
  /** Schema property docs when not using openEHR RM attribute tables. */
  private documentation_ = "";
  private attrTspan_: SVGTSpanElement | null = null;
  private glyphElement_: SVGTextElement | null = null;
  private deprecatedEl_: SVGTextElement | null = null;
  /** Extra height under the attribute name when it is a deprecated RM field. */
  private deprecatedLinePx_ = 0;
  private standing_ = false;

  /** Lets block_constraints refresh unmet cardinality on this caption. */
  get isSlotCardinalityField(): boolean {
    return this.hasCard;
  }

  constructor(
    attrLabel: string,
    options: {
      card?: SlotCardinality;
      rmCard?: SlotCardinality;
      rmType?: string;
      documentation?: string;
    } = {},
  ) {
    super("", cssClass(false, false));
    this.attrLabel = attrLabel;
    if (options.card) {
      this.hasCard = true;
      this.min = options.card.min;
      this.max = options.card.max;
    }
    if (options.rmCard) {
      this.hasRmCard_ = true;
      this.rmMin = options.rmCard.min;
      this.rmMax = options.rmCard.max;
    }
    this.rmType_ = options.rmType ?? "";
    this.documentation_ = (options.documentation ?? "").trim();
    this.refreshOverlay_();
    this.refreshText_();
  }

  initView(): void {
    super.initView?.();
    this.updateSize_?.();
  }

  rmType(): string {
    return this.rmType_;
  }

  setCardinality(card: SlotCardinality | undefined): void {
    if (!card) {
      this.hasCard = false;
    } else {
      this.hasCard = true;
      this.min = card.min;
      this.max = card.max;
    }
    this.refreshOverlay_();
    this.refreshText_();
  }

  setRmCardinality(card: SlotCardinality | undefined): void {
    if (!card) {
      this.hasRmCard_ = false;
    } else {
      this.hasRmCard_ = true;
      this.rmMin = card.min;
      this.rmMax = card.max;
    }
    this.refreshOverlay_();
    this.refreshText_();
  }

  overlayHelp(): string {
    if (!this.hasOverlay) return "";
    return constraintOverlayHelp(
      { min: this.rmMin, max: this.rmMax },
      { min: this.min, max: this.max },
    );
  }

  setRmType(rmType: string | undefined): void {
    this.rmType_ = rmType ?? "";
    this.refreshText_();
  }

  setDocumentation(documentation: string | undefined): void {
    this.documentation_ = (documentation ?? "").trim();
    this.refreshText_();
  }

  documentation(): string {
    return this.documentation_;
  }

  /**
   * Spec URL when this caption is a deprecated RM attribute, otherwise null.
   * Inherited attributes count (coded text `hyperlink` is defined on DV_TEXT).
   */
  deprecationHref(): string | null {
    return deprecatedRmField(this.parentRmClass_(), this.attrLabel)?.href ?? null;
  }

  setUnmet(unmet: boolean): void {
    if (this.unmet === unmet) return;
    this.unmet = unmet;
    this.syncClass_();
  }

  showEditor_(): void {
    // Abstract ⁇ and overlay Δ handle their own hover via Blockly tooltip.
    // Field-level showEditor_ used to open the abstract tip for the whole
    // caption, so the hyperlink looked like it had moved.
    if (!this.hasAttrHelp_()) return;
    const help = this.attributeHelp_();
    if (!help) return;
    const anchor = this.attrTspan_ ??
      this.getClickTarget_?.() ??
      this.fieldGroup_;
    if (anchor && "getBoundingClientRect" in anchor) {
      showSpecHelpPopup(anchor as Element, help);
    }
  }

  isClickableInFlyout(): boolean {
    return this.hasAttrHelp_() || this.isAbstractSlot_() || this.hasOverlay;
  }

  private refreshOverlay_(): void {
    this.hasOverlay = Boolean(
      this.hasCard &&
        this.hasRmCard_ &&
        isStrictNarrowing(
          { min: this.rmMin, max: this.rmMax },
          { min: this.min, max: this.max },
        ),
    );
    // Overlay help lives on the Δ / cardinality tspans, not the whole field.
  }

  private isAbstractSlot_(): boolean {
    return Boolean(this.rmType_ && isAbstractPlaceholderType(this.rmType_));
  }

  private parentRmClass_(): string {
    const block = this.getSourceBlock?.();
    if (!block) return "";
    if (block.type === "element") return "ELEMENT";
    return String(block.getFieldValue("RM_TYPE") || "").trim();
  }

  private hasAttrHelp_(): boolean {
    if (this.documentation_) return true;
    const parent = this.parentRmClass_();
    return Boolean(parent && rmAttributeHelp(parent, this.attrLabel));
  }

  private attributeHelp_() {
    if (this.documentation_) {
      return documentationHelp(this.attrLabel, this.documentation_);
    }
    const parent = this.parentRmClass_();
    return parent ? rmAttributeHelp(parent, this.attrLabel) : null;
  }

  private refreshText_(): void {
    const parts = [this.attrLabel];
    if (this.hasOverlay) {
      parts.push(
        OVERLAY_DELTA,
        formatSlotCardinality({ min: this.min, max: this.max }),
        formatSlotCardinality({ min: this.rmMin, max: this.rmMax }),
      );
    } else if (this.hasCard) {
      parts.push(formatSlotCardinality({ min: this.min, max: this.max }));
    }
    const glyph = connectionPointGlyph(this.rmType_ || undefined, true);
    // Abstract ⁇ is drawn as an underlined tspan so only the glyph is linked-looking.
    if (glyph && !this.isAbstractSlot_()) parts.push(glyph);
    this.setValue(parts.join(" "));
    this.CURSOR = this.hasAttrHelp_() || this.isAbstractSlot_() || this.hasOverlay
      ? "pointer"
      : "default";
    this.syncClass_();
    this.updateSize_?.();
  }

  private syncClass_(): void {
    // Do not put --abstract on the whole caption — only the ⁇ tspan is underlined.
    this.setClass?.(cssClass(this.unmet, false));
  }

  updateSize_(): void {
    if (!this.size_) return;
    const abstract = this.isAbstractSlot_();
    const glyph = abstract
      ? (connectionPointGlyph(this.rmType_, true) ?? "")
      : "";
    const card = this.hasCard
      ? formatSlotCardinality({ min: this.min, max: this.max })
      : "";
    const rmCard = this.hasOverlay
      ? formatSlotCardinality({ min: this.rmMin, max: this.rmMax })
      : "";
    const concreteGlyph = !abstract
      ? (connectionPointGlyph(this.rmType_ || undefined, true) ?? "")
      : "";
    const typeGlyph = abstract ? glyph : concreteGlyph;
    const bodyParts = [this.attrLabel];
    if (this.hasOverlay) {
      bodyParts.push(OVERLAY_DELTA, card, rmCard);
    } else if (card) {
      bodyParts.push(card);
    }
    // Caption body stays 12px; only the type glyph may be larger.
    const bodyPx = 12;
    const deprecatedHref = this.deprecationHref();
    this.deprecatedLinePx_ = deprecatedHref ? DEPRECATED_LINE_PX : 0;
    const glyphPx = this.rmType_ && typeGlyph
      ? (abstract
        ? Math.max(bodyPx, Math.round(rmEmojiFontPx(this.rmType_) * 0.75))
        : isHardToReadRmEmoji(this.rmType_)
        ? 13
        : rmEmojiFontPx(this.rmType_))
      : bodyPx;
    const bodyText = bodyParts.join(" ");
    const nameBodyWidth = measureCaptionWidth(bodyText, bodyPx, false);
    const deprecatedWidth = deprecatedHref
      ? measureCaptionWidth(DEPRECATED_CAPTION, DEPRECATED_FONT_PX, false)
      : 0;
    const bodyWidth = Math.max(nameBodyWidth, deprecatedWidth);
    const glyphWidth = typeGlyph
      ? measureCaptionWidth(` ${typeGlyph}`, glyphPx, abstract)
      : 0;
    const childH = connectedChildHeightPx(this);
    const metrics = slotCaptionStandMetrics({
      childHeightPx: childH,
      bodyWidthPx: bodyWidth,
      glyphWidthPx: glyphWidth,
      bodyPx,
      glyphPx: typeGlyph ? glyphPx : bodyPx,
    });
    if (this.deprecatedLinePx_) {
      metrics.height += this.deprecatedLinePx_;
      if (metrics.stand) metrics.width = Math.max(metrics.width, deprecatedWidth);
    }
    this.standing_ = metrics.stand;
    this.size_.width = metrics.width;
    this.size_.height = metrics.height;
    this.fieldGroup_?.classList.toggle("blockly-slot-label--stand", metrics.stand);
    const el = this.textElement_ as SVGTextElement | null;
    if (!el) return;
    el.setAttribute("dominant-baseline", "central");
    el.setAttribute("alignment-baseline", "central");
    el.setAttribute("dy", "0");
    el.style.setProperty("font-size", `${bodyPx}px`, "important");
    if (metrics.stand) {
      // 90° CCW: right-align the string so it packs upward toward the glyph
      // at the top of the field. Statement C-mouths also inset X so letter
      // boxes sit left of the opening.
      const layout = stoodCaptionBodyLayout({
        fieldWidth: metrics.width,
        glyphPx: typeGlyph ? glyphPx : bodyPx,
        bodyPx,
        statementMouth: slotLabelOnStatementMouth(this),
      });
      el.setAttribute("text-anchor", layout.textAnchor);
      el.setAttribute("x", "0");
      el.setAttribute("y", "0");
      el.setAttribute("transform", layout.transform);
    } else {
      el.removeAttribute("transform");
      el.setAttribute("text-anchor", "end");
      el.setAttribute("x", String(slotCaptionBodyEndXPx(metrics.width, glyphWidth)));
      el.setAttribute("y", String(this.captionLineCenterY_()));
    }
    this.rebuildCaption_(
      el,
      card,
      rmCard,
      typeGlyph,
      abstract,
      bodyPx,
      glyphPx,
      metrics.stand,
    );
    this.syncDeprecatedLink_(deprecatedHref, metrics, glyphWidth);
  }

  /** Vertical center of the attribute-name line (the "deprecated" line sits under it). */
  private captionLineCenterY_(): number {
    const height = Number(this.size_?.height ?? 0);
    return (height - this.deprecatedLinePx_) / 2;
  }

  applyColour(): void {
    super.applyColour?.();
    this.copyDeprecatedFill_();
  }

  private syncDeprecatedLink_(
    href: string | null,
    metrics: { stand: boolean; width: number; height: number },
    glyphWidth: number,
  ): void {
    const group = this.fieldGroup_ as SVGGElement | null;
    if (!group || typeof document === "undefined") return;
    if (!href) {
      this.deprecatedEl_?.remove();
      this.deprecatedEl_ = null;
      return;
    }
    const text = this.ensureDeprecatedLink_();
    const anchor = metrics.stand ? "middle" : "end";
    const x = metrics.stand
      ? metrics.width / 2
      : slotCaptionBodyEndXPx(metrics.width, glyphWidth);
    const y = metrics.height - DEPRECATED_LINE_PX / 2;
    text.setAttribute("text-anchor", anchor);
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    const link = text.querySelector("a");
    if (link) {
      link.setAttribute("href", href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      const title = link.querySelector("title");
      if (title) title.textContent = href;
    }
    this.copyDeprecatedFill_();
  }

  private ensureDeprecatedLink_(): SVGTextElement {
    if (this.deprecatedEl_) return this.deprecatedEl_;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "blocklyText blockly-slot-deprecated");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("alignment-baseline", "central");
    text.style.setProperty("font-size", `${DEPRECATED_FONT_PX}px`, "important");
    const link = document.createElementNS("http://www.w3.org/2000/svg", "a");
    link.setAttribute("class", "blockly-slot-deprecated-link");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    link.appendChild(title);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    label.textContent = DEPRECATED_CAPTION;
    label.style.setProperty("font-size", `${DEPRECATED_FONT_PX}px`, "important");
    label.style.setProperty("text-decoration", "underline");
    label.style.setProperty("text-underline-offset", "1px");
    label.style.cursor = "pointer";
    link.appendChild(label);
    const open = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = link.getAttribute("href");
      if (url) globalThis.open(url, "_blank", "noopener,noreferrer");
    };
    link.addEventListener("pointerdown", (event) => event.stopPropagation());
    link.addEventListener("mousedown", (event) => event.stopPropagation());
    link.addEventListener("click", open);
    text.appendChild(link);
    (this.fieldGroup_ as SVGGElement).appendChild(text);
    this.deprecatedEl_ = text;
    return text;
  }

  private copyDeprecatedFill_(): void {
    const fill = (this.textElement_ as SVGTextElement | null)?.getAttribute("fill");
    if (this.deprecatedEl_ && fill) this.deprecatedEl_.setAttribute("fill", fill);
  }

  private rebuildCaption_(
    el: SVGTextElement,
    card: string,
    rmCard: string,
    glyph: string,
    abstractGlyph: boolean,
    bodyPx: number,
    glyphPx: number,
    stand: boolean,
  ): void {
    if (typeof document === "undefined") return;
    while (el.firstChild) el.removeChild(el.firstChild);
    this.attrTspan_ = null;

    const attrHelp = this.hasAttrHelp_();
    if (this.attrLabel) {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute(
        "class",
        attrHelp
          ? "blockly-slot-attr-name blockly-spec-help-target"
          : "blockly-slot-attr-name",
      );
      tspan.setAttribute("dominant-baseline", "central");
      tspan.setAttribute("alignment-baseline", "central");
      tspan.textContent = this.attrLabel;
      tspan.style.setProperty("font-size", `${bodyPx}px`, "important");
      if (this.deprecatedLinePx_) {
        tspan.setAttribute(
          "class",
          `${tspan.getAttribute("class")} blockly-slot-attr-name--deprecated`,
        );
        tspan.style.setProperty("text-decoration", "line-through");
      }
      if (attrHelp) {
        tspan.style.cursor = "pointer";
        // Stop Blockly field mousedown→showEditor_ so attr help does not
        // race the abstract ⁇ tip on the same caption.
        tspan.addEventListener("mousedown", (event) => event.stopPropagation());
        tspan.addEventListener("click", (event) => {
          event.stopPropagation();
          dismissSpecHelpPopup();
          const help = this.attributeHelp_();
          if (help) showSpecHelpPopup(tspan, help);
        });
      }
      el.appendChild(tspan);
      this.attrTspan_ = tspan;
    }
    if (this.hasOverlay && card) {
      appendOverlayTspans(el, this, card, rmCard, bodyPx);
    } else if (card) {
      const cardNode = document.createTextNode(` ${card}`);
      el.appendChild(cardNode);
    }
    this.syncGlyphElement_(glyph, abstractGlyph, glyphPx, stand, bodyPx);
    el.style.setProperty("font-size", `${bodyPx}px`, "important");
  }

  private syncGlyphElement_(
    glyph: string,
    abstractGlyph: boolean,
    glyphPx: number,
    stand: boolean,
    bodyPx: number,
  ): void {
    const group = this.fieldGroup_ as SVGGElement | null;
    if (!group) return;
    if (!glyph) {
      this.glyphElement_?.remove();
      this.glyphElement_ = null;
      return;
    }
    let glyphEl = this.glyphElement_;
    if (!glyphEl) {
      glyphEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      glyphEl.setAttribute("class", "blocklyText");
      group.appendChild(glyphEl);
      this.glyphElement_ = glyphEl;
    }
    glyphEl.setAttribute("dominant-baseline", "central");
    glyphEl.setAttribute("alignment-baseline", "central");
    glyphEl.setAttribute("text-anchor", "start");
    glyphEl.style.setProperty("font-size", `${glyphPx}px`, "important");
    glyphEl.textContent = glyph;
    glyphEl.classList.toggle("blockly-slot-abstract-glyph", abstractGlyph);
    glyphEl.classList.toggle("blockly-slot-type-glyph", !abstractGlyph);
    glyphEl.style.cursor = abstractGlyph ? "help" : "";
    glyphEl.onmousedown = null;
    glyphEl.onclick = null;
    glyphEl.onpointerenter = null;
    const width = Number(this.size_?.width ?? 0);
    if (stand) {
      const pivotX = stoodCaptionPivotXPx(
        width,
        bodyPx,
        slotLabelOnStatementMouth(this),
      );
      const glyphW = measureCaptionWidth(glyph, glyphPx, abstractGlyph);
      glyphEl.setAttribute(
        "x",
        String(Math.max(0, Math.min(width - glyphW, pivotX - glyphW / 2))),
      );
      glyphEl.setAttribute("y", String(Math.max(glyphPx, bodyPx) / 2));
    } else {
      const bodyW = Math.max(0, width - measureCaptionWidth(` ${glyph}`, glyphPx, abstractGlyph));
      glyphEl.setAttribute("x", String(bodyW));
      glyphEl.setAttribute("y", String(this.captionLineCenterY_()));
    }
    const tip = this.rmType_ ? rmTypeConnectionTooltip(this.rmType_) : "";
    bindSlotElementTooltip(glyphEl, tip, "data-rm-type-tip");
  }
}

export function isSlotLabelField(
  field: Field | null | undefined,
): field is FieldSlotLabel {
  return Boolean(field && (field as FieldSlotLabel).isSlotLabelField);
}

/** Gap between stood caption glyphs and the C-mouth (~⅛ em). */
export function stoodCaptionMouthGapPx(bodyPx: number): number {
  return bodyPx / 8;
}

/**
 * X pivot for a 90° CCW stood caption on a statement C-mouth so glyph boxes
 * sit left of the opening with {@link stoodCaptionMouthGapPx} clearance.
 */
export function stoodCaptionTranslateXPx(fieldWidth: number, bodyPx: number): number {
  return fieldWidth - Math.round(bodyPx / 2 + stoodCaptionMouthGapPx(bodyPx));
}

/** Stood-caption X pivot: inset only on statement mouths, not puzzle-tab sockets. */
export function stoodCaptionPivotXPx(
  fieldWidth: number,
  bodyPx: number,
  statementMouth: boolean,
): number {
  return statementMouth
    ? stoodCaptionTranslateXPx(fieldWidth, bodyPx)
    : fieldWidth;
}

/**
 * Right edge of the caption body (where the type glyph starts). Used so the
 * attribute title hugs the glyph even if Blockly stretches the field.
 */
export function slotCaptionBodyEndXPx(fieldWidth: number, glyphWidth: number): number {
  return Math.max(0, fieldWidth - glyphWidth);
}

/**
 * Stood body transform: `text-anchor: end` + origin at the glyph row so the
 * string packs upward toward the ⁇ (right-align after 90° CCW).
 */
export function stoodCaptionBodyLayout(args: {
  fieldWidth: number;
  glyphPx: number;
  bodyPx: number;
  statementMouth: boolean;
}): { textAnchor: "end"; transform: string } {
  const translateX = stoodCaptionPivotXPx(args.fieldWidth, args.bodyPx, args.statementMouth);
  const translateY = Math.max(args.glyphPx, args.bodyPx);
  return {
    textAnchor: "end",
    transform: `translate(${translateX}, ${translateY}) rotate(-90)`,
  };
}

function slotLabelParentInput(field: FieldSlotLabel): Input | null {
  const block = field.getSourceBlock?.();
  if (!block) return null;
  return field.getParentInput?.() ??
    block.inputList.find((row) => row.fieldRow.includes(field)) ?? null;
}

function slotLabelOnStatementMouth(field: FieldSlotLabel): boolean {
  const input = slotLabelParentInput(field);
  return input ? isStatementInput(input) : false;
}

/**
 * Rotate the caption body 90° CCW when the nested child is taller than the
 * horizontal label is wide, so the C-mouth can start further left.
 */
export function slotCaptionStandMetrics(args: {
  childHeightPx: number;
  bodyWidthPx: number;
  glyphWidthPx: number;
  bodyPx: number;
  glyphPx: number;
}): { stand: boolean; width: number; height: number } {
  const horizontalWidth = args.bodyWidthPx + args.glyphWidthPx;
  const stand = args.childHeightPx > horizontalWidth && horizontalWidth > 0;
  if (!stand) {
    return {
      stand: false,
      width: horizontalWidth,
      height: Math.max(14, args.bodyPx, args.glyphPx),
    };
  }
  return {
    stand: true,
    width: Math.max(args.glyphWidthPx, args.bodyPx),
    height: args.glyphPx + args.bodyWidthPx,
  };
}

/**
 * True while a caption refresh has already queued the parent.
 * `renderEfficiently` calls `updateCollapsed` on every collapsed block, and
 * that hook calls this function. `parent.render()` flushes immediately and
 * re-enters measure until the stack overflows; a microtask flush during
 * project restore also persisted a one-block canvas (#194).
 */
let slotCaptionRenderQueued = false;

/**
 * Recalculate slot captions on the parent after a child collapses or expands,
 * so a 90° caption can lie flat again when the child is short (#194).
 * Sizes update immediately. The parent is only queued, so the current measure
 * pass cannot re-enter.
 */
export function refreshParentSlotCaptions(block: {
  getParent?: () => {
    inputList: Array<{ fieldRow: Field[] }>;
    queueRender?: () => void;
  } | null;
}): void {
  const parent = block.getParent?.();
  if (!parent) return;
  for (const input of parent.inputList) {
    for (const field of input.fieldRow) {
      if (isSlotLabelField(field)) field.updateSize_?.();
    }
  }
  const queueRender = parent.queueRender;
  if (typeof queueRender !== "function" || slotCaptionRenderQueued) return;
  slotCaptionRenderQueued = true;
  queueRender.call(parent);
  // queueRender schedules the next frame first. Clear the guard after that
  // frame so the queued render's own updateCollapsed does not queue again.
  const later = typeof globalThis.requestAnimationFrame === "function"
    ? (fn: () => void) => globalThis.requestAnimationFrame(fn)
    : (fn: () => void) => queueMicrotask(fn);
  later(() => {
    slotCaptionRenderQueued = false;
  });
}

function connectedChildHeightPx(field: FieldSlotLabel): number {
  const block = field.getSourceBlock?.();
  if (!block) return 0;
  const input = field.getParentInput?.() ??
    block.inputList.find((row) => row.fieldRow.includes(field));
  const child = input?.connection?.targetBlock();
  if (!child) return 0;
  if (typeof child.isShadow === "function" && child.isShadow()) return 0;
  return Number(child.getHeightWidth?.()?.height ?? 0);
}

export function slotLabelFieldName(inputName: string): string {
  return `${SLOT_LABEL_FIELD_PREFIX}${inputName}`;
}

/**
 * One caption field left of the socket (name + optional card + type glyph).
 * Updates in place when cardinality or allowed RM type changes.
 */
export function appendSlotLabel(
  input: Input,
  attrLabel: string,
  options: {
    card?: SlotCardinality;
    rmCard?: SlotCardinality;
    rmType?: string;
    documentation?: string;
  } = {},
): void {
  const name = slotLabelFieldName(input.name);
  const existing = input.fieldRow.find((field) => field.name === name);
  if (existing && isSlotLabelField(existing)) {
    existing.attrLabel = attrLabel;
    existing.setCardinality(options.card);
    existing.setRmCardinality(options.rmCard);
    existing.setRmType(options.rmType);
    existing.setDocumentation(options.documentation);
    return;
  }
  // Replace split name / card / emoji fields with one overlay caption.
  for (const field of [...input.fieldRow]) {
    const fname = String(field.name ?? "");
    if (
      fname.startsWith("SLOT_CARD_") ||
      fname.startsWith("SLOT_EMOJI_") ||
      fname === name
    ) {
      try {
        input.removeField(fname, true);
      } catch {
        // Field already gone.
      }
    }
  }
  input.appendField(new FieldSlotLabel(attrLabel, options), name);
}

function cssClass(unmet: boolean, abstractSlot: boolean): string {
  const parts = ["blockly-slot-label"];
  if (unmet) parts.push("blockly-slot-label--unmet");
  if (abstractSlot) parts.push("blockly-slot-label--abstract");
  return parts.join(" ");
}

function bindSlotElementTooltip(
  el: Element,
  text: string,
  attr: "data-rm-type-tip" | "data-constraint-overlay-tip",
): void {
  const bound = el as Element & { mouseOverWrapper_?: unknown; tooltip?: string };
  if (bound.mouseOverWrapper_) {
    try {
      Blockly.Tooltip?.unbindMouseEvents?.(el);
    } catch {
      // First bind, or a Blockly build without wrappers.
    }
  }
  if (!text) {
    el.removeAttribute(attr);
    bound.tooltip = "";
    return;
  }
  el.setAttribute(attr, text);
  bound.tooltip = text;
  // Blockly Field.bindMouseEvents uses currentTarget=fieldGroup, which
  // would steal hover from the glyph/overlay. Stop bubbling so the
  // element-local tooltip wins.
  if (!(el as Element & { _slotTipStop?: boolean })._slotTipStop) {
    (el as Element & { _slotTipStop?: boolean })._slotTipStop = true;
    el.addEventListener("pointerover", (event) => event.stopPropagation());
    el.addEventListener("pointerout", (event) => event.stopPropagation());
    el.addEventListener("pointermove", (event) => event.stopPropagation());
  }
  Blockly.Tooltip?.bindMouseEvents?.(el);
}

function appendOverlayTspans(
  el: SVGTextElement,
  field: FieldSlotLabel,
  effective: string,
  rm: string,
  bodyPx: number,
): void {
  const help = field.overlayHelp();
  const add = (className: string, text: string, leadingSpace: boolean): void => {
    if (leadingSpace) el.appendChild(document.createTextNode(" "));
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tspan.setAttribute("class", className);
    tspan.textContent = text;
    tspan.style.setProperty("font-size", `${bodyPx}px`, "important");
    tspan.style.setProperty(
      "fill",
      className === "blockly-slot-overlay-rm"
        ? SLOT_OVERLAY_RM_FILL
        : SLOT_OVERLAY_DELTA_FILL,
    );
    if (help) {
      bindSlotElementTooltip(tspan, help, "data-constraint-overlay-tip");
      tspan.style.cursor = "help";
    }
    el.appendChild(tspan);
  };
  add("blockly-slot-overlay-delta", OVERLAY_DELTA, true);
  add("blockly-slot-overlay-effective", effective, true);
  add("blockly-slot-overlay-rm", rm, true);
}

let measureCanvas: HTMLCanvasElement | null = null;

function measureCaptionWidth(text: string, fontPx: number, abstract: boolean): number {
  if (!text) return 0;
  const family = abstract
    ? '"Google Sans", "Segoe UI", sans-serif'
    : '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Google Sans", sans-serif';
  if (typeof document !== "undefined") {
    try {
      measureCanvas ??= document.createElement("canvas");
      const ctx = measureCanvas.getContext("2d");
      if (ctx) {
        ctx.font = `${fontPx}px ${family}`;
        const w = ctx.measureText(text).width;
        if (w > 0) return Math.ceil(w) + 2;
      }
    } catch {
      // Headless fallthrough.
    }
  }
  return Math.ceil(fontPx * 0.55 * text.length) + 2;
}
