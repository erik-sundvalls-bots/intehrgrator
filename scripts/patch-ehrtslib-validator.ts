/**
 * ehrtslib matches sibling C_OBJECT children by RM type and then falls back to
 * children[0]. That checks every OBSERVATION against the first archetype
 * (pulse reported as respiration, and the same for clusters).
 *
 * The library itself is imported from the jsDelivr release pin. This downloads
 * `validation/template_validator.ts` from that pin, rewrites its relative
 * imports to absolute CDN URLs, applies the sibling-match correction, and
 * writes `vendor/ehrtslib-overrides/validation/template_validator.ts`.
 * deno.json scopes that one module to the local file.
 */
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { ehrtslibCdnPrefix, fetchEhrtslibText } from "../src/core/ehrtslib_cdn.ts";

const OVERRIDE_REL = join("vendor", "ehrtslib-overrides", "validation", "template_validator.ts");

const MARKER = "INTEHR_SIBLING_CONSTRAINT_MATCH";
const NAME_MARKER = "INTEHR_NAME_CONSTRAINT_MATCH";
const ABSENT_MARKER = "INTEHR_SKIP_ABSENT_OPTIONAL_ATTRIBUTE";

const ABSENT_CHILD_WALK = `      } else {
        for (const child of children) {
          this.validateNode(
            rmValue,
            child,
            attrPath,
            errors,
            warnings,
            depth + 1,
            cObject.rm_type_name,
          );
        }
      }`;

const ABSENT_CHILD_WALK_NEXT = `      }
      // ${ABSENT_MARKER}: child occurrences apply only when the attribute is
      // present. An omitted optional attribute (protocol, state, other_context)
      // must not be reported as required because a nested object has min 1.`;

const CALL_SITE_ARRAY = `        rmValue.forEach((item, i) => {
          const child = matchConstraintChild(children, item) ?? children[0];
          this.validateNode(`;

const CALL_SITE_ARRAY_NEXT = `        rmValue.forEach((item, i) => {
          const child = matchConstraintChild(children, item);
          if (!child) return;
          this.validateNode(`;

const CALL_SITE_SINGLE = `        const child = matchConstraintChild(children, rmValue) ?? children[0];
        this.validateNode(`;

const CALL_SITE_SINGLE_NEXT = `        const child = matchConstraintChild(children, rmValue);
        if (!child) return;
        this.validateNode(`;

const MATCH_FN_NEXT = `function matchConstraintChild(
  children: openehr_am.C_OBJECT[],
  rmItem: unknown,
): openehr_am.C_OBJECT | undefined {
  // ${MARKER}: pick the sibling constraint for this archetype id / at-code.
  if (children.length === 1) return children[0];
  const instanceId = instanceArchetypeNodeId(rmItem);
  if (instanceId) {
    const byArchetype = children.find((child) =>
      child instanceof openehr_am.C_ARCHETYPE_ROOT && child.archetype_ref === instanceId
    );
    if (byArchetype) return byArchetype;
    const byNode = children.filter((child) => child.node_id === instanceId);
    // ${NAME_MARKER}: template slots often reuse one at-code with different
    // LOCATABLE.name constraints. The name picks the sibling.
    const named = pickConstraintByLocatableName(byNode, rmItem);
    if (named) return named;
    if (byNode.length === 1) return byNode[0];
  }
  const actual = TypeRegistry.getTypeNameFromInstance(rmItem);
  if (!actual) return undefined;
  const typeMatches = children.filter((child) => {
    const expected = child.rm_type_name;
    if (!expected) return false;
    return actual === expected || isSubtypeOf(actual, expected);
  });
  return typeMatches.length === 1 ? typeMatches[0] : undefined;
}

function instanceArchetypeNodeId(rmItem: unknown): string | undefined {
  if (!rmItem || typeof rmItem !== "object") return undefined;
  const id = (rmItem as { archetype_node_id?: unknown }).archetype_node_id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function pickConstraintByLocatableName(
  children: openehr_am.C_OBJECT[],
  rmItem: unknown,
): openehr_am.C_OBJECT | undefined {
  if (children.length < 2) return undefined;
  const name = instanceLocatableName(rmItem);
  if (!name) return undefined;
  const matches = children.filter((child) => constraintLocatableName(child) === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function instanceLocatableName(rmItem: unknown): string | undefined {
  if (!rmItem || typeof rmItem !== "object") return undefined;
  const name = (rmItem as { name?: unknown }).name;
  if (typeof name === "string" && name.trim()) return name.trim();
  if (name && typeof name === "object" && "value" in name) {
    const value = (name as { value?: unknown }).value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function constraintLocatableName(child: openehr_am.C_OBJECT): string | undefined {
  const attrs = (child as { attributes?: Array<{ rm_attribute_name?: string; children?: unknown[] }> }).attributes;
  if (!Array.isArray(attrs)) return undefined;
  for (const attr of attrs) {
    if (attr?.rm_attribute_name !== "name") continue;
    const found = firstConstrainedString(attr.children);
    if (found) return found;
  }
  return undefined;
}

function firstConstrainedString(nodes: unknown): string | undefined {
  if (!Array.isArray(nodes)) return undefined;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const rec = node as {
      item?: { list?: unknown };
      list?: unknown;
      attributes?: Array<{ children?: unknown }>;
    };
    const list = rec.item?.list ?? rec.list;
    if (Array.isArray(list) && list.length === 1 && typeof list[0] === "string" && list[0]) {
      return list[0];
    }
    if (Array.isArray(rec.attributes)) {
      for (const attr of rec.attributes) {
        const nested = firstConstrainedString(attr.children);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}`;

