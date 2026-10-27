import { assertEquals } from "@std/assert";
import {
  aiContextLanguages,
  codesetLanguageName,
  detectSourceLanguages,
  displayLanguage,
  isKnownLanguage,
  normalizeLangCode,
  orderTargetLanguages,
  parseLanguageList,
  sameLanguage,
} from "@intehrgrator/core/languages.ts";

Deno.test("codes: normalise, validate against ISO_639-1, region subtags, names", () => {
  assertEquals(normalizeLangCode("EN_gb"), "en-GB");
  assertEquals(isKnownLanguage("SV"), true);
  assertEquals(isKnownLanguage("en-GB"), true);
  assertEquals(isKnownLanguage("sv-FI"), true, "region on a known base");
  assertEquals(isKnownLanguage("xx"), false);
  assertEquals(codesetLanguageName("sv"), "Swedish");
  assertEquals(sameLanguage("en-GB", "en"), true);
  assertEquals(sameLanguage("en", "sv"), false);
  assertEquals(parseLanguageList("sv, EN-gb; sv de"), ["sv", "en-GB", "de"]);
});

Deno.test("source languages: xml:lang by frequency (root first on ties), x-lang, x-i18n", () => {
  assertEquals(detectSourceLanguages([{ format: "xml", content: '<a xml:lang="sv"><b xml:lang="en"/><c xml:lang="en"/></a>' }]), ["en", "sv"]);
  assertEquals(detectSourceLanguages([{ format: "xml", content: '<a xml:lang="sv"><b xml:lang="en"/></a>' }]), ["sv", "en"]);
  assertEquals(
    detectSourceLanguages([{ format: "json", content: JSON.stringify({ "x-lang": "en", properties: { a: { "x-i18n": { sv: {} } } } }) }]),
    ["en", "sv"],
  );
  assertEquals(detectSourceLanguages([{ format: "json", content: "{}" }]), []);
});

Deno.test("target.lang.N ordering: the #277 examples table", () => {
  const t = ["en", "sv"]; // SDV-like, original en
  assertEquals(orderTargetLanguages(t, "en", ["sv", "en"], "en"), ["sv", "en"]);
  assertEquals(orderTargetLanguages(t, "en", ["en"], "sv"), ["en", "sv"]);
  assertEquals(orderTargetLanguages(t, "en", [], "sv"), ["sv", "en"], "unknown source: UI tie-breaker");
  assertEquals(orderTargetLanguages(t, "en", ["de"], "en"), ["en", "sv"]);
  assertEquals(orderTargetLanguages(["en-GB", "sv"], "sv", ["en"], "sv"), ["en-GB", "sv"], "region matches base");
  // Sent to the AI (matched): lang.1 plus target languages that match a source language.
  assertEquals(aiContextLanguages("matched", ["sv", "en"], ["sv", "en"]), ["sv", "en"]);
  assertEquals(aiContextLanguages("matched", ["en", "sv"], ["en"]), ["en"]);
  assertEquals(aiContextLanguages("matched", ["sv", "en"], []), ["sv"]);
  assertEquals(aiContextLanguages("matched", ["en", "sv"], ["de"]), ["en"]);
  assertEquals(aiContextLanguages("lang1", ["sv", "en"], ["sv", "en"]), ["sv"]);
  assertEquals(aiContextLanguages("all", ["en", "sv"], []), ["en", "sv"]);
});

Deno.test("UI language alone does not change the order when a source language matches", () => {
  assertEquals(orderTargetLanguages(["en", "sv"], "en", ["en"], "sv"), orderTargetLanguages(["en", "sv"], "en", ["en"], "en"));
});

Deno.test("display language: saved choice when available, else lang.1", () => {
  assertEquals(displayLanguage("sv", ["en", "sv"]), "sv");
  assertEquals(displayLanguage("de", ["en", "sv"]), "en");
  assertEquals(displayLanguage(undefined, ["en", "sv"]), "en");
  assertEquals(displayLanguage("en", ["en-GB", "sv"]), "en-GB");
});
