/**
 * Anchored D3 Inline Editor Popover (Decision 2C).
 *
 * Allows Blockly-free mapping directly inside Treemap Overview for 1:1 source
 * bindings, datatype-aware literals, terminology bindings, constrained
 * verifiable Blockly expressions, and AI draft triage — while guarding against
 * accidentally overwriting complex Blockly logic.
 */
import type { BlocklyWorkspaceJson } from "../core/slice_engine.ts";
import {
  acceptAiSuggestion,
  clearMapping,
  isComplexMapping,
  rejectAiSuggestion,
  setLiteralValue,
  setSimpleExpression,
  setSourceBinding,
  setTerminologyBinding,
  type SimpleExpressionSpec,
} from "../core/json_patch_helpers.ts";
import type { TreemapDatum } from "./hierarchy.ts";

export interface SourceFieldOption {
  path: string;
  label: string;
  type?: string;
}

export interface InlinePopoverCallbacks {
  getCanonicalState: () => BlocklyWorkspaceJson;
  getSourceFields: () => SourceFieldOption[];
  onApplyPatch: (nextDoc: BlocklyWorkspaceJson, summary: string) => void;
  onEscalateToBlockly: (nodeId: string) => void;
}

export interface InlinePopoverController {
  open(datum: TreemapDatum, anchorEl: HTMLElement): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

type PopoverTab = "source" | "literal" | "terminology" | "expression";

export function createTreemapInlinePopover(
  host: HTMLElement,
  callbacks: InlinePopoverCallbacks,
): InlinePopoverController {
  const el = document.createElement("div");
  el.className = "tm-inline-popover";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Inline mapping editor");
  el.hidden = true;
  host.append(el);

  let activeDatum: TreemapDatum | null = null;
  let activeTab: PopoverTab = "source";
  let confirmOverwrite = false;

  const onDocKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !el.hidden) {
      close();
    }
  };
  document.addEventListener("keydown", onDocKeyDown);

  function close(): void {
    el.hidden = true;
    activeDatum = null;
    confirmOverwrite = false;
  }

  function applyWithGuard(
    mutate: (doc: BlocklyWorkspaceJson) => BlocklyWorkspaceJson,
    summary: string,
  ): void {
    if (!activeDatum) return;
    const doc = callbacks.getCanonicalState();
    const guard = isComplexMapping(doc, activeDatum.id);
    if (guard.complex && !confirmOverwrite) return;
    const next = mutate(doc);
    callbacks.onApplyPatch(next, summary);
    close();
  }

  function renderContent(): void {
    if (!activeDatum) return;
    const datum = activeDatum;
    const doc = callbacks.getCanonicalState();
    const guard = isComplexMapping(doc, datum.id);
    const sourceFields = callbacks.getSourceFields();
    const rmType = datum.valueRmType || "DV_TEXT";
    const blocked = guard.complex && !confirmOverwrite;

    el.replaceChildren();

    // Header
    const header = document.createElement("div");
    header.className = "tm-pop-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "tm-pop-title-wrap";
    const h3 = document.createElement("h4");
    h3.className = "tm-pop-title";
    h3.textContent = datum.label;
    const meta = document.createElement("div");
    meta.className = "tm-pop-meta";
    meta.textContent = `${rmType} · ${datum.mandatory ? "Mandatory (1..*)" : "Optional (0..*)"} · ${datum.status}`;
    titleWrap.append(h3, meta);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tm-pop-close";
    closeBtn.setAttribute("aria-label", "Close inline editor");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    header.append(titleWrap, closeBtn);
    el.append(header);

    if (datum.slotId) {
      const pathEl = document.createElement("div");
      pathEl.className = "tm-pop-path";
      pathEl.textContent = datum.slotId;
      el.append(pathEl);
    }

    // AI draft triage bar
    if (datum.hasAiDraft) {
      const aiBar = document.createElement("div");
      aiBar.className = "tm-pop-ai-bar";
      const info = document.createElement("span");
      const pct = datum.aiConfidence !== undefined ? `${datum.aiConfidence}% ` : "";
      info.textContent = `✦ AI draft ${pct}${datum.aiNote ? `— ${datum.aiNote}` : ""}`;
      const btns = document.createElement("span");
      btns.className = "tm-pop-ai-btns";

      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "tm-pop-btn tm-pop-btn--accept";
      acceptBtn.dataset.tmPopAction = "accept-ai";
      acceptBtn.textContent = "✓ Accept";
      acceptBtn.addEventListener("click", () => {
        const next = acceptAiSuggestion(callbacks.getCanonicalState(), datum.id);
        callbacks.onApplyPatch(next, `Accept AI suggestion on ${datum.label}`);
        close();
      });

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "tm-pop-btn tm-pop-btn--reject";
      rejectBtn.dataset.tmPopAction = "reject-ai";
      rejectBtn.textContent = "✕ Reject";
      rejectBtn.addEventListener("click", () => {
        const next = rejectAiSuggestion(callbacks.getCanonicalState(), datum.id);
        callbacks.onApplyPatch(next, `Reject AI suggestion on ${datum.label}`);
        close();
      });

      btns.append(acceptBtn, rejectBtn);
      aiBar.append(info, btns);
      el.append(aiBar);
    }

    // Complex-logic guardrail banner
    if (guard.complex) {
      const banner = document.createElement("div");
      banner.className = "tm-pop-guard";
      banner.dataset.tmComplexGuard = "1";
      const msg = document.createElement("div");
      msg.textContent = `⚠ Complex Blockly logic (${guard.reason}). Edit in Scoped Blockly to preserve it.`;
      const checkLabel = document.createElement("label");
      checkLabel.className = "tm-pop-guard-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = confirmOverwrite;
      cb.addEventListener("change", () => {
        confirmOverwrite = cb.checked;
        renderContent();
      });
      checkLabel.append(cb, document.createTextNode(" Allow replacing complex logic from inline editor"));
      banner.append(msg, checkLabel);
      el.append(banner);
    }

    // Tabs
    const tabBar = document.createElement("div");
    tabBar.className = "tm-pop-tabs";
    tabBar.setAttribute("role", "tablist");
    const tabs: Array<{ id: PopoverTab; label: string }> = [
      { id: "source", label: "Source" },
      { id: "literal", label: "Literal" },
      { id: "terminology", label: "Terminology" },
      { id: "expression", label: "Expression" },
    ];
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `tm-pop-tab${activeTab === t.id ? " active" : ""}`;
      btn.dataset.tmPopTab = t.id;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(activeTab === t.id));
      btn.textContent = t.label;
      btn.addEventListener("click", () => {
        activeTab = t.id;
        renderContent();
      });
      tabBar.append(btn);
    }
    el.append(tabBar);

    const body = document.createElement("div");
    body.className = "tm-pop-body";

    if (activeTab === "source") {
      const form = document.createElement("form");
      form.className = "tm-pop-form";
      const label = document.createElement("label");
      label.textContent = "Source XPath / field (type, pick, or drop from Source Pane)";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tm-pop-input";
      input.name = "sourcePath";
      input.placeholder = "$.patient.weight";
      input.value = datum.mappingSummary.startsWith("$") || datum.mappingSummary.startsWith("/")
        ? datum.mappingSummary
        : "";
      input.setAttribute("list", "tm-source-fields-datalist");

      // Support drag-and-drop from existing Source Pane tree.
      input.addEventListener("dragover", (e) => e.preventDefault());
      input.addEventListener("drop", (e) => {
        e.preventDefault();
        const dropped = e.dataTransfer?.getData("text/plain") ||
          e.dataTransfer?.getData("application/x-intehrgrator-source") ||
          "";
        if (dropped.trim()) input.value = dropped.trim();
      });

      const datalist = document.createElement("datalist");
      datalist.id = "tm-source-fields-datalist";
      for (const sf of sourceFields.slice(0, 250)) {
        const opt = document.createElement("option");
        opt.value = sf.path;
        opt.label = sf.type ? `${sf.label} (${sf.type})` : sf.label;
        datalist.append(opt);
      }

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "tm-pop-btn tm-pop-btn--primary";
      submitBtn.textContent = "Apply Source Binding";
      submitBtn.disabled = blocked;

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const path = input.value.trim();
        if (!path) return;
        applyWithGuard(
          (d) => setSourceBinding(d, datum.id, path, rmType),
          `Bind ${datum.label} to ${path}`,
        );
      });
      form.append(label, input, datalist, submitBtn);
      body.append(form);
    } else if (activeTab === "literal") {
      const form = document.createElement("form");
      form.className = "tm-pop-form";
      const label = document.createElement("label");
      label.textContent = `Literal value (${rmType})`;
      const upper = rmType.toUpperCase();
      let getValue: () => string | number | boolean;

      if (upper === "DV_BOOLEAN") {
        const select = document.createElement("select");
        select.className = "tm-pop-input";
        select.name = "literalValue";
        select.innerHTML = `<option value="true">true</option><option value="false">false</option>`;
        getValue = () => select.value === "true";
        form.append(label, select);
      } else {
        const input = document.createElement("input");
        input.className = "tm-pop-input";
        input.name = "literalValue";
        input.type = (upper === "DV_QUANTITY" || upper === "DV_COUNT" || upper === "DV_PROPORTION")
          ? "number"
          : "text";
        if (input.type === "number") input.step = "any";
        input.placeholder = input.type === "number" ? "0" : "Constant text…";
        getValue = () => (input.type === "number" ? Number(input.value) : input.value);
        form.append(label, input);
      }

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "tm-pop-btn tm-pop-btn--primary";
      submitBtn.textContent = "Apply Literal";
      submitBtn.disabled = blocked;

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const val = getValue();
        applyWithGuard(
          (d) => setLiteralValue(d, datum.id, rmType, val),
          `Set literal on ${datum.label}`,
        );
      });
      form.append(submitBtn);
      body.append(form);
    } else if (activeTab === "terminology") {
      const form = document.createElement("form");
      form.className = "tm-pop-form";

      const sysInput = document.createElement("input");
      sysInput.className = "tm-pop-input";
      sysInput.name = "codeSystem";
      sysInput.placeholder = "Code system (e.g. SNOMED-CT, LOINC, local)";
      sysInput.value = "SNOMED-CT";

      const codeInput = document.createElement("input");
      codeInput.className = "tm-pop-input";
      codeInput.name = "code";
      codeInput.placeholder = "Code (e.g. 271649006)";

      const dispInput = document.createElement("input");
      dispInput.className = "tm-pop-input";
      dispInput.name = "display";
      dispInput.placeholder = "Display term";

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "tm-pop-btn tm-pop-btn--primary";
      submitBtn.textContent = "Apply Terminology Binding";
      submitBtn.disabled = blocked;

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const sys = sysInput.value.trim();
        const code = codeInput.value.trim();
        const disp = dispInput.value.trim() || code;
        if (!sys || !code) return;
        applyWithGuard(
          (d) => setTerminologyBinding(d, datum.id, sys, code, disp),
          `Bind terminology ${sys}:${code} on ${datum.label}`,
        );
      });

      form.append(sysInput, codeInput, dispInput, submitBtn);
      body.append(form);
    } else {
      // Constrained verifiable Blockly expression builder
      const form = document.createElement("form");
      form.className = "tm-pop-form";

      const kindSelect = document.createElement("select");
      kindSelect.className = "tm-pop-input";
      kindSelect.name = "exprKind";
      kindSelect.innerHTML = `
        <option value="trim">Trim whitespace (text_trim)</option>
        <option value="scale_offset">Unit scale / offset (math_arithmetic)</option>
        <option value="fallback">Fallback default (logic_ternary)</option>
        <option value="concat">Join two fields (text_join)</option>
      `;

      const srcInput = document.createElement("input");
      srcInput.className = "tm-pop-input";
      srcInput.name = "exprSource";
      srcInput.placeholder = "Primary source path (e.g. $.weight_g)";

      const arg1Input = document.createElement("input");
      arg1Input.className = "tm-pop-input";
      arg1Input.name = "exprArg1";
      arg1Input.placeholder = "Multiplier / Fallback / Separator";

      const arg2Input = document.createElement("input");
      arg2Input.className = "tm-pop-input";
      arg2Input.name = "exprArg2";
      arg2Input.placeholder = "Offset / Second source path (optional)";

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "tm-pop-btn tm-pop-btn--primary";
      submitBtn.textContent = "Apply Expression";
      submitBtn.disabled = blocked;

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const src = srcInput.value.trim();
        if (!src) return;
        const kind = kindSelect.value;
        let spec: SimpleExpressionSpec;
        if (kind === "scale_offset") {
          spec = {
            kind: "scale_offset",
            sourcePath: src,
            multiplier: arg1Input.value.trim() ? Number(arg1Input.value) : 1,
            offset: arg2Input.value.trim() ? Number(arg2Input.value) : 0,
          };
        } else if (kind === "fallback") {
          spec = {
            kind: "fallback",
            sourcePath: src,
            fallbackValue: arg1Input.value,
          };
        } else if (kind === "concat") {
          const parts: Array<{ kind: "source"; path: string } | { kind: "literal"; text: string }> = [
            { kind: "source", path: src },
          ];
          if (arg1Input.value) parts.push({ kind: "literal", text: arg1Input.value });
          if (arg2Input.value.trim()) parts.push({ kind: "source", path: arg2Input.value.trim() });
          spec = { kind: "concat", parts };
        } else {
          spec = { kind: "trim", sourcePath: src };
        }
        applyWithGuard(
          (d) => setSimpleExpression(d, datum.id, spec, rmType),
          `Set ${kind} expression on ${datum.label}`,
        );
      });

      form.append(kindSelect, srcInput, arg1Input, arg2Input, submitBtn);
      body.append(form);
    }

    el.append(body);

    // Footer
    const footer = document.createElement("div");
    footer.className = "tm-pop-footer";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "tm-pop-btn";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = blocked;
    clearBtn.addEventListener("click", () => {
      applyWithGuard(
        (d) => clearMapping(d, datum.id),
        `Clear mapping on ${datum.label}`,
      );
    });

    const escalateBtn = document.createElement("button");
    escalateBtn.type = "button";
    escalateBtn.className = "tm-pop-btn tm-pop-btn--escalate";
    escalateBtn.dataset.tmPopAction = "escalate-blockly";
    escalateBtn.textContent = "Edit in Scoped Blockly →";
    escalateBtn.addEventListener("click", () => {
      const id = datum.id;
      close();
      callbacks.onEscalateToBlockly(id);
    });

    footer.append(clearBtn, escalateBtn);
    el.append(footer);
  }

  return {
    open(datum: TreemapDatum, anchorEl: HTMLElement) {
      activeDatum = datum;
      confirmOverwrite = false;
      activeTab = datum.valueRmType.toUpperCase() === "DV_CODED_TEXT" ? "terminology" : "source";
      renderContent();
      el.hidden = false;

      // Position anchored within host bounds.
      const hostRect = host.getBoundingClientRect();
      const anchorRect = anchorEl.getBoundingClientRect();
      const popW = 340;
      const popH = 300;
      const left = Math.max(
        8,
        Math.min(hostRect.width - popW - 8, anchorRect.left - hostRect.left + 8),
      );
      const top = Math.max(
        8,
        Math.min(hostRect.height - popH - 8, anchorRect.bottom - hostRect.top + 6),
      );
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    close,
    isOpen: () => !el.hidden,
    destroy() {
      document.removeEventListener("keydown", onDocKeyDown);
      el.remove();
    },
  };
}
