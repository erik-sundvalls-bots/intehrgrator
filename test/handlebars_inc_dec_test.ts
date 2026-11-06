/**
 * Kintegrate Handlebars helpers `inc` and `dec` (#339).
 *
 * Expected strings are the Integration Builder results (`(v) => v + 1`,
 * `(v) => v - 1`), not values recomputed by the implementation under test.
 * `(inc @index)` is the 1-based row number inside `#each`.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import Handlebars from "handlebars";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { generate } from "@intehrgrator/core/codegen/mod.ts";
import { igHandlebars } from "@intehrgrator/core/codegen/helpers/typescript.ts";
import { kintegrateHandlebarsHelpers } from "@intehrgrator/core/codegen/helpers/handlebars.ts";
import { renderHandlebars } from "@intehrgrator/core/output/handlebars_dialect.ts";
import { extractHandlebarsPaths } from "@intehrgrator/core/output/handlebars_to_blockly.ts";
import {
  checkVmsHbs,
  VMS_HBS_ALLOWED_HELPERS,
} from "@intehrgrator/core/output/vms_hbs.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import { ensureXQueryRuntime } from "@intehrgrator/core/codegen/run_xquery.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";

/** Number in, one more / one less out. Kintegrate `(v) => v + 1` / `(v) => v - 1`. */
const NUMBER_TEMPLATE = "{{inc n}}/{{dec n}}";
const NUMBER_OUTPUT = "3/1";

/** JavaScript `+` concatenates a string; `-` subtracts. */
const STRING_TEMPLATE = "{{inc v}}|{{dec v}}";
const STRING_OUTPUT = "21|1";

/** `{{inc @index}}` is the 1-based row number. @index starts at 0. */
const ROW_TEMPLATE = "{{#each rows}}{{inc @index}}. {{this}}\n{{/each}}";
const ROW_OUTPUT = "1. Ada\n2. Bea\n";

const ROWS = { rows: ["Ada", "Bea"] };