function rewriteRelativeImports(source: string, moduleUrl: string): string {
  return source.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (_match, spec: string) => `from "${new URL(spec, moduleUrl).href}"`,
  );
}

export async function patchEhrtslibValidator(root = Deno.cwd()): Promise<void> {
  const moduleUrl = new URL("validation/template_validator.ts", ehrtslibCdnPrefix()).href;
  const path = join(root, OVERRIDE_REL);
  let next = rewriteRelativeImports(await fetchEhrtslibText("validation/template_validator.ts"), moduleUrl);
  let changed = false;
  if (!next.includes(MARKER)) {
    const replacements: Array<[string, string]> = [
      [CALL_SITE_ARRAY, CALL_SITE_ARRAY_NEXT],
      [CALL_SITE_SINGLE, CALL_SITE_SINGLE_NEXT],
    ];
    for (const [from, to] of replacements) {
      if (!next.includes(from)) {
        throw new Error(
          `ehrtslib TemplateValidator patch missed an expected snippet in ${path}. Upstream may have changed.`,
        );
      }
      next = next.replace(from, to);
    }
    // The whole upstream matchConstraintChild is replaced (its body changes between releases).
    const fnStart = next.indexOf("function matchConstraintChild(");
    const fnEnd = fnStart < 0 ? -1 : next.indexOf("\n}\n", fnStart);
    if (fnEnd < 0) {
      throw new Error(`ehrtslib TemplateValidator patch missed matchConstraintChild in ${path}. Upstream may have changed.`);
    }
    next = next.slice(0, fnStart) + MATCH_FN_NEXT + next.slice(fnEnd + 2);
    changed = true;
    console.log("Patched ehrtslib TemplateValidator sibling constraint matching");
  }
  if (next.includes(MARKER) && !next.includes(NAME_MARKER)) {
    const oldByNode = `    const byNode = children.find((child) => child.node_id === instanceId);
    if (byNode) return byNode;`;
    const newByNode = `    const byNode = children.filter((child) => child.node_id === instanceId);
    // ${NAME_MARKER}: template slots often reuse one at-code with different
    // LOCATABLE.name constraints. The name picks the sibling.
    const named = pickConstraintByLocatableName(byNode, rmItem);
    if (named) return named;
    if (byNode.length === 1) return byNode[0];`;
    if (!next.includes(oldByNode)) {
      throw new Error(
        `ehrtslib TemplateValidator name-constraint patch missed the node-id match in ${path}.`,
      );
    }
    next = next.replace(oldByNode, newByNode);
    const helperAnchor = `function instanceArchetypeNodeId(rmItem: unknown): string | undefined {
  if (!rmItem || typeof rmItem !== "object") return undefined;
  const id = (rmItem as { archetype_node_id?: unknown }).archetype_node_id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}`;
    if (!next.includes("function pickConstraintByLocatableName")) {
      if (!next.includes(helperAnchor)) {
        throw new Error(
          `ehrtslib TemplateValidator name-constraint patch missed instanceArchetypeNodeId in ${path}.`,
        );
      }
      const helpers = MATCH_FN_NEXT.slice(MATCH_FN_NEXT.indexOf("function pickConstraintByLocatableName"));
      next = next.replace(helperAnchor, `${helperAnchor}\n\n${helpers}`);
    }
    changed = true;
    console.log("Patched ehrtslib TemplateValidator name-constraint sibling match");
  }
  if (!next.includes(ABSENT_MARKER)) {
    if (!next.includes(ABSENT_CHILD_WALK)) {
      throw new Error(
        `ehrtslib TemplateValidator patch missed the absent-attribute walk in ${path}. Upstream may have changed.`,
      );
    }
    next = next.replace(ABSENT_CHILD_WALK, ABSENT_CHILD_WALK_NEXT);
    changed = true;
    console.log("Patched ehrtslib TemplateValidator absent optional attributes");
  }
  if (changed) {
    await ensureDir(dirname(path));
    await Deno.writeTextFile(path, next);
  }
}

if (import.meta.main) {
  await patchEhrtslibValidator();
}
