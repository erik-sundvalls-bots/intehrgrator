import { join, toFileUrl } from "@std/path";
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as enMsg from "blockly/msg/en";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import {
  extractFunctionBundle,
  listWorkspaceFunctions,
  mergeFunctionBundle,
  mergeFunctionBundleIntoState,
} from "@intehrgrator/blockly/function_bundle.ts";
import {
  buildGrammaticalJoinBundle,
  GRAMMATICAL_JOIN_SPECS,
  JOIN_OXFORD_SPEC,
  JOIN_SWEDISH_SPEC,
} from "@intehrgrator/blockly/grammatical_join.ts";
import {
  applyClashPolicy,
  functionBundleClashes,
  functionContributionIssue,
  functionContributionWebUrl,
  GITHUB_LOGIN_URL,
  GITHUB_SIGNUP_URL,
  loadFunctionLibraryCatalog,
  loadFunctionLibraryEntry,
  parseFunctionBundle,
  parseFunctionLibraryCatalog,
  serializeFunctionBundle,
  submitFunctionContribution,
} from "@intehrgrator/core/function_library/mod.ts";
import { evaluateDecisionTable } from "@intehrgrator/core/sheets/mod.ts";
import { mockGithubFetch } from "./github_mock.ts";

let ready = false;
function ensure(): void {
  if (ready) return;
  const anyMod = enMsg as { default?: Record<string, string> } & Record<string, string>;
  const table = anyMod.default && typeof anyMod.default === "object" ? anyMod.default : anyMod;
  Blockly.setLocale(table);
  initBlocklyGenerators();
  ready = true;
}

function hasBlockType(state: unknown, type: string): boolean {
  return new RegExp(`"type"\\s*:\\s*"${type}"`).test(JSON.stringify(state));
}

Deno.test("parseFunctionBundle requires kind, version, name, and a matching definition", () => {
  assertThrows(() => parseFunctionBundle("{}"), Error, "kind");
  assertThrows(
    () =>
      parseFunctionBundle(JSON.stringify({
        kind: "intehrgrator-function",
        version: 1,
        name: "join_swedish",
        description: "x",
        parameters: ["names"],
        decisionTables: [],
        blocklyState: { blocks: { blocks: [] } },
        sheets: [],
      })),
    Error,
    "no definition",
  );
});

Deno.test("function catalog parses relative file URIs", () => {
  const catalog = parseFunctionLibraryCatalog(
    JSON.stringify({
      version: 1,
      functions: [{
        id: "join_swedish",
        name: "join_swedish",
        title: "Swedish list join",
        description: "A, B och C",
        file: "join_swedish.intehr-function.json",
        locale: "sv",
        parameters: ["names"],
        decisionTables: ["JoinNames"],
      }],
    }),
    "https://github.com/regionstockholm/intehrgrator/blob/main/function-library/catalog.json",
  );
  assertEquals(catalog.functions.length, 1);
  assertEquals(
    catalog.functions[0]?.file,
    "https://raw.githubusercontent.com/regionstockholm/intehrgrator/main/function-library/join_swedish.intehr-function.json",
  );
});

Deno.test("Contribute refuses an empty description and prefills a GitHub issue URL", () => {
  ensure();
  const bundle = buildGrammaticalJoinBundle(JOIN_SWEDISH_SPEC);
  assertThrows(() => functionContributionIssue(bundle, "  "), Error, "description");
  const issue = functionContributionIssue(bundle, "Swedish grammatical list join");
  assert(issue.body.includes("Swedish grammatical list join"));
  assert(issue.body.includes("join_swedish_words"));
  assert(issue.body.includes("SweJoinWords"));
  if (!issue.truncated) assert(issue.body.includes("intehrgrator-function"));
  const url = functionContributionWebUrl(bundle, "Swedish grammatical list join");
  assert(url.startsWith("https://github.com/regionstockholm/intehrgrator/issues/new?"));
  assert(url.includes("Function"));
  const params = new URL(url).searchParams;
  assert(params.get("body")?.includes("Swedish grammatical list join"));
  assertEquals(GITHUB_SIGNUP_URL, "https://github.com/signup");
  assertEquals(GITHUB_LOGIN_URL, "https://github.com/login");
});

