/**
 * Blockly mutator with a per-option flyout (no attribute dropdown) and a
 * header cogwheel field to the right of the skeleton title.
 */
import type { Block, BlockSvg, Input } from "blockly/core";
import { DEPRECATED_ATTR_CLASS, deprecatedRmField } from "../core/rm_deprecation.ts";
import { Blockly } from "./blockly_core.ts";
import { detectLocale, msg } from "./i18n/locale.ts";
import {
  enforceMouthCaptionLayout,
  ensureClassChromeHeader,
  MUTATOR_COG_FIELD,
  mutatorChromeHost,
  orderHeaderTrailingChrome,
  relocateTrailingChromeToHost,
} from "./mouth_layout.ts";

const MutatorIcon = Blockly.icons.MutatorIcon;

/** Minimal flyout block JSON for MutatorIcon mini-workspace toolboxes. */
export type MutatorFlyoutBlock = {
  kind: "block";
  type: string;
  extraState?: { attr: string; label: string };
};

/** Blockly-style mutator badge: rounded square + white gear (matches `.blocklyIconShape`). */
export const COGWHEEL_SVG = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<rect class="blocklyIconShape" rx="4" ry="4" width="16" height="16" fill="#5b80a5" stroke="#ffffff" stroke-width="1"/>` +
    `<path fill="#ffffff" d="m4.2,7.3 0,1.37 -0.92,0.68 -0.11,0.41 0.9,1.56 0.41,0.11 1.04,-0.46 1.19,0.68 0.13,1.14 0.3,0.3 1.8,0 0.3,-0.3 0.13,-1.14 1.18,-0.68 1.05,0.46 0.41,-0.11 0.9,-1.56 -0.11,-0.41 -0.92,-0.68 0,-1.37 0.92,-0.68 0.11,-0.41 -0.9,-1.56 -0.41,-0.11 -1.05,0.46 -1.18,-0.68 -0.13,-1.14 -0.3,-0.3 -1.8,0 -0.3,0.3 -0.13,1.14 -1.19,0.68 -1.04,-0.46 -0.41,0.11 -0.9,1.56 0.11,0.41z"/>` +
    `<circle fill="#5b80a5" cx="8" cy="8" r="2.2"/>` +
    `<circle fill="#ffffff" cx="8" cy="8" r="1.15"/>` +
    `</svg>`,
);

export function appendMutatorCogwheel(
  header: { appendField: (field: unknown, name?: string) => unknown },
): void {
  header.appendField(
    new Blockly.FieldImage(
      COGWHEEL_SVG,
      16,
      16,
      "Optional attributes…",
      function (this: { getSourceBlock: () => BlockSvg }) {
        const block = this.getSourceBlock();
        if (block) openBlockMutator(block);
      },
    ),
    MUTATOR_COG_FIELD,
  );
}

/** Dummy row that receives the header cog: HEADER, else the NAME row (Functions). */
export function mutatorCogHost(block: Block): Input {
  return mutatorChromeHost(block);
}

/**
 * Header cogwheel used by RM / maps / stock MutatorIcon blocks.
 * Keeps the MutatorIcon for the bubble, but hides Blockly's default top-left badge.
 */
export function ensureHeaderMutatorCog(block: Block): void {
  const host = mutatorCogHost(block);
  relocateTrailingChromeToHost(block, host);
  if (!block.getField(MUTATOR_COG_FIELD)) appendMutatorCogwheel(host);
  hideDefaultMutatorIcon(block);
  orderHeaderTrailingChrome(block);
}

/** Hide Blockly's default top-left mutator icon; the header cogwheel replaces it. */
export function hideDefaultMutatorIcon(block: Blockly.Block): void {
  const svg = block as BlockSvg;
  const apply = () => {
    const MutatorIconType = Blockly.icons?.MutatorIcon?.TYPE;
    const hide = (icon: { svgRoot?: SVGElement } | null | undefined) => {
      if (icon?.svgRoot) icon.svgRoot.style.display = "none";
    };
    if (MutatorIconType) hide(svg.getIcon?.(MutatorIconType));
    for (const icon of svg.getIcons?.() ?? []) {
      const type = String(icon.getType?.() ?? "");
      if (type.includes("mutator")) hide(icon);
    }
  };
  if (svg.rendered) {
    apply();
    return;
  }
  const workspace = svg.workspace;
  if (!workspace) return;
  const listener = (event: { blockId?: string }) => {
    if (event.blockId !== svg.id || !svg.rendered) return;
    apply();
    workspace.removeChangeListener(listener);
  };
  workspace.addChangeListener(listener);
}

export function openBlockMutator(block: Blockly.Block): void {
  const MutatorIconType = Blockly.icons?.MutatorIcon?.TYPE;
  const svg = block as BlockSvg;
  const icon = MutatorIconType ? svg.getIcon?.(MutatorIconType) : null;
  if (icon) {
    const isVisible = typeof icon.bubbleIsVisible === "function"
      ? icon.bubbleIsVisible()
      : Boolean((icon as unknown as { miniWorkspaceBubble?: unknown; bubble?: unknown }).miniWorkspaceBubble ?? (icon as unknown as { bubble?: unknown }).bubble);
    void icon.setBubbleVisible(!isVisible);
    return;
  }
  for (const candidate of svg.getIcons?.() ?? []) {
    const isVisible = typeof candidate.bubbleIsVisible === "function"
      ? candidate.bubbleIsVisible()
      : Boolean((candidate as unknown as { miniWorkspaceBubble?: unknown; bubble?: unknown }).miniWorkspaceBubble ?? (candidate as unknown as { bubble?: unknown }).bubble);
    candidate.setBubbleVisible?.(!isVisible);
  }
}

export function getCogwheelAnchorLocation(sourceBlock: BlockSvg): Blockly.utils.Coordinate {
  const blockOrigin = sourceBlock.getRelativeToSurfaceXY();
  const cogField = sourceBlock.getField(MUTATOR_COG_FIELD) as Blockly.FieldImage | null;
  if (!cogField) return blockOrigin;

  const fieldSvg = cogField.getSvgRoot?.();
  const blockSvg = sourceBlock.getSvgRoot?.();
  if (fieldSvg && blockSvg) {
    const fromScreen = offsetFromBlockSvg(fieldSvg, blockSvg, sourceBlock);
    if (fromScreen) {
      const size = cogField.getSize?.() ?? { width: 16, height: 16 };
      return new Blockly.utils.Coordinate(
        blockOrigin.x + fromScreen.x + Number(size.width ?? 16) / 2,
        blockOrigin.y + fromScreen.y + Number(size.height ?? 16) / 2,
      );
    }
  }
  const dimensions = sourceBlock.getHeightWidth?.();
  if (dimensions) {
    return new Blockly.utils.Coordinate(
      blockOrigin.x + Math.max(16, dimensions.width - 18),
      blockOrigin.y + 12,
    );
  }
  return blockOrigin;
}

/** Field offset inside the block SVG (accumulates parent transforms). */
function offsetFromBlockSvg(
  fieldSvg: SVGElement,
  blockSvg: SVGElement,
  sourceBlock: BlockSvg,
): { x: number; y: number } | null {
  if (typeof fieldSvg.getBoundingClientRect === "function" &&
    typeof blockSvg.getBoundingClientRect === "function"
  ) {
    const fieldBox = fieldSvg.getBoundingClientRect();
    const blockBox = blockSvg.getBoundingClientRect();
    if (fieldBox.width > 0 && blockBox.width > 0) {
      const scale = (sourceBlock.workspace as { scale?: number } | undefined)?.scale ?? 1;
      return {
        x: (fieldBox.left - blockBox.left) / scale,
        y: (fieldBox.top - blockBox.top) / scale,
      };
    }
  }
  const getRel = Blockly.utils?.svgMath?.getRelativeXY;
  if (!getRel) return null;
  try {
    let x = 0;
    let y = 0;
    let node: Element | null = fieldSvg;
    while (node && node !== blockSvg) {
      const rel = getRel(node);
      x += Number(rel?.x ?? 0);
      y += Number(rel?.y ?? 0);
      node = node.parentElement;
    }
    return { x, y };
  } catch {
    return null;
  }
}

function pinMutatorIconToHeaderCog(block: Block): void {
  const svg = block as BlockSvg;
  const MutatorIconType = Blockly.icons?.MutatorIcon?.TYPE;
  const icon = MutatorIconType ? svg.getIcon?.(MutatorIconType) : null;
  if (!icon) return;
  (icon as { getAnchorLocation?: () => Blockly.utils.Coordinate }).getAnchorLocation = () =>
    getCogwheelAnchorLocation(svg);
}

type FlyoutProvider = (
  block: BlockSvg,
  stackNames: string[],
) => MutatorFlyoutBlock[];

function readMutatorStackNames(
  icon: MutatorIcon,
  fallback: string[],
): string[] {
  const root = (icon as unknown as { rootBlock?: Blockly.Block }).rootBlock;
  if (root) return namesFromMutatorStack(root);
  return fallback;
}

export function namesFromMutatorStack(container: Blockly.Block): string[] {
  const names: string[] = [];
  let item: Blockly.Block | null = container.getInputTargetBlock("STACK");
  while (item) {
    if (!item.isInsertionMarker()) {
      const name = String(item.getFieldValue("ATTR") || "");
      if (name && name !== "(none)" && !names.includes(name)) names.push(name);
    }
    item = item.getNextBlock();
  }
  return names;
}

function refreshMutatorFlyout(
  icon: DynamicFlyoutMutatorIcon,
  contentsFor: FlyoutProvider,
): void {
  const mini = icon.getWorkspace?.();
  const flyout = mini?.getFlyout?.();
  if (!flyout) return;
  const block = icon.sourceBlock as BlockSvg;
  const extras = (block as BlockSvg & { extraInputs_?: string[] }).extraInputs_ ??
    (block as BlockSvg & { extraDvFields_?: string[] }).extraDvFields_ ??
    [];
  const stackNames = readMutatorStackNames(icon, extras);
  const contents = contentsFor(block, stackNames);
  // Tighten vertical gaps between flyout option blocks (Blockly default ~24).
  const gapHost = flyout as unknown as { GAP_Y?: number; gap_?: number };
  if (typeof gapHost.GAP_Y === "number") gapHost.GAP_Y = 6;
  if (typeof gapHost.gap_ === "number") gapHost.gap_ = 6;
  flyout.show(contents);
  markDeprecatedMutatorLabels(flyoutWorkspace(flyout), rmClassOfBlock(block));
}

function flyoutWorkspace(
  flyout: { workspace_?: { getAllBlocks?: (ordered: boolean) => Block[] } },
): { getAllBlocks: (ordered: boolean) => Block[] } | null {
  const ws = flyout.workspace_;
  if (!ws || typeof ws.getAllBlocks !== "function") return null;
  return ws as { getAllBlocks: (ordered: boolean) => Block[] };
}

function rmClassOfBlock(block: Block | undefined): string {
  if (!block) return "";
  if (block.type === "element") return "ELEMENT";
  return String(block.getFieldValue("RM_TYPE") || block.type || "").toUpperCase();
}

/** Strike deprecated attribute names in the cogwheel bubble (flyout and stack). */
export function markDeprecatedMutatorLabels(
  workspace: { getAllBlocks: (ordered: boolean) => Block[] } | null | undefined,
  parentRmType: string,
): void {
  if (!workspace || !parentRmType) return;
  for (const block of workspace.getAllBlocks(false)) {
    const attr = String(block.getFieldValue("ATTR") || "");
    if (!attr || !deprecatedRmField(parentRmType, attr)) continue;
    const field = block.getField("LABEL") as (Blockly.Field & {
      getTextElement?: () => Element | null;
      textElement_?: Element | null;
      setTooltip?: (tip: string) => void;
    }) | null;
    const text = field?.getTextElement?.() ?? field?.textElement_ ?? null;
    text?.classList.add(DEPRECATED_ATTR_CLASS);
    field?.setTooltip?.("Deprecated");
  }
}

export function autoSizeMutatorBubble(
  bubble: {
    getWorkspace?: () => import("blockly/core").WorkspaceSvg;
    miniWorkspace?: import("blockly/core").WorkspaceSvg;
    setSize?: (size: Blockly.utils.Size, relayout?: boolean) => void;
    setBubbleSize?: (width: number, height: number) => void;
    getSize?: () => { width: number; height: number };
  },
  sourceBlock?: BlockSvg,
): void {
  const mini = bubble.getWorkspace?.() ?? bubble.miniWorkspace;
  if (!mini) return;

  const flyout = mini.getFlyout?.();
  let flyoutWidth = 0;
  let flyoutHeight = 0;

  if (flyout) {
    const gapHost = flyout as unknown as { GAP_Y?: number };
    if (typeof gapHost.GAP_Y === "number") gapHost.GAP_Y = 6;
    flyoutWidth = flyout.getWidth?.() ?? 0;
    const flyoutWs = (flyout as unknown as { workspace_?: import("blockly/core").WorkspaceSvg }).workspace_;
    if (flyoutWs) {
      const box = flyoutWs.getBlocksBoundingBox?.();
      if (box && Number.isFinite(box.bottom) && Number.isFinite(box.top)) {
        flyoutHeight = Math.max(flyoutHeight, box.bottom - box.top + 16);
        flyoutWidth = Math.max(flyoutWidth, box.right - box.left + 16);
      }
      const blocks = flyoutWs.getTopBlocks?.(false) ?? [];
      let calculatedFlyoutHeight = 12;
      for (const b of blocks) {
        const hw = b.getHeightWidth?.();
        if (hw) {
          calculatedFlyoutHeight += hw.height + 6;
          flyoutWidth = Math.max(flyoutWidth, hw.width + 20);
        }
      }
      flyoutHeight = Math.max(flyoutHeight, calculatedFlyoutHeight);
    }
  }

  let wsWidth = 120;
  let wsHeight = 72;
  const wsBox = mini.getBlocksBoundingBox?.();
  if (wsBox && Number.isFinite(wsBox.bottom) && Number.isFinite(wsBox.top)) {
    wsWidth = Math.max(wsWidth, wsBox.right - wsBox.left + 24);
    wsHeight = Math.max(wsHeight, wsBox.bottom - wsBox.top + 24);
  }
  const topBlocks = mini.getTopBlocks?.(false) ?? [];
  for (const b of topBlocks) {
    const hw = b.getHeightWidth?.();
    if (hw) {
      wsWidth = Math.max(wsWidth, hw.width + 28);
      wsHeight = Math.max(wsHeight, hw.height + 28);
    }
  }

  const desiredWidth = Math.max(280, flyoutWidth + wsWidth + 36);
  const desiredHeight = Math.max(140, Math.max(flyoutHeight, wsHeight) + 24);

  const parentSvg = sourceBlock?.workspace ? (sourceBlock.workspace as import("blockly/core").WorkspaceSvg).getParentSvg?.() : null;
  const maxAvailableWidth = parentSvg?.clientWidth ? parentSvg.clientWidth - 40 : 1600;
  const maxAvailableHeight = parentSvg?.clientHeight ? parentSvg.clientHeight - 40 : 1000;

  const targetWidth = Math.round(Math.min(desiredWidth, maxAvailableWidth));
  const targetHeight = Math.round(Math.min(desiredHeight, maxAvailableHeight));

  const SizeClass = Blockly.utils?.Size ?? class { constructor(public width: number, public height: number) {} };
  const targetSize = new SizeClass(targetWidth, targetHeight);

  if (typeof bubble.setSize === "function") {
    bubble.setSize(targetSize as unknown as Blockly.utils.Size, true);
  }
  if (typeof bubble.setBubbleSize === "function") {
    bubble.setBubbleSize(targetWidth, targetHeight);
  }
  markDeprecatedMutatorLabels(mini, rmClassOfBlock(sourceBlock));
  if (flyout) markDeprecatedMutatorLabels(flyoutWorkspace(flyout), rmClassOfBlock(sourceBlock));
}

export class DynamicFlyoutMutatorIcon extends MutatorIcon {
  private flyoutRefreshListener: ((event: unknown) => void) | null = null;
  private outsideClickListener: ((event: PointerEvent) => void) | null = null;
  private closeButtonSvg: SVGGElement | null = null;
  private closeButtonResizeListener: (() => void) | null = null;

  constructor(
    sourceBlock: BlockSvg,
    private readonly contentsFor: FlyoutProvider,
    private readonly stackFallback: () => string[],
  ) {
    super([], sourceBlock);
    (this as unknown as Record<string, unknown>).getAnchorLocation = () => {
      return getCogwheelAnchorLocation(this.sourceBlock as BlockSvg);
    };
  }

  // @ts-ignore override private method
  override getAnchorLocation(): Blockly.utils.Coordinate {
    return getCogwheelAnchorLocation(this.sourceBlock as BlockSvg);
  }

  /**
   * Header cogwheel is the visible control. A non-zero mutator icon size
   * indents the class emoji/title away from the top-left corner.
   */
  override getSize(): Blockly.utils.Size {
    const Size = Blockly.utils?.Size;
    if (Size) return new Size(0, 0);
    return { width: 0, height: 0 } as Blockly.utils.Size;
  }

  override setBubbleVisible(visible: boolean): Promise<void> {
    const block = this.sourceBlock as BlockSvg;
    const self = this as unknown as Record<string, unknown>;
    self.getMiniWorkspaceConfig = () => {
      const stackNames = readMutatorStackNames(this, this.stackFallback());
      const contents = this.contentsFor(block, stackNames);
      return {
        disable: false,
        media: block.workspace.options.pathToMedia,
        rtl: block.RTL,
        renderer: block.workspace.options.renderer,
        rendererOverrides: block.workspace.options.rendererOverrides ?? undefined,
        ...(contents.length
          ? { toolbox: { kind: "flyoutToolbox" as const, contents } }
          : {}),
      };
    };
    return super.setBubbleVisible(visible).then(() => {
      const mini = this.getWorkspace?.();
      const bubble = (this as unknown as {
        miniWorkspaceBubble?: {
          getSvgRoot?: () => SVGGElement;
          svgRoot?: SVGGElement;
          getSize?: () => { width: number; height: number };
          setSize?: (size: Blockly.utils.Size, relayout?: boolean) => void;
          setBubbleSize?: (width: number, height: number) => void;
          getWorkspace?: () => import("blockly/core").WorkspaceSvg;
          miniWorkspace?: import("blockly/core").WorkspaceSvg;
        };
        bubble?: {
          getSvgRoot?: () => SVGGElement;
          svgRoot?: SVGGElement;
          getSize?: () => { width: number; height: number };
          setSize?: (size: Blockly.utils.Size, relayout?: boolean) => void;
          setBubbleSize?: (width: number, height: number) => void;
          getWorkspace?: () => import("blockly/core").WorkspaceSvg;
          miniWorkspace?: import("blockly/core").WorkspaceSvg;
        };
      }).miniWorkspaceBubble ?? (this as unknown as {
        bubble?: {
          getSvgRoot?: () => SVGGElement;
          svgRoot?: SVGGElement;
          getSize?: () => { width: number; height: number };
          setSize?: (size: Blockly.utils.Size, relayout?: boolean) => void;
          setBubbleSize?: (width: number, height: number) => void;
          getWorkspace?: () => import("blockly/core").WorkspaceSvg;
          miniWorkspace?: import("blockly/core").WorkspaceSvg;
        };
      }).bubble;

      if (visible && mini && bubble) {
        this.flyoutRefreshListener = () => {
          refreshMutatorFlyout(this, this.contentsFor);
          autoSizeMutatorBubble(bubble, block);
        };
        mini.addChangeListener(this.flyoutRefreshListener);
        refreshMutatorFlyout(this, this.contentsFor);

        autoSizeMutatorBubble(bubble, block);
        setTimeout(() => autoSizeMutatorBubble(bubble, block), 50);

        this.installCloseButton(bubble);
        this.installOutsideClickListener(bubble);
      } else {
        if (this.flyoutRefreshListener && mini) {
          mini.removeChangeListener(this.flyoutRefreshListener);
          this.flyoutRefreshListener = null;
        }
        this.cleanupCloseButton();
        this.cleanupOutsideClickListener();
      }
    });
  }

  private installCloseButton(bubble: {
    getSvgRoot?: () => SVGGElement;
    svgRoot?: SVGGElement;
    getSize?: () => { width: number; height: number };
    setSize?: (size: Blockly.utils.Size, relayout?: boolean) => void;
    setBubbleSize?: (width: number, height: number) => void;
    getWorkspace?: () => import("blockly/core").WorkspaceSvg;
    miniWorkspace?: import("blockly/core").WorkspaceSvg;
  }): void {
    this.cleanupCloseButton();
    const bubbleSvg = bubble.getSvgRoot?.() ?? bubble.svgRoot;
    if (!bubbleSvg || typeof document === "undefined") return;

    const btn = document.createElementNS("http://www.w3.org/2000/svg", "g");
    btn.setAttribute("class", "intehrgrator-bubble-close-btn");
    btn.style.cursor = "pointer";
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", msg(detectLocale()).CLOSE);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "0");
    circle.setAttribute("cy", "0");
    circle.setAttribute("r", "10");
    circle.setAttribute("fill", "#ffffff");
    circle.setAttribute("stroke", "#dadce0");
    circle.setAttribute("stroke-width", "1.5");

    const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
    cross.setAttribute("d", "M -4 -4 L 4 4 M -4 4 L 4 -4");
    cross.setAttribute("stroke", "#5f6368");
    cross.setAttribute("stroke-width", "1.8");
    cross.setAttribute("stroke-linecap", "round");

    btn.appendChild(circle);
    btn.appendChild(cross);

    const updatePosition = () => {
      const size = bubble.getSize?.() ?? { width: 300, height: 200 };
      btn.setAttribute("transform", `translate(${size.width - 16}, 16)`);
    };

    updatePosition();

    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      void this.setBubbleVisible(false);
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      void this.setBubbleVisible(false);
    });

    bubbleSvg.appendChild(btn);
    this.closeButtonSvg = btn;

    const mini = this.getWorkspace?.();
    if (mini) {
      this.closeButtonResizeListener = () => {
        autoSizeMutatorBubble(bubble, this.sourceBlock as BlockSvg);
        updatePosition();
      };
      mini.addChangeListener(this.closeButtonResizeListener);
    }
  }

  private cleanupCloseButton(): void {
    if (this.closeButtonSvg) {
      this.closeButtonSvg.remove();
      this.closeButtonSvg = null;
    }
    if (this.closeButtonResizeListener) {
      const mini = this.getWorkspace?.();
      if (mini) {
        mini.removeChangeListener(this.closeButtonResizeListener);
      }
      this.closeButtonResizeListener = null;
    }
  }

  private installOutsideClickListener(bubble: {
    getSvgRoot?: () => SVGGElement;
    svgRoot?: SVGGElement;
  }): void {
    this.cleanupOutsideClickListener();
    if (typeof document === "undefined") return;

    const block = this.sourceBlock as BlockSvg;
    this.outsideClickListener = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const bubbleSvg = bubble.getSvgRoot?.() ?? bubble.svgRoot;
      if (bubbleSvg && bubbleSvg.contains(target)) return;

      const cogField = block.getField(MUTATOR_COG_FIELD) as Blockly.FieldImage | null;
      const cogSvg = cogField?.getSvgRoot?.();
      if (cogSvg && cogSvg.contains(target)) return;

      if (target instanceof Element && target.closest(".blocklyDropDownDiv, .blocklyWidgetDiv, .blocklyFlyout")) {
        return;
      }

      void this.setBubbleVisible(false);
    };

    setTimeout(() => {
      if (this.outsideClickListener && this.bubbleIsVisible()) {
        document.addEventListener("pointerdown", this.outsideClickListener, true);
      }
    }, 0);
  }

  private cleanupOutsideClickListener(): void {
    if (this.outsideClickListener && typeof document !== "undefined") {
      document.removeEventListener("pointerdown", this.outsideClickListener, true);
      this.outsideClickListener = null;
    }
  }

  override dispose(): void {
    this.cleanupCloseButton();
    this.cleanupOutsideClickListener();
    super.dispose();
  }
}

export function registerDynamicFlyoutMutator(
  name: string,
  mixin: Blockly.Mutator & Record<string, unknown>,
  helper: (this: Blockly.Block) => void,
  contentsFor: FlyoutProvider,
  stackFallback: (block: BlockSvg) => string[],
): void {
  Blockly.Extensions.register(name, function (this: Blockly.Block) {
    this.mixin(mixin);
    helper.apply(this);
    const blockSvg = this as BlockSvg;
    this.setMutator(
      new DynamicFlyoutMutatorIcon(
        blockSvg,
        contentsFor,
        () => stackFallback(blockSvg),
      ),
    );
    hideDefaultMutatorIcon(this);
    orderHeaderTrailingChrome(this);
  });
}

const STOCK_MUTATOR_TITLE_TYPES = new Set(["text_join", "lists_create_with"]);
/** type → current wrapped `init` (re-wrap when register* replaces the definition). */
const chromeWrappedInit = new Map<string, (this: Block) => void>();
const chromeWrappedMethods = new Map<string, unknown>();
let mutatorIconPatched = false;
let setMutatorFlagPatched = false;

/** Canvas blocks that own a MutatorIcon / decompose (not flyout quark items). */
export function blockHasMutator(block: Block): boolean {
  if ((block as { hasMutatorIcon_?: boolean }).hasMutatorIcon_) return true;
  const MutatorIconType = Blockly.icons?.MutatorIcon?.TYPE;
  const svg = block as BlockSvg;
  if (MutatorIconType && svg.getIcon?.(MutatorIconType)) return true;
  return typeof (block as { decompose?: unknown }).decompose === "function";
}

/**
 * Stock `text_join` / `lists_create_with` put the title on EMPTY or ADD0.
 * Move those labels onto HEADER so the cog and type glyph can sit far right
 * on the same row instead of on a leftover icon-only dummy above the title.
 */
export function promoteStockMutatorTitle(block: Block): void {
  if (!STOCK_MUTATOR_TITLE_TYPES.has(block.type)) return;
  const header = ensureClassChromeHeader(block);
  const steal = (inputName: string): void => {
    const input = block.getInput(inputName);
    if (!input) return;
    const keep = new Set([MUTATOR_COG_FIELD, "RM_OUT_EMOJI"]);
    const movable = input.fieldRow.filter((field) => {
      const name = field.name ?? "";
      if (keep.has(name)) return false;
      if (name.startsWith("SLOT_EMOJI")) return false;
      return true;
    });
    for (const field of movable) {
      const idx = input.fieldRow.indexOf(field);
      if (idx < 0) continue;
      input.fieldRow.splice(idx, 1);
      const cogAt = header.fieldRow.findIndex((item) => item.name === MUTATOR_COG_FIELD);
      if (cogAt >= 0) header.fieldRow.splice(cogAt, 0, field);
      else header.fieldRow.push(field);
    }
    if (inputName === "EMPTY" && input.fieldRow.length === 0 && !input.connection) {
      block.removeInput("EMPTY", true);
    }
  };
  steal("EMPTY");
  steal("ADD0");
}

/** Patch stock MutatorIcon so the bubble anchors on MUTATOR_COG and takes no top-left slot. */
export function patchMutatorIconAnchor(): void {
  patchSetMutatorFlag();
  const Icon = Blockly.icons?.MutatorIcon;
  if (!Icon?.prototype || mutatorIconPatched) return;
  mutatorIconPatched = true;
  const originalGetSize = Icon.prototype.getSize;
  Icon.prototype.getSize = function (this: { sourceBlock?: Block }) {
    if (this.sourceBlock?.getField?.(MUTATOR_COG_FIELD)) {
      const Size = Blockly.utils?.Size;
      return Size ? new Size(0, 0) : { width: 0, height: 0 };
    }
    return originalGetSize.call(this);
  };
  const originalAnchor = Icon.prototype.getAnchorLocation;
  Icon.prototype.getAnchorLocation = function (this: { sourceBlock?: BlockSvg }) {
    if (this.sourceBlock?.getField?.(MUTATOR_COG_FIELD)) {
      return getCogwheelAnchorLocation(this.sourceBlock);
    }
    return originalAnchor.call(this);
  };
}

function patchSetMutatorFlag(): void {
  const proto = Blockly.Block?.prototype;
  if (!proto?.setMutator || setMutatorFlagPatched) return;
  setMutatorFlagPatched = true;
  const original = proto.setMutator;
  proto.setMutator = function (this: Block, mutator: unknown) {
    (this as { hasMutatorIcon_?: boolean }).hasMutatorIcon_ = true;
    const result = original.call(this, mutator);
    pinMutatorIconToHeaderCog(this);
    return result;
  };
}

function afterMutatorBlockInit(block: Block): void {
  if (blockHasMutator(block)) {
    ensureHeaderMutatorCog(block);
    promoteStockMutatorTitle(block);
    enforceMouthCaptionLayout(block);
  }
  orderHeaderTrailingChrome(block);
  hideDefaultMutatorIcon(block);
  pinMutatorIconToHeaderCog(block);
}

/**
 * After every block type is registered: output glyph on the left, header cog
 * far right, bubble anchored on the cog, default top-left MutatorIcon hidden.
 * Safe to call again when a register* function replaces `Blockly.Blocks[type]`.
 */
export function installHeaderMutatorChrome(): void {
  patchMutatorIconAnchor();
  for (const type of Object.keys(Blockly.Blocks)) {
    const def = Blockly.Blocks[type] as {
      init?: (this: Block) => void;
      updateShape_?: (this: Block) => void;
      updateParams_?: (this: Block) => void;
    } | undefined;
    if (!def?.init) continue;
    if (chromeWrappedInit.get(type) !== def.init) {
      const originalInit = def.init;
      def.init = function (this: Block) {
        originalInit.call(this);
        afterMutatorBlockInit(this);
      };
      chromeWrappedInit.set(type, def.init);
    }
    wrapAfterInit(type, def as { [key: string]: unknown }, "updateShape_");
    wrapAfterInit(type, def as { [key: string]: unknown }, "updateParams_");
    wrapAfterInit(type, def as { [key: string]: unknown }, "updateAt_");
  }
}

function wrapAfterInit(
  type: string,
  def: { [key: string]: unknown },
  method: "updateShape_" | "updateParams_" | "updateAt_",
): void {
  const original = def[method];
  if (typeof original !== "function") return;
  const key = `${type}.${method}`;
  if (chromeWrappedMethods.get(key) === original) return;
  def[method] = function (this: Block, ...args: unknown[]) {
    (original as (this: Block, ...args: unknown[]) => void).apply(this, args);
    afterMutatorBlockInit(this);
  };
  chromeWrappedMethods.set(key, def[method]);
}

