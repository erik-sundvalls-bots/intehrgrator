import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  addUserPrompts,
  BUILT_IN_PROMPTS,
  exportUserPrompts,
  FOR_EACH_PROMPT_TEXT,
  listStoredPrompts,
  loadUserPrompts,
  parsePromptFile,
  removeUserPrompt,
} from "@intehrgrator/core/ai/stored_prompts.ts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

Deno.test("stored prompts: built-ins are Map the whole project and for-each (no Refresh merge)", () => {
  const ids = BUILT_IN_PROMPTS.map((p) => p.id);
  assertEquals(ids, ["builtin:map-project", "builtin:for-each"]);
  assert(FOR_EACH_PROMPT_TEXT.includes("{source_node}") && FOR_EACH_PROMPT_TEXT.includes("{target_node}"));
  assert(BUILT_IN_PROMPTS.every((p) => p.builtIn));
});

Deno.test("stored prompts: add, list, replace by name, remove", () => {
  const storage = memoryStorage();
  addUserPrompts(storage, [{ name: "A", text: "one" }, { name: "B", text: "two" }]);
  addUserPrompts(storage, [{ name: "A", text: "uno" }]);
  const user = loadUserPrompts(storage);
  assertEquals(user.map((p) => [p.name, p.text]), [["A", "uno"], ["B", "two"]]);
  assertEquals(listStoredPrompts(storage).length, BUILT_IN_PROMPTS.length + 2);
  assert(removeUserPrompt(storage, user[0]!.id));
  assertEquals(loadUserPrompts(storage).map((p) => p.name), ["B"]);
});

Deno.test("stored prompts: built-ins cannot be removed", () => {
  const storage = memoryStorage();
  assertEquals(removeUserPrompt(storage, "builtin:for-each"), false);
  assertEquals(listStoredPrompts(storage).length, BUILT_IN_PROMPTS.length);
});

Deno.test("stored prompts: parse .md/.txt as one prompt named after the file", () => {
  assertEquals(parsePromptFile("prompts/Loop helper.md", "  Do the loop  \n"), [
    { name: "Loop helper", text: "Do the loop" },
  ]);
  assertEquals(parsePromptFile("https://example.org/p/x.txt?raw=1", "hi"), [{ name: "x", text: "hi" }]);
});

Deno.test("stored prompts: parse .json lists and exported files", () => {
  const list = parsePromptFile("p.json", JSON.stringify([{ name: "A", text: "a" }, { name: "", text: "skip" }]));
  assertEquals(list, [{ name: "A", text: "a" }]);
  const storage = memoryStorage();
  addUserPrompts(storage, [{ name: "X", text: "x" }]);
  const exported = exportUserPrompts(storage);
  assertEquals(parsePromptFile("export.json", exported), [{ name: "X", text: "x" }]);
  assertThrows(() => parsePromptFile("bad.json", "{nope"));
  assertThrows(() => parsePromptFile("empty.json", "[]"));
});

Deno.test("stored prompts: corrupt storage reads as empty", () => {
  const storage = memoryStorage();
  storage.setItem("intehrgrator.ai.storedPrompts", "{not json");
  assertEquals(loadUserPrompts(storage), []);
});