function numberCanvas(): Record<string, unknown> {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "conversion_start",
          id: "start",
          next: {
            block: {
              type: "text_document",
              id: "doc",
              inputs: {
                VALUE: {
                  block: {
                    type: "text_handlebars",
                    id: "hbs",
                    inputs: {
                      SCRIPT: {
                        block: {
                          type: "text_code",
                          id: "script",
                          fields: { LANG: "handlebars", TEXT: NUMBER_TEMPLATE },
                        },
                      },
                      CONTEXT: {
                        block: {
                          type: "maps_create_with",
                          id: "ctx",
                          extraState: { itemCount: 1 },
                          fields: { KEY0: "n" },
                          inputs: {
                            VAL0: {
                              block: {
                                type: "math_number",
                                id: "n",
                                fields: { NUM: 2 },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
}

const freeForm = {
  format: "free-form" as const,
  targetId: "n",
  filename: "n.hbs",
  content: "",
  skeleton: [] as [],
};

Deno.test("VMS-Hbs allows inc and dec and still rejects lookup", () => {
  for (const name of Object.keys(kintegrateHandlebarsHelpers)) {
    assertEquals(VMS_HBS_ALLOWED_HELPERS[name], true, name);
  }
  const allowed = checkVmsHbs(`${NUMBER_TEMPLATE}\n${ROW_TEMPLATE}\n{{#if (eq (inc n) 3)}}yes{{/if}}`);
  assertEquals(allowed.ok, true, JSON.stringify(allowed.diagnostics));
  const lookup = checkVmsHbs("{{lookup map key}}");
  assertEquals(lookup.ok, false);
});

Deno.test("inc and dec match Kintegrate on numbers, numeric strings, and @index", () => {
  assertEquals(renderHandlebars(NUMBER_TEMPLATE, { n: 2 }), NUMBER_OUTPUT);
  assertEquals(renderHandlebars(STRING_TEMPLATE, { v: "2" }), STRING_OUTPUT);
  assertEquals(renderHandlebars("{{inc v}}|{{dec v}}", { v: null }), "1|-1");
  assertEquals(renderHandlebars(ROW_TEMPLATE, ROWS), ROW_OUTPUT);
  assertEquals(igHandlebars(Handlebars, NUMBER_TEMPLATE, { n: 2 }), NUMBER_OUTPUT);
  assertEquals(igHandlebars(Handlebars, STRING_TEMPLATE, { v: "2" }), STRING_OUTPUT);
  assertEquals(igHandlebars(Handlebars, ROW_TEMPLATE, ROWS), ROW_OUTPUT);
});

Deno.test("path inventory skips inc and dec helper calls", () => {
  const refs = extractHandlebarsPaths("{{inc n}} {{(dec m)}} {{name}}");
  assertEquals(refs.map((ref) => ref.path), ["name"]);
});

Deno.test("inc and dec: each output matches the Handlebars result", async () => {
  initBlocklyGenerators();
  await ensureGoTemplateWasm();
  await ensureXQueryRuntime();
  const model = createEmptyModel("inc-dec");
  model.targetFormat = "free-form";
  const canvas = numberCanvas();
  const modes = ["preview", "handlebars", "typescript", "xquery", "go-template"] as const;
  for (const outputMode of modes) {
    const result = runTest(model, "{}", "json", {
      outputMode,
      blocklyState: canvas,
      target: freeForm,
    });
    assertEquals(result.error, undefined, `${outputMode}: ${result.error}`);
    assertEquals(result.output, NUMBER_OUTPUT, outputMode);
  }

  const java = generate(model, "java", { blocklyState: canvas });
  assertStringIncludes(java, NUMBER_TEMPLATE);
  assertStringIncludes(java, "HandlebarsSupport.handlebars");
});

Deno.test({
  name: "Java output inc and dec matches the Handlebars result",
  ignore: Deno.env.get("SKIP_ARCHIE_COMPILE") === "1",
  async fn() {
    if (!(await javaAvailable())) {
      console.warn("skip: java not on PATH");
      return;
    }
    if (!(await javacReleaseSupported("21"))) {
      console.warn("skip: javac does not support --release 21");
      return;
    }
    initBlocklyGenerators();
    const model = createEmptyModel("inc-dec");
    model.targetFormat = "free-form";
    const javaSource = generate(model, "java", { blocklyState: numberCanvas() });
    assertStringIncludes(javaSource, NUMBER_TEMPLATE);

    const dir = await Deno.makeTempDir({ prefix: "intehrgrator-hbs-inc-" });
    const lib = join(dir, "lib");
    await Deno.mkdir(lib);
    const jars = await fetchJars(lib);
    if (!jars) return;

    const src = join(dir, "src");
    const runtime = join(src, "se", "regionstockholm", "intehrgrator", "runtime");
    const generated = join(src, "se", "regionstockholm", "intehrgrator", "generated");
    await Deno.mkdir(runtime, { recursive: true });
    await Deno.mkdir(generated, { recursive: true });
    const helperRoot = join(import.meta.dirname!, "..", "src", "core", "codegen", "helpers", "java");
    await Deno.copyFile(join(helperRoot, "HandlebarsSupport.java"), join(runtime, "HandlebarsSupport.java"));
    await Deno.copyFile(join(helperRoot, "IntehrgratorRuntime.java"), join(runtime, "IntehrgratorRuntime.java"));
    const script = join(generated, "ConversionScript.java");
    await Deno.writeTextFile(script, javaSource);
    const main = join(src, "IncDecMain.java");
    await Deno.writeTextFile(main, javaMain());
    const classes = join(dir, "classes");
    await Deno.mkdir(classes);
    const cp = jars.join(":");
    const compiled = await new Deno.Command("javac", {
      args: [
        "--release",
        "21",
        "-cp",
        cp,
        "-d",
        classes,
        join(runtime, "HandlebarsSupport.java"),
        join(runtime, "IntehrgratorRuntime.java"),
        script,
        main,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const compileText = new TextDecoder().decode(compiled.stderr);
    assertEquals(compiled.success, true, compileText);
    const ran = await new Deno.Command("java", {
      args: ["-cp", `${classes}:${cp}`, "IncDecMain"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(ran.stdout);
    const stderr = new TextDecoder().decode(ran.stderr);
    assertEquals(ran.success, true, `${stderr}\n${stdout}`);
    assertEquals(stdout, `${NUMBER_OUTPUT}\n${STRING_OUTPUT}\n1|-1\n${ROW_OUTPUT}`);
  },
});

function javaMain(): string {
  return `import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import se.regionstockholm.intehrgrator.runtime.HandlebarsSupport;

public class IncDecMain {
  public static void main(String[] args) {
    Map<String, Object> text = new LinkedHashMap<>();
    text.put("v", "2");
    Map<String, Object> nil = new LinkedHashMap<>();
    nil.put("v", null);
    Map<String, Object> rows = new LinkedHashMap<>();
    rows.put("rows", List.of("Ada", "Bea"));
    System.out.print(new se.regionstockholm.intehrgrator.generated.ConversionScript().convert(null, Map.of()));
    System.out.print("\\n");
    System.out.print(HandlebarsSupport.handlebars(${JSON.stringify(STRING_TEMPLATE)}, text));
    System.out.print("\\n");
    System.out.print(HandlebarsSupport.handlebars("{{inc v}}|{{dec v}}", nil));
    System.out.print("\\n");
    System.out.print(HandlebarsSupport.handlebars(${JSON.stringify(ROW_TEMPLATE)}, rows));
  }
}
`;
}

async function javaAvailable(): Promise<boolean> {
  try {
    const out = await new Deno.Command("java", { args: ["-version"], stdout: "piped", stderr: "piped" }).output();
    return out.success || out.code === 0;
  } catch {
    return false;
  }
}

/** GitHub's default JDK is often older than 21; `--release 21` then errors instead of compiling. */
async function javacReleaseSupported(release: string): Promise<boolean> {
  try {
    const out = await new Deno.Command("javac", {
      args: ["--release", release, "-version"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = `${new TextDecoder().decode(out.stderr)}\n${new TextDecoder().decode(out.stdout)}`;
    if (/release version \d+ not supported/i.test(text)) return false;
    return out.success || out.code === 0;
  } catch {
    return false;
  }
}

const MAVEN = "https://repo1.maven.org/maven2";
const JARS = [
  "com/github/jknack/handlebars/4.4.0/handlebars-4.4.0.jar",
  "org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.jar",
  "org/apache/commons/commons-text/1.11.0/commons-text-1.11.0.jar",
  "org/slf4j/slf4j-api/2.0.12/slf4j-api-2.0.12.jar",
  "org/slf4j/slf4j-nop/2.0.12/slf4j-nop-2.0.12.jar",
  "com/fasterxml/jackson/core/jackson-databind/2.22.2/jackson-databind-2.22.2.jar",
  "com/fasterxml/jackson/core/jackson-core/2.22.2/jackson-core-2.22.2.jar",
  "com/fasterxml/jackson/core/jackson-annotations/2.22/jackson-annotations-2.22.jar",
];

async function fetchJars(dir: string): Promise<string[] | null> {
  const paths: string[] = [];
  for (const jar of JARS) {
    const file = jar.slice(jar.lastIndexOf("/") + 1);
    const dest = join(dir, file);
    try {
      const res = await fetch(`${MAVEN}/${jar}`);
      if (!res.ok) {
        console.warn(`skip Java inc/dec: HTTP ${res.status} for ${jar}`);
        return null;
      }
      await Deno.writeFile(dest, new Uint8Array(await res.arrayBuffer()));
      paths.push(dest);
    } catch (err) {
      console.warn(`skip Java inc/dec: failed to fetch ${jar}: ${err}`);
      return null;
    }
  }
  return paths;
}