Deno.test("Contribute uses the GitHub API when a token is present", async () => {
  ensure();
  const bundle = buildGrammaticalJoinBundle(JOIN_OXFORD_SPEC);
  const result = await submitFunctionContribution(bundle, "Oxford comma join", {
    githubToken: "gho_test",
    fetch: (input, init) => {
      assertEquals(String(input), "https://api.github.com/repos/regionstockholm/intehrgrator/issues");
      assertEquals((init as RequestInit).method, "POST");
      const body = JSON.parse(String((init as RequestInit).body)) as {
        title: string;
        body: string;
      };
      assertEquals(body.title, "Function library: join_oxford");
      assert(body.body.includes("Oxford comma join"));
      assert(body.body.includes("JoinOxford"));
      return new Response(JSON.stringify({ html_url: "https://github.com/regionstockholm/intehrgrator/issues/999" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assertEquals(result.via, "api");
  assertEquals(result.htmlUrl, "https://github.com/regionstockholm/intehrgrator/issues/999");
});

Deno.test("GitHub Function library catalog loads entry JSON", async () => {
  ensure();
  const bundle = buildGrammaticalJoinBundle(JOIN_SWEDISH_SPEC);
  const files = {
    "function-library/catalog.json": JSON.stringify({
      version: 1,
      functions: [{
        id: "join_swedish",
        name: "join_swedish",
        title: "Swedish list join",
        description: bundle.description,
        file: "join_swedish.intehr-function.json",
      }],
    }),
    "function-library/join_swedish.intehr-function.json": serializeFunctionBundle(bundle),
  };
  const catalog = await loadFunctionLibraryCatalog(
    "https://github.com/org/repo/blob/main/function-library/catalog.json",
    { fetch: mockGithubFetch(files) },
  );
  assertEquals(catalog.functions[0]?.id, "join_swedish");
  const loaded = await loadFunctionLibraryEntry(catalog, "join_swedish", {
    fetch: mockGithubFetch(files),
  });
  assertEquals(loaded.name, "join_swedish_words");
  assertEquals(loaded.sheets[0]?.name, "SweJoinWords");
});

Deno.test("extract + merge round-trip keeps argument slots and JoinNames", () => {
  ensure();
  const source = new Blockly.Workspace();
  const bundle = buildGrammaticalJoinBundle(JOIN_SWEDISH_SPEC);
  source.dispose();
  assertEquals(bundle.parameters, ["list_of_words"]);
  assertEquals(bundle.decisionTables, ["SweJoinWords"]);
  assertEquals(bundle.sheets[0]?.name, "SweJoinWords");

  const target = new Blockly.Workspace();
  const other = target.newBlock("text");
  other.setFieldValue("keep-me", "TEXT");
  const merged = mergeFunctionBundle(target, bundle, { clash: "rename", sheets: [] });
  assertEquals(merged.name, "join_swedish_words");
  const defs = target.getTopBlocks(false).filter((b) => b.type === "procedures_defreturn");
  assertEquals(defs.length, 1);
  assertEquals(defs[0]?.getFieldValue("NAME"), "join_swedish_words");
  const keep = target.getAllBlocks(false).find((b) =>
    b.type === "text" && b.getFieldValue("TEXT") === "keep-me"
  );
  assert(keep, "unrelated blocks stay");

  const call = Blockly.serialization.blocks.append({
    type: "procedures_callreturn",
    extraState: { name: "join_swedish_words", params: ["list_of_words"] },
  }, target) as Blockly.Block;
  assert(call.getInput("ARG0"), "call site keeps the names argument slot");
  assertEquals(merged.sheets[0]?.values[2]?.[2], " och {{word}}");
  target.dispose();
});

Deno.test("name-clash rename keeps the existing Function and Decision table", () => {
  ensure();
  const first = buildGrammaticalJoinBundle(JOIN_SWEDISH_SPEC);
  const workspace = new Blockly.Workspace();
  mergeFunctionBundle(workspace, first, { clash: "rename", sheets: first.sheets });
  const clash = functionBundleClashes(
    Blockly.serialization.workspaces.save(workspace),
    first.sheets,
    first,
  );
  assertEquals(clash.functions, ["join_swedish_words"]);
  assertEquals(clash.sheets, ["SweJoinWords"]);
  const renamed = applyClashPolicy(
    Blockly.serialization.workspaces.save(workspace),
    first.sheets,
    first,
    "rename",
  );
  assertEquals(renamed.bundle.name, "join_swedish_words2");
  assertEquals(renamed.bundle.sheets[0]?.name, "SweJoinWords2");
  const merged = mergeFunctionBundle(workspace, first, {
    clash: "rename",
    sheets: first.sheets,
  });
  assertEquals(merged.name, "join_swedish_words2");
  const names = workspace.getTopBlocks(false)
    .filter((b) => b.type === "procedures_defreturn")
    .map((b) => String(b.getFieldValue("NAME")));
  assertEquals(names.sort(), ["join_swedish_words", "join_swedish_words2"]);
  workspace.dispose();
});

Deno.test("Oxford starter uses serial-comma last snippet, not join_list", () => {
  ensure();
  const bundle = buildGrammaticalJoinBundle(JOIN_OXFORD_SPEC);
  assertEquals(bundle.name, "join_oxford");
  assertEquals(bundle.locale, "en");
  assertEquals(bundle.sheets[0]?.name, "JoinOxford");
  const parsed = parseFunctionBundle(serializeFunctionBundle(bundle));
  assertEquals(parsed.parameters, ["names"]);
  const table = parsed.sheets[0]!;
  assertEquals(
    evaluateDecisionTable(table, { first: true, last: true, name: "A" }, "snippet"),
    "A",
  );
  assertEquals(
    evaluateDecisionTable(table, { first: false, last: false, name: "B" }, "snippet"),
    ", B",
  );
  assertEquals(
    evaluateDecisionTable(table, { first: false, last: true, name: "C" }, "snippet"),
    ", and C",
  );
  const workspace = new Blockly.Workspace();
  mergeFunctionBundle(workspace, bundle, { clash: "rename", sheets: [] });
  const names = workspace.getTopBlocks(false)
    .filter((b) => b.type === "procedures_defreturn")
    .map((b) => String(b.getFieldValue("NAME")));
  assertEquals(names, ["join_oxford"]);
  assertEquals(hasBlockType(bundle.blocklyState, "join_list"), false);
  workspace.dispose();
});

Deno.test("every grammatical-join spec has a description and Decision table", () => {
  ensure();
  for (const spec of GRAMMATICAL_JOIN_SPECS) {
    const bundle = buildGrammaticalJoinBundle(spec);
    assert(bundle.description.length > 20, spec.id);
    assertEquals(bundle.parameters, [spec.paramName ?? "names"]);
    assertEquals(bundle.sheets.length, 1);
    assertEquals(bundle.sheets[0]?.kind, "decision-table");
    assertEquals(bundle.sheets[0]?.hitPolicy, "FIRST");
  }
});

Deno.test("loadFunctionLibraryEntry rejects unknown ids", async () => {
  const catalog = parseFunctionLibraryCatalog(
    JSON.stringify({
      version: 1,
      functions: [{
        id: "join_swedish",
        name: "join_swedish",
        title: "Swedish",
        description: "x",
        file: "join_swedish.intehr-function.json",
      }],
    }),
    "https://example.test/function-library/catalog.json",
  );
  await assertRejects(
    () => loadFunctionLibraryEntry(catalog, "nope"),
    Error,
    "Unknown Function library id",
  );
});

Deno.test("name-clash replace overwrites the existing Function and Decision table", () => {
  ensure();
  const first = buildGrammaticalJoinBundle(JOIN_SWEDISH_SPEC);
  const workspace = new Blockly.Workspace();
  mergeFunctionBundle(workspace, first, { clash: "rename", sheets: first.sheets });
  const tweaked = structuredClone(first) as typeof first;
  tweaked.description = "replacement";
  const merged = mergeFunctionBundle(workspace, tweaked, {
    clash: "replace",
    sheets: first.sheets,
  });
  assertEquals(merged.name, "join_swedish_words");
  const names = workspace.getTopBlocks(false)
    .filter((b) => b.type === "procedures_defreturn")
    .map((b) => String(b.getFieldValue("NAME")));
  assertEquals(names, ["join_swedish_words"]);
  workspace.dispose();
});

Deno.test("mergeFunctionBundleIntoState keeps unrelated blocks", () => {
  ensure();
  const source = new Blockly.Workspace();
  const keep = source.newBlock("text");
  keep.setFieldValue("keep-me", "TEXT");
  const state = Blockly.serialization.workspaces.save(source);
  source.dispose();
  const bundle = buildGrammaticalJoinBundle(JOIN_OXFORD_SPEC);
  const merged = mergeFunctionBundleIntoState(state, [], bundle, "rename");
  const workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    merged.blocklyState as Record<string, unknown>,
    workspace,
  );
  const names = workspace.getTopBlocks(false)
    .filter((b) => b.type === "procedures_defreturn")
    .map((b) => String(b.getFieldValue("NAME")));
  assertEquals(names, ["join_oxford"]);
  const kept = workspace.getAllBlocks(false).find((b) =>
    b.type === "text" && b.getFieldValue("TEXT") === "keep-me"
  );
  assert(kept, "unrelated blocks stay");
  workspace.dispose();
});

Deno.test("shipped Function library starters parse without join_list", async () => {
  const catalogPath = join(import.meta.dirname!, "..", "function-library", "catalog.json");
  const catalogUrl = toFileUrl(catalogPath).href;
  const catalog = parseFunctionLibraryCatalog(await Deno.readTextFile(catalogPath), catalogUrl);
  assertEquals(catalog.functions.map((row) => row.id).sort(), ["coded_text_from_sheet", "join_oxford", "join_swedish"]);
  for (const entry of catalog.functions) {
    const loaded = await loadFunctionLibraryEntry(catalog, entry.id);
    assertEquals(loaded.name, entry.name);
    assert(loaded.description.length > 20);
    assertEquals(hasBlockType(loaded.blocklyState, "join_list"), false);
    if (entry.id !== "coded_text_from_sheet") assertEquals(loaded.sheets[0]?.kind, "decision-table");
    else assertEquals(loaded.sheets, []);
    assertEquals(loaded.hasReturn, true);
  }
});

function appendProcedure(
  workspace: Blockly.Workspace,
  type: "procedures_defreturn" | "procedures_defnoreturn",
  name: string,
  param: string,
): Blockly.Block {
  const paramId = `${name}_${param}`;
  workspace.createVariable(param, "", paramId);
  return Blockly.serialization.blocks.append({
    type,
    fields: { NAME: name },
    extraState: {
      params: [{ name: param, id: paramId }],
      hasStatements: true,
    },
  }, workspace) as Blockly.Block;
}

Deno.test("statement Function (procedures_defnoreturn) extracts, lists, and keeps call argument slots", () => {
  ensure();
  const source = new Blockly.Workspace();
  const def = appendProcedure(source, "procedures_defnoreturn", "say", "msg");
  (def as { setStatements_?: (v: boolean) => void }).setStatements_?.(true);
  const inner = source.newBlock("controls_if");
  const stack = def.getInput("STACK") ?? def.getInput("STACK0");
  assert(stack?.connection, "statement Function has a STACK");
  stack.connection.connect(inner.previousConnection!);

  const listed = listWorkspaceFunctions(source);
  assertEquals(listed, [{ name: "say", parameters: ["msg"], hasReturn: false }]);

  const bundle = extractFunctionBundle(source, "say", [], { description: "log a message" });
  source.dispose();
  assertEquals(bundle.hasReturn, false);
  assertEquals(bundle.returns, undefined);
  assertEquals(bundle.parameters, ["msg"]);
  assertEquals(hasBlockType(bundle.blocklyState, "procedures_defnoreturn"), true);
  assertEquals(hasBlockType(bundle.blocklyState, "procedures_defreturn"), false);
  const parsed = parseFunctionBundle(serializeFunctionBundle(bundle));
  assertEquals(parsed.hasReturn, false);

  const target = new Blockly.Workspace();
  mergeFunctionBundle(target, bundle, { clash: "rename", sheets: [] });
  const names = target.getTopBlocks(false)
    .filter((b) => b.type === "procedures_defnoreturn")
    .map((b) => String(b.getFieldValue("NAME")));
  assertEquals(names, ["say"]);
  const call = Blockly.serialization.blocks.append({
    type: "procedures_callnoreturn",
    extraState: { name: "say", params: ["msg"] },
  }, target) as Blockly.Block;
  assert(call.getInput("ARG0"), "callnoreturn keeps the msg argument slot");
  target.dispose();
});

Deno.test("value Function round-trips procedures_ifreturn in the body", () => {
  ensure();
  const source = new Blockly.Workspace();
  const def = appendProcedure(source, "procedures_defreturn", "maybe", "flag");
  (def as { setStatements_?: (v: boolean) => void }).setStatements_?.(true);
  const ifret = source.newBlock("procedures_ifreturn");
  const stack = def.getInput("STACK") ?? def.getInput("STACK0");
  assert(stack?.connection, "value Function has a STACK");
  stack.connection.connect(ifret.previousConnection!);
  const cond = source.newBlock("logic_boolean");
  cond.setFieldValue("TRUE", "BOOL");
  ifret.getInput("CONDITION")!.connection!.connect(cond.outputConnection!);
  const early = source.newBlock("text");
  early.setFieldValue("early", "TEXT");
  const valueInput = ifret.getInput("VALUE");
  if (valueInput?.connection && early.outputConnection) {
    valueInput.connection.connect(early.outputConnection);
  }
  const late = source.newBlock("text");
  late.setFieldValue("late", "TEXT");
  const ret = def.getInput("RETURN") ?? def.getInput("VALUE");
  ret!.connection!.connect(late.outputConnection!);

  const bundle = extractFunctionBundle(source, "maybe", []);
  source.dispose();
  assertEquals(bundle.hasReturn, true);
  assertEquals(hasBlockType(bundle.blocklyState, "procedures_ifreturn"), true);
  assertEquals(hasBlockType(bundle.blocklyState, "procedures_defreturn"), true);

  const target = new Blockly.Workspace();
  mergeFunctionBundle(target, bundle, { clash: "rename", sheets: [] });
  const restored = target.getAllBlocks(false).find((b) => b.type === "procedures_ifreturn");
  assert(restored, "if return is still inside the loaded Function");
  assertEquals(listWorkspaceFunctions(target)[0]?.hasReturn, true);
  target.dispose();
});

Deno.test("statement Function round-trips procedures_ifreturn without a value socket", () => {
  ensure();
  const source = new Blockly.Workspace();
  const def = appendProcedure(source, "procedures_defnoreturn", "bail", "flag");
  (def as { setStatements_?: (v: boolean) => void }).setStatements_?.(true);
  const ifret = source.newBlock("procedures_ifreturn");
  const stack = def.getInput("STACK") ?? def.getInput("STACK0");
  assert(stack?.connection, "statement Function has a STACK");
  stack.connection.connect(ifret.previousConnection!);
  const cond = source.newBlock("logic_boolean");
  cond.setFieldValue("TRUE", "BOOL");
  ifret.getInput("CONDITION")!.connection!.connect(cond.outputConnection!);

  const bundle = extractFunctionBundle(source, "bail", []);
  source.dispose();
  assertEquals(bundle.hasReturn, false);
  assertEquals(hasBlockType(bundle.blocklyState, "procedures_ifreturn"), true);
  assertEquals(hasBlockType(bundle.blocklyState, "procedures_defnoreturn"), true);

  const target = new Blockly.Workspace();
  mergeFunctionBundle(target, bundle, { clash: "rename", sheets: [] });
  assert(target.getAllBlocks(false).some((b) => b.type === "procedures_ifreturn"));
  assertEquals(listWorkspaceFunctions(target), [{
    name: "bail",
    parameters: ["flag"],
    hasReturn: false,
  }]);
  target.dispose();
});
