/**
 * ehrtslib v0.6 `TemplateValidator` walks every child constraint of an
 * attribute that is absent from the instance, so a nested object with min 1
 * under an omitted optional attribute (protocol, state, other_context) is
 * reported as "Required attribute missing".
 *
 * The library itself is imported from the jsDelivr release pin. This downloads
 * `validation/template_validator.ts` from that pin, rewrites its relative
 * imports to absolute CDN URLs, skips that walk, and writes
 * `vendor/ehrtslib-overrides/validation/template_validator.ts`.
 * deno.json scopes that one module to the local file.
 *
 * Sibling matching by node id (ehrtslib #165) is upstream since v0.6, so the
 * earlier sibling and name-constraint patches are gone.
 */
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { ehrtslibCdnPrefix, fetchEhrtslibText } from "../src/core/ehrtslib_cdn.ts";

const OVERRIDE_REL = join("vendor", "ehrtslib-overrides", "validation", "template_validator.ts");

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

function rewriteRelativeImports(source: string, moduleUrl: string): string {
  return source.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (_match, spec: string) => `from "${new URL(spec, moduleUrl).href}"`,
  );
}

export async function patchEhrtslibValidator(root = Deno.cwd()): Promise<void> {
  const moduleUrl = new URL("validation/template_validator.ts", ehrtslibCdnPrefix()).href;
  const path = join(root, OVERRIDE_REL);
  const source = rewriteRelativeImports(await fetchEhrtslibText("validation/template_validator.ts"), moduleUrl);
  if (!source.includes(ABSENT_CHILD_WALK)) {
    throw new Error(
      `ehrtslib TemplateValidator patch missed the absent-attribute walk in ${path}. Upstream may have changed.`,
    );
  }
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, source.replace(ABSENT_CHILD_WALK, ABSENT_CHILD_WALK_NEXT));
  console.log("Patched ehrtslib TemplateValidator absent optional attributes");
}

if (import.meta.main) {
  await patchEhrtslibValidator();
}
