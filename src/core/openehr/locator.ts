/**
 * openEHR locator paths (BASE Architecture Overview, Paths and Locators):
 * bracket sugar over XPath, compiled to XML attribute tests or JSON map filters.
 *
 * @see https://specifications.openehr.org/releases/BASE/development/architecture_overview.html#_paths_and_locators
 * @see openehr://guides/aql/syntax
 */

export interface LocatorCompare {
  path: string;
  op: string;
  value: string;
}

export interface LocatorPredicate {
  /** Archetype node id or chaining-point archetype id (`[at0003]`, `[openEHR-EHR-…]`). */
  nodeId?: string;
  /** `name/value` shortcut (`[at0001, 'standing']`). */
  name?: string;
  extras: LocatorCompare[];
}

export interface LocatorStep {
  axis: "child" | "descendant";
  name: string;
  predicate?: LocatorPredicate;
  /** JSON authoring index (`[1]`) or wildcard (`[*]`). */
  index?: number | "*";
}

export interface OpenEhrLocator {
  absolute: boolean;
  dollar: boolean;
  steps: LocatorStep[];
}

const AT_OR_ID = /^(?:at|id)[\d.]+$/i;
const ARCHETYPE_ID = /^openEHR-[A-Za-z0-9_.:-]+$/i;
const NODE_ID_SEGMENT = /^(?:at[\d.]+|id[\d.]+|openEHR-[A-Za-z0-9_.:-]+)$/i;

