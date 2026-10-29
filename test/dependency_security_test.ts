// Regression tests for the dependency security fixes in this PR.
// handlebars 4.7.10: GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f, GHSA-xw65-4hp5-5hc7
// fast-xml-parser 5.x: GHSA-gh4j-gqv2-49f6
import { assert, assertEquals, assertFalse } from "@std/assert";
import Handlebars from "handlebars";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import {
  precompileHandlebars,
  renderHandlebars,
} from "../src/core/output/handlebars_dialect.ts";

Deno.test("handlebars is at least 4.7.10", () => {
  const [major, minor, patch] = Handlebars.VERSION.split(".").map(Number);
  assert(
    major > 4 || (major === 4 && (minor > 7 || (minor === 7 && patch >= 10))),
    `handlebars ${Handlebars.VERSION} is affected by GHSA-8r5x-fm3f-whwj / GHSA-p8wg-vrv2-v86f`,
  );
});

Deno.test("GHSA-xw65-4hp5-5hc7: precompiled output does not contain a literal </script>", () => {
  const out = precompileHandlebars(
    'safe</script><script>alert("XSS")</script><script>',
  );
  assertFalse(out.toLowerCase().includes("</script>"));
});

Deno.test("GHSA-8r5x-fm3f-whwj: a crafted AST cannot inject code via blockParams.length", () => {
  const g = globalThis as { __hbsInjected?: boolean };
  delete g.__hbsInjected;
  const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
  const ast = {
    type: "Program",
    loc,
    body: [{
      type: "BlockStatement",
      path: {
        type: "PathExpression",
        data: false,
        depth: 0,
        parts: ["missingHelper"],
        original: "missingHelper",
        loc,
      },
      params: [],
      program: {
        type: "Program",
        blockParams: {
          length: "(()=>{globalThis.__hbsInjected=true;return 0})()",
        },
        body: [],
        loc,
      },
      openStrip: { open: false, close: false },
      closeStrip: { open: false, close: false },
      loc,
    }],
  };
  try {
    // deno-lint-ignore no-explicit-any
    Handlebars.compile(ast as any)({});
  } catch {
    // Rejecting the AST is the expected fixed behaviour.
  }
  assertFalse(g.__hbsInjected === true, "injected code ran");
  delete g.__hbsInjected;
});

Deno.test("existing Kintegrate Handlebars rendering still works after the upgrade", () => {
  assertEquals(
    renderHandlebars("Hello {{name}}", { name: "<b>" }),
    "Hello <b>",
  );
});

Deno.test("GHSA-gh4j-gqv2-49f6: XMLBuilder neutralises comment and CDATA delimiters", () => {
  const builder = new XMLBuilder({
    commentPropName: "#comment",
    cdataPropName: "#cdata",
  });
  const xml = builder.build({
    root: { "#comment": "--><evil/><!--", "#cdata": "x]]><evil/>" },
  });
  // Parsing the result back must not yield an injected <evil> element.
  const parsed = new XMLParser({
    commentPropName: "#comment",
    cdataPropName: "#cdata",
  }).parse(xml);
  assertFalse("evil" in parsed.root, `injection in ${xml}`);
});
