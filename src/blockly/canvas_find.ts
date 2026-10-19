/**
 * #218: find-in-pane adapter for the Mapping Blockly canvas.
 *
 * Searchable units are the visible text of every field on every block of the
 * main workspace (titles, labels, dropdown values, text inputs, paths) in
 * reading order: top blocks by position, then each block's inputs depth
 * first. Hits are painted as SVG rects behind the field text; the current hit
 * selects its block (so the Mapping Spec follows) and is panned into view.
 */
import type { PaneFindAdapter, PaneFindMatch } from "../ui/pane_find.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const HIT_CLASS = "pane-find-svg-hit";
const CURRENT_CLASS = "pane-find-svg-hit--current";
const TEXT_CLASS = "pane-find-text-hit";

export type CanvasFindUnit = { blockId: string; textEl: SVGTextElement };

type FieldLike = { isVisible?: () => boolean; textElement_?: SVGTextElement | null };
type InputLike = {
  fieldRow: FieldLike[];
  isVisible?: () => boolean;
  connection?: { targetBlock: () => BlockLike | null } | null;
};
export type BlockLike = {
  id: string;
  inputList: InputLike[];
  getNextBlock: () => BlockLike | null;
  getSvgRoot?: () => SVGElement | null;
};
export type CanvasWorkspaceLike = {
  getTopBlocks: (ordered: boolean) => BlockLike[];
  addChangeListener: (fn: (event: { isUiEvent?: boolean; type?: string }) => void) => unknown;
  removeChangeListener: (fn: (event: { isUiEvent?: boolean; type?: string }) => void) => void;
  getParentSvg: () => SVGSVGElement;
  scrollX: number;
  scrollY: number;
  scroll: (x: number, y: number) => void;
};

export type CanvasFindOptions = {
  workspace: () => CanvasWorkspaceLike | null;
  /** Select the block that owns the current hit (Spec selection follows). */
  selectBlock: (blockId: string) => void;
  /** Area the current hit must stay inside (canvas minus toolbox and find panel). */
  visibleRect: () => DOMRect | null;
};

function isRendered(el: Element): boolean {
  if (!el.isConnected) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 || box.height > 0;
}

export function collectCanvasUnits(ws: CanvasWorkspaceLike): CanvasFindUnit[] {
  const out: CanvasFindUnit[] = [];
  const seen = new Set<string>();
  const walk = (block: BlockLike | null) => {
    for (let b = block; b && !seen.has(b.id); b = b.getNextBlock()) {
      seen.add(b.id);
      for (const input of b.inputList) {
        if (input.isVisible && !input.isVisible()) continue;
        for (const field of input.fieldRow) {
          if (field.isVisible && !field.isVisible()) continue;
          const el = field.textElement_;
          if (el && el.textContent && isRendered(el)) out.push({ blockId: b.id, textEl: el });
        }
        walk(input.connection?.targetBlock() ?? null);
      }
    }
  };
  for (const top of ws.getTopBlocks(true)) walk(top);
  return out;
}

function charBox(el: SVGTextElement, from: number, to: number): DOMRect | null {
  const n = el.getNumberOfChars();
  if (n <= 0 || from >= n) return null;
  try {
    const a = el.getExtentOfChar(from);
    const b = el.getExtentOfChar(Math.min(to, n) - 1);
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return new DOMRect(left, top, right - left, bottom - top);
  } catch {
    return null;
  }
}

function clientBoxOf(el: SVGTextElement, box: DOMRect): DOMRect | null {
  const m = el.getScreenCTM();
  if (!m) return null;
  const p1 = new DOMPoint(box.x, box.y).matrixTransform(m);
  const p2 = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(m);
  return new DOMRect(
    Math.min(p1.x, p2.x),
    Math.min(p1.y, p2.y),
    Math.abs(p2.x - p1.x),
    Math.abs(p2.y - p1.y),
  );
}

export function canvasFindAdapter(options: CanvasFindOptions): PaneFindAdapter<CanvasFindUnit> {
  let painted: Element[] = [];
  let textHits: SVGTextElement[] = [];
  return {
    collect() {
      const ws = options.workspace();
      return ws ? collectCanvasUnits(ws) : [];
    },
    // Blockly shows spaces as NBSP; search them as plain spaces (same length).
    text: (unit) => (unit.textEl.textContent ?? "").replace(/\u00a0/g, " "),
    paint(matches: PaneFindMatch<CanvasFindUnit>[], current: number) {
      matches.forEach((m, i) => {
        const el = m.unit.textEl;
        const box = charBox(el, m.from, m.to);
        if (!box || !el.parentNode) return;
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("class", i === current ? `${HIT_CLASS} ${CURRENT_CLASS}` : HIT_CLASS);
        rect.setAttribute("x", String(box.x - 1));
        rect.setAttribute("y", String(box.y));
        rect.setAttribute("width", String(box.width + 2));
        rect.setAttribute("height", String(box.height));
        rect.setAttribute("rx", "2");
        const transform = el.getAttribute("transform");
        if (transform) rect.setAttribute("transform", transform);
        el.parentNode.insertBefore(rect, el);
        painted.push(rect);
        if (!el.classList.contains(TEXT_CLASS)) {
          el.classList.add(TEXT_CLASS);
          textHits.push(el);
        }
      });
    },
    clear() {
      for (const el of painted) el.remove();
      for (const el of textHits) el.classList.remove(TEXT_CLASS);
      painted = [];
      textHits = [];
    },
    reveal(match) {
      options.selectBlock(match.unit.blockId);
      const ws = options.workspace();
      const el = match.unit.textEl;
      const box = charBox(el, match.from, match.to);
      const view = options.visibleRect();
      if (!ws || !box || !view) return;
      const hit = clientBoxOf(el, box);
      if (!hit) return;
      const margin = 24;
      const inside = hit.left >= view.left + margin && hit.right <= view.right - margin &&
        hit.top >= view.top + margin && hit.bottom <= view.bottom - margin;
      if (inside) return;
      const dx = view.left + view.width / 2 - (hit.left + hit.width / 2);
      const dy = view.top + view.height / 2 - (hit.top + hit.height / 2);
      ws.scroll(ws.scrollX + dx, ws.scrollY + dy);
    },
    watch(changed) {
      const ws = options.workspace();
      if (!ws) return () => {};
      let timer: number | undefined;
      const listener = (event: { isUiEvent?: boolean; type?: string }) => {
        if (event.isUiEvent) return;
        // Blockly re-renders after the event; repaint once it has settled.
        if (timer !== undefined) globalThis.clearTimeout(timer);
        timer = globalThis.setTimeout(() => {
          timer = undefined;
          changed();
        }, 60);
      };
      ws.addChangeListener(listener);
      return () => {
        if (timer !== undefined) globalThis.clearTimeout(timer);
        ws.removeChangeListener(listener);
      };
    },
  };
}