/** True when `path` uses openEHR node-id / archetype-id sugar rather than JSON `[1]` / `[*]`. */
export function looksLikeOpenEhrLocator(path: string): boolean {
  const p = stripTemplateSlotPrefix(path.trim());
  if (/\[(?:at[\d.]+|id[\d.]+|openEHR-)/i.test(p)) return true;
  if (/\[(?:[^[\]]*name\/value|@?archetype_node_id|@?archetype_id)\s*=/i.test(p)) return true;
  if (/\/(?:at[\d.]+|id[\d.]+|openEHR-[A-Za-z0-9_.:-]+)(?:\/|$|\[)/i.test(p)) return true;
  return false;
}

/**
 * Parse an openEHR locator or a JSON authoring path (`$.a[1].b`).
 * `templateId//content…` slot ids are accepted; the template prefix is dropped.
 */
export function parseLocator(input: string): OpenEhrLocator {
  let source = input.trim();
  if (!source) return { absolute: false, dollar: false, steps: [] };
  source = stripTemplateSlotPrefix(source);

  let i = 0;
  let dollar = false;
  let absolute = false;
  const steps: LocatorStep[] = [];

  if (source.startsWith("$")) {
    dollar = true;
    i = 1;
    if (source[i] === ".") i++;
  } else if (source.startsWith("//")) {
    absolute = true;
    steps.push({ axis: "descendant", name: "" });
    i = 2;
  } else if (source.startsWith("/")) {
    absolute = true;
    i = 1;
    if (source.startsWith("//")) {
      // already handled
    }
  }

  let pendingDescendant = false;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "." || ch === "/") {
      if (ch === "/" && source[i + 1] === "/") {
        pendingDescendant = true;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    let end = i;
    while (end < source.length && !".[/".includes(source[end]!)) end++;
    const name = source.slice(i, end);
    i = end;
    let step: LocatorStep = {
      axis: pendingDescendant ? "descendant" : "child",
      name,
    };
    pendingDescendant = false;
    while (source[i] === "[") {
      const close = findMatchingBracket(source, i);
      if (close < 0) throw new Error(`Unclosed predicate in locator: ${input}`);
      const body = source.slice(i + 1, close).trim();
      // `foo[1]['|value']` is an index plus a child key, not one step.
      // OpenEHR predicates (`[at0003, 'Name']`) stay on the current step.
      if (step.name && isQuotedKey(body)) {
        steps.push(step);
        step = { axis: "child", name: unquote(body) };
      } else {
        applyBracket(step, body);
      }
      i = close + 1;
    }
    if (step.name || step.predicate || step.index !== undefined) steps.push(step);
  }

  return { absolute, dollar, steps: steps.filter((s) => s.name || s.axis === "descendant") };
}

/** Fold `content/at0000` unique-OPT segments into `content[at0000]` for compile. */
export function foldNodeIdSegments(locator: OpenEhrLocator): OpenEhrLocator {
  const steps: LocatorStep[] = [];
  for (const step of locator.steps) {
    if (
      NODE_ID_SEGMENT.test(step.name) &&
      !step.predicate &&
      step.index === undefined &&
      steps.length
    ) {
      const prev = steps[steps.length - 1]!;
      if (!prev.predicate?.nodeId) {
        prev.predicate = {
          nodeId: step.name,
          name: prev.predicate?.name,
          extras: prev.predicate?.extras ? [...prev.predicate.extras] : [],
        };
        if (step.axis === "descendant") prev.axis = "descendant";
        continue;
      }
    }
    steps.push(cloneStep(step));
  }
  return { ...locator, steps };
}

export function compileLocatorToXmlXPath(
  locator: OpenEhrLocator,
  options: { foldNodeIds?: boolean } = {},
): string {
  const folded = options.foldNodeIds === false ? locator : foldNodeIdSegments(locator);
  let out = folded.absolute ? "/" : "";
  if (folded.dollar) out = "";
  for (const step of folded.steps) {
    if (step.axis === "descendant" && !step.name) {
      out += out.endsWith("/") ? "/" : "//";
      continue;
    }
    if (step.axis === "descendant") out += "//";
    else if (out && !out.endsWith("/")) out += "/";
    out += step.name || "*";
    const pred = xmlPredicate(step.predicate);
    if (pred) out += `[${pred}]`;
    if (step.index === "*") out += "[*]";
    else if (typeof step.index === "number") out += `[${step.index}]`;
  }
  return out || "/";
}

export function compileLocatorToJsonXPath(
  locator: OpenEhrLocator,
  root = "$source",
  options: { foldNodeIds?: boolean } = {},
): string {
  const folded = options.foldNodeIds === false ? locator : foldNodeIdSegments(locator);
  let query = root;
  for (const step of folded.steps) {
    if (step.axis === "descendant" && !step.name) continue;
    const key = jsonLookupKey(step.name);
    if (step.predicate) {
      query = `(${query}${key})?*[${jsonPredicate(step.predicate)}]`;
    } else {
      query = `${query}${key}`;
    }
    if (step.index === "*") query = `${query}?*`;
    else if (typeof step.index === "number") query += xpathIndex(step.index);
  }
  return query;
}

/**
 * Compile an authoring path for fontoxpath.
 * OpenEHR locators become XML predicates or JSON map filters; generic JSON
 * (`$.vitals[1].systolic`) keeps index / key lookup.
 */
export function compileAuthoringPath(
  path: string,
  kind: "xml" | "json",
  root = "$source",
): string {
  const trimmed = path.trim();
  if (!trimmed) return kind === "json" ? root : "/";
  if (kind === "json" && trimmed.startsWith("$source")) return trimmed;
  if (looksLikeOpenEhrLocator(trimmed)) {
    const locator = parseLocator(trimmed);
    return kind === "xml"
      ? compileLocatorToXmlXPath(locator)
      : compileLocatorToJsonXPath(locator, root);
  }
  if (kind === "xml") return trimmed;
  return compileGenericJsonPath(trimmed, root);
}

/** Generic JSON authoring: `$.vitals[1].systolic` → `$source?vitals?1?systolic`. */
export function compileGenericJsonPath(expr: string, root = "$source"): string {
  if (expr.startsWith("$source")) return expr;
  const locator = parseLocator(expr);
  let query = root;
  for (const step of locator.steps) {
    if (!step.name && step.index === undefined) continue;
    if (step.name) query += jsonLookupKey(step.name);
    if (step.index === "*") query += "?*";
    else if (typeof step.index === "number") query += xpathIndex(step.index);
    else if (step.predicate?.nodeId) {
      // Non-openEHR `[key]` treated as a named child (legacy parseJsonAuthoringPath).
      query += jsonLookupKey(step.predicate.nodeId);
    }
  }
  return query;
}

export function formatLocator(locator: OpenEhrLocator): string {
  let out = locator.dollar ? "$" : locator.absolute ? "/" : "";
  if (locator.dollar && locator.steps.length) out += ".";
  for (let i = 0; i < locator.steps.length; i++) {
    const step = locator.steps[i]!;
    if (step.axis === "descendant") out += i === 0 && locator.absolute ? "/" : "//";
    else if (i > 0 || (locator.absolute && out === "/")) {
      if (!out.endsWith("/") && !locator.dollar) out += "/";
      else if (locator.dollar && i > 0) out += ".";
    }
    out += step.name;
    if (step.predicate) out += `[${formatPredicate(step.predicate)}]`;
    if (step.index === "*") out += "[*]";
    else if (typeof step.index === "number") out += `[${step.index}]`;
  }
  return out;
}

function stripTemplateSlotPrefix(path: string): string {
  if (path.startsWith("$") || path.startsWith("/")) return path;
  const split = path.indexOf("//");
  if (split <= 0) return path;
  const prefix = path.slice(0, split);
  if (/[\[\]$.]/.test(prefix)) return path;
  return path.slice(split + 1);
}

function findMatchingBracket(source: string, open: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = open; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isQuotedKey(body: string): boolean {
  const t = body.trim();
  if (t.length < 2) return false;
  const quote = t[0];
  return (quote === "'" || quote === '"') && t.endsWith(quote);
}

function applyBracket(step: LocatorStep, body: string): void {
  if (body === "*") {
    step.index = "*";
    return;
  }
  if (/^\d+$/.test(body)) {
    step.index = Number(body);
    return;
  }
  if (
    (body.startsWith('"') && body.endsWith('"')) ||
    (body.startsWith("'") && body.endsWith("'"))
  ) {
    step.name = step.name || unquote(body);
    return;
  }
  const pred = parsePredicate(body);
  if (!step.predicate) {
    step.predicate = pred;
    return;
  }
  mergePredicate(step.predicate, pred);
}

function parsePredicate(body: string): LocatorPredicate {
  const comma = splitTopComma(body);
  if (comma) {
    return {
      nodeId: stripNodeIdToken(comma.head),
      name: unquote(comma.tail),
      extras: [],
    };
  }
  const parts = splitTopAnd(body);
  const pred: LocatorPredicate = { extras: [] };
  for (const part of parts) {
    const token = part.trim();
    if (!token) continue;
    if (AT_OR_ID.test(token) || ARCHETYPE_ID.test(token)) {
      pred.nodeId = token;
      continue;
    }
    const cmp = parseCompare(token);
    if (cmp) {
      const path = cmp.path.replace(/^@/, "");
      if (path === "archetype_node_id" || path === "archetype_id") {
        pred.nodeId = cmp.value;
      } else if (path === "name/value" || path === "name") {
        pred.name = cmp.value;
      } else {
        pred.extras.push(cmp);
      }
      continue;
    }
    if (!pred.nodeId) pred.nodeId = token;
    else pred.extras.push({ path: token, op: "=", value: "" });
  }
  return pred;
}

function parseCompare(token: string): LocatorCompare | undefined {
  const m = token.match(/^(.+?)\s*(=|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) return undefined;
  return { path: m[1]!.trim(), op: m[2]!, value: unquote(m[3]!.trim()) };
}

function splitTopComma(body: string): { head: string; tail: string } | undefined {
  let quote: string | undefined;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      const head = body.slice(0, i).trim();
      const tail = body.slice(i + 1).trim();
      if ((AT_OR_ID.test(head) || ARCHETYPE_ID.test(head)) && tail) {
        return { head, tail };
      }
      return undefined;
    }
  }
  return undefined;
}

function splitTopAnd(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: string | undefined;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/u.test(ch) && body.slice(i).toLowerCase().startsWith(" and ")) {
      parts.push(body.slice(start, i));
      i += 4;
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function stripNodeIdToken(token: string): string {
  const cmp = parseCompare(token);
  if (cmp && (cmp.path.replace(/^@/, "") === "archetype_node_id" || cmp.path === "archetype_id")) {
    return cmp.value;
  }
  return token.replace(/^\[/, "").replace(/\]$/, "");
}

function xmlPredicate(pred: LocatorPredicate | undefined): string | undefined {
  if (!pred) return undefined;
  const bits: string[] = [];
  if (pred.nodeId) bits.push(`@archetype_node_id=${xmlString(pred.nodeId)}`);
  if (pred.name) bits.push(`name/value=${xmlString(pred.name)}`);
  for (const extra of pred.extras) {
    const path = extra.path.startsWith("@") ? extra.path : extra.path;
    bits.push(`${path} ${extra.op} ${xmlString(extra.value)}`);
  }
  return bits.length ? bits.join(" and ") : undefined;
}

function jsonPredicate(pred: LocatorPredicate): string {
  const bits: string[] = [];
  if (pred.nodeId) {
    bits.push(`?archetype_node_id = ${xmlString(pred.nodeId)}`);
  }
  if (pred.name) bits.push(`?name?value = ${xmlString(pred.name)}`);
  for (const extra of pred.extras) {
    const lookup = extra.path
      .replace(/^@/, "")
      .split("/")
      .filter(Boolean)
      .map((seg) => jsonLookupKey(seg).replace(/^\?/, "?"))
      .join("");
    bits.push(`${lookup} ${xpathCmp(extra.op)} ${xmlString(extra.value)}`);
  }
  return bits.join(" and ");
}

function xpathCmp(op: string): string {
  if (op === ">=") return "ge";
  if (op === "<=") return "le";
  if (op === ">") return "gt";
  if (op === "<") return "lt";
  if (op === "!=") return "ne";
  return "=";
}

/** Authoring `[0]` is the first element, the same as `[1]`. fontoxpath rejects `?0`. */
function xpathIndex(index: number): string {
  return `?${index === 0 ? 1 : index}`;
}

function jsonLookupKey(name: string): string {
  if (!name) return "";
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !name.includes(".")) return `?${name}`;
  return `?(${JSON.stringify(name)})`;
}

function formatPredicate(pred: LocatorPredicate): string {
  if (pred.nodeId && pred.name && pred.extras.length === 0) {
    return `${pred.nodeId}, ${xmlString(pred.name)}`;
  }
  const bits: string[] = [];
  if (pred.nodeId) bits.push(pred.nodeId);
  if (pred.name) bits.push(`name/value=${xmlString(pred.name)}`);
  for (const extra of pred.extras) bits.push(`${extra.path}${extra.op}${xmlString(extra.value)}`);
  return bits.join(" and ");
}

function xmlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function unquote(token: string): string {
  const t = token.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

function mergePredicate(into: LocatorPredicate, extra: LocatorPredicate): void {
  if (extra.nodeId && !into.nodeId) into.nodeId = extra.nodeId;
  if (extra.name && !into.name) into.name = extra.name;
  into.extras.push(...extra.extras);
}

function cloneStep(step: LocatorStep): LocatorStep {
  return {
    axis: step.axis,
    name: step.name,
    index: step.index,
    predicate: step.predicate
      ? {
        nodeId: step.predicate.nodeId,
        name: step.predicate.name,
        extras: [...step.predicate.extras],
      }
      : undefined,
  };
}
