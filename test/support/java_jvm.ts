/**
 * Compile a generated Java ConversionScript with the runtime helpers and run it
 * on a list of source files. Shared by the all-languages tests (#386, #388).
 * Returns null when there is no javac 21 locally; on CI a JDK is required.
 */
import { dirname, fromFileUrl, join } from "@std/path";

const MAVEN = "https://repo1.maven.org/maven2";
const JAVA_JARS = [
  "com/github/jknack/handlebars/4.4.0/handlebars-4.4.0.jar",
  "org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.jar",
  "org/apache/commons/commons-text/1.11.0/commons-text-1.11.0.jar",
  "org/slf4j/slf4j-api/2.0.12/slf4j-api-2.0.12.jar",
  "org/slf4j/slf4j-nop/2.0.12/slf4j-nop-2.0.12.jar",
  "com/fasterxml/jackson/core/jackson-databind/2.22.2/jackson-databind-2.22.2.jar",
  "com/fasterxml/jackson/core/jackson-core/2.22.2/jackson-core-2.22.2.jar",
  "com/fasterxml/jackson/core/jackson-annotations/2.22/jackson-annotations-2.22.jar",
];

const root = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

export async function javac21(): Promise<boolean> {
  try {
    const out = await new Deno.Command("javac", { args: ["--release", "21", "-version"], stdout: "piped", stderr: "piped" })
      .output();
    return out.success;
  } catch {
    return false;
  }
}

/** True when the JVM test should run; throws on CI without a JDK. */
export async function requireJavaOrSkip(): Promise<boolean> {
  if (await javac21()) return true;
  if (Deno.env.get("CI") === "true") throw new Error("CI must provide javac 21 (actions/setup-java)");
  console.warn("skip: no javac 21 on PATH");
  return false;
}

let jarCache: Promise<string> | null = null;

/** Downloads the runtime jars once per test process; returns the classpath. */
export function javaClasspath(): Promise<string> {
  jarCache ??= (async () => {
    const dir = await Deno.makeTempDir({ prefix: "intehrgrator-java-lib-" });
    const paths: string[] = [];
    for (const jar of JAVA_JARS) {
      const dest = join(dir, jar.slice(jar.lastIndexOf("/") + 1));
      const res = await fetch(`${MAVEN}/${jar}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${jar}`);
      await Deno.writeFile(dest, new Uint8Array(await res.arrayBuffer()));
      paths.push(dest);
    }
    return paths.join(":");
  })();
  return jarCache;
}

const JAVA_MAIN = `import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import se.regionstockholm.intehrgrator.generated.ConversionScript;
import se.regionstockholm.intehrgrator.runtime.IntehrgratorRuntime.Sheet;

/** args: defaults.json sheets.json (source.json out.xml)... */
public class JvmMain {
  public static void main(String[] args) throws Exception {
    ObjectMapper json = new ObjectMapper();
    @SuppressWarnings("unchecked")
    Map<String, Object> defaults = json.readValue(Files.readString(Path.of(args[0])), Map.class);
    Map<String, Sheet> sheets = Sheet.mapFromJson(Files.readString(Path.of(args[1])));
    for (int i = 2; i + 1 < args.length; i += 2) {
      JsonNode source = json.readTree(Files.readString(Path.of(args[i])));
      Object out = new ConversionScript().convert(source, defaults, sheets);
      Files.writeString(Path.of(args[i + 1]), String.valueOf(out));
    }
  }
}
`;

/**
 * Compiles `javaCode` and runs it on every `sources` entry.
 * Returns the output text per source name.
 */
export async function runGeneratedJava(
  label: string,
  javaCode: string,
  defaults: Record<string, unknown>,
  sheets: unknown[],
  sources: Array<{ name: string; content: string }>,
): Promise<Map<string, string>> {
  const cp = await javaClasspath();
  const work = await Deno.makeTempDir({ prefix: `intehrgrator-java-${label.replace(/[^\w-]/g, "_")}-` });
  const runtimeDir = join(work, "src", "se", "regionstockholm", "intehrgrator", "runtime");
  const generatedDir = join(work, "src", "se", "regionstockholm", "intehrgrator", "generated");
  await Deno.mkdir(runtimeDir, { recursive: true });
  await Deno.mkdir(generatedDir, { recursive: true });
  const helperRoot = join(root, "src", "core", "codegen", "helpers", "java");
  for (const file of ["IntehrgratorRuntime.java", "HandlebarsSupport.java"]) {
    await Deno.copyFile(join(helperRoot, file), join(runtimeDir, file));
  }
  await Deno.writeTextFile(join(generatedDir, "ConversionScript.java"), javaCode);
  await Deno.writeTextFile(join(work, "src", "JvmMain.java"), JAVA_MAIN);
  await Deno.writeTextFile(join(work, "defaults.json"), JSON.stringify(defaults));
  await Deno.writeTextFile(join(work, "sheets.json"), JSON.stringify(sheets));
  const classes = join(work, "classes");
  const compiled = await new Deno.Command("javac", {
    args: [
      "--release", "21", "-nowarn", "-cp", cp, "-d", classes,
      join(runtimeDir, "IntehrgratorRuntime.java"),
      join(runtimeDir, "HandlebarsSupport.java"),
      join(generatedDir, "ConversionScript.java"),
      join(work, "src", "JvmMain.java"),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!compiled.success) throw new Error(`${label}: javac failed\n${new TextDecoder().decode(compiled.stderr)}`);
  const runArgs = [join(work, "defaults.json"), join(work, "sheets.json")];
  sources.forEach((s, i) => {
    Deno.writeTextFileSync(join(work, `${i}.source.json`), s.content);
    runArgs.push(join(work, `${i}.source.json`), join(work, `${i}.out.xml`));
  });
  const ran = await new Deno.Command("java", {
    args: ["-cp", `${classes}:${cp}`, "JvmMain", ...runArgs],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!ran.success) throw new Error(`${label}: java failed\n${new TextDecoder().decode(ran.stderr)}`);
  const out = new Map<string, string>();
  sources.forEach((s, i) => out.set(s.name, Deno.readTextFileSync(join(work, `${i}.out.xml`))));
  return out;
}
