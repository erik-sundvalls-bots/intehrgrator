/**
 * openEHR locator compiler — BASE Architecture Overview “Paths and Locators”
 * and AQL node-id / name shortcuts.
 *
 * Seams: `parseLocator`, `compileAuthoringPath` (XML vs JSON),
 * `looksLikeOpenEhrLocator` (generic JSON `[1]` stays an index).
 */
import { assertEquals } from "@std/assert";
import fontoxpath from "fontoxpath";
import { DOMParser } from "slimdom";
import {
  compileAuthoringPath,
  compileLocatorToXmlXPath,
  looksLikeOpenEhrLocator,
  parseLocator,
} from "@intehrgrator/core/openehr/locator.ts";

Deno.test("looksLikeOpenEhrLocator distinguishes sugar from JSON indexes", () => {
  assertEquals(looksLikeOpenEhrLocator("$.vitals[1].systolic"), false);
  assertEquals(looksLikeOpenEhrLocator("$.measurements[*].pulse"), false);
  assertEquals(looksLikeOpenEhrLocator("/content[at0003]"), true);
  assertEquals(
    looksLikeOpenEhrLocator("/content[openEHR-EHR-ACTION.medication.v1]"),
    true,
  );
  assertEquals(looksLikeOpenEhrLocator("/data/events[at0001, 'standing']"), true);
  assertEquals(
    looksLikeOpenEhrLocator("tmpl//content/at0000/data/at0002"),
    true,
  );
});

Deno.test("compile XML shortcuts from BASE Architecture Overview", () => {
  assertEquals(
    compileLocatorToXmlXPath(parseLocator("/data/events[at0003]/data/items[at0025]/value/magnitude")),
    "/data/events[@archetype_node_id='at0003']/data/items[@archetype_node_id='at0025']/value/magnitude",
  );
  assertEquals(
    compileLocatorToXmlXPath(parseLocator("/data/events[at0001, 'standing']")),
    "/data/events[@archetype_node_id='at0001' and name/value='standing']",
  );
  assertEquals(
    compileLocatorToXmlXPath(
      parseLocator("/data/events[at0001 and name/value='standing']"),
    ),
    "/data/events[@archetype_node_id='at0001' and name/value='standing']",
  );
  assertEquals(
    compileLocatorToXmlXPath(
      parseLocator("/content[openEHR-EHR-OBSERVATION.blood_pressure.v1]"),
    ),
    "/content[@archetype_node_id='openEHR-EHR-OBSERVATION.blood_pressure.v1']",
  );
});

Deno.test("unique OPT content/at0000 folds to a node-id predicate", () => {
  assertEquals(
    compileAuthoringPath("/content/at0000/data/at0002", "xml"),
    "/content[@archetype_node_id='at0000']/data[@archetype_node_id='at0002']",
  );
  assertEquals(
    compileAuthoringPath("bp//content/at0000/data/at0001", "xml"),
    "/content[@archetype_node_id='at0000']/data[@archetype_node_id='at0001']",
  );
});

Deno.test("quoted JSON keys after an index are child steps", () => {
  assertEquals(
    compileAuthoringPath("$.status[1]['|value']", "json"),
    '$source?status?1?("|value")',
  );
  const source = {
    granskning: {
      övergripande_status: [{ "|value": "Har aldrig rökt" }],
    },
  };
  const query = compileAuthoringPath(
    "$.granskning.övergripande_status[1]['|value']",
    "json",
  );
  assertEquals(
    fontoxpath.evaluateXPathToString(query, null, null, { source }),
    "Har aldrig rökt",
  );
});

Deno.test("generic JSON index paths are unchanged in spirit", () => {
  assertEquals(
    compileAuthoringPath("$.vitals[1].systolic", "json"),
    "$source?vitals?1?systolic",
  );
  assertEquals(
    compileAuthoringPath('$["vitals/systolic|magnitude"]', "json"),
    '$source?("vitals/systolic|magnitude")',
  );
  assertEquals(compileAuthoringPath("$.items[0].name", "json"), "$source?items?1?name");
});

Deno.test("fontoxpath evaluates XML openEHR node-id predicates", () => {
  const xml = new DOMParser().parseFromString(
    `<composition>
      <content archetype_node_id="openEHR-EHR-OBSERVATION.pulse.v2">
        <data>
          <events archetype_node_id="at0003">
            <data>
              <items archetype_node_id="at0004">
                <value><magnitude>72</magnitude></value>
              </items>
            </data>
          </events>
        </data>
      </content>
      <content archetype_node_id="openEHR-EHR-OBSERVATION.body_temperature.v2">
        <data>
          <events archetype_node_id="at0003">
            <data>
              <items archetype_node_id="at0004">
                <value><magnitude>37.2</magnitude></value>
              </items>
            </data>
          </events>
        </data>
      </content>
    </composition>`,
    "application/xml",
  );
  const pulse = compileAuthoringPath(
    "content[openEHR-EHR-OBSERVATION.pulse.v2]/data/events[at0003]/data/items[at0004]/value/magnitude",
    "xml",
  );
  const temp = compileAuthoringPath(
    "content[openEHR-EHR-OBSERVATION.body_temperature.v2]/data/events[at0003]/data/items[at0004]/value/magnitude",
    "xml",
  );
  assertEquals(fontoxpath.evaluateXPathToString(pulse, xml.documentElement), "72");
  assertEquals(fontoxpath.evaluateXPathToString(temp, xml.documentElement), "37.2");
});

Deno.test("fontoxpath evaluates JSON map filters for Rate vs Temperature", () => {
  const source = {
    content: [
      {
        archetype_node_id: "openEHR-EHR-OBSERVATION.pulse.v2",
        data: {
          events: [{
            archetype_node_id: "at0003",
            data: {
              items: [{ archetype_node_id: "at0004", value: { magnitude: 72 } }],
            },
          }],
        },
      },
      {
        archetype_node_id: "openEHR-EHR-OBSERVATION.body_temperature.v2",
        data: {
          events: [{
            archetype_node_id: "at0003",
            data: {
              items: [{ archetype_node_id: "at0004", value: { magnitude: 37.2 } }],
            },
          }],
        },
      },
    ],
  };
  const pulse = compileAuthoringPath(
    "/content[openEHR-EHR-OBSERVATION.pulse.v2]/data/events[at0003]/data/items[at0004]/value/magnitude",
    "json",
  );
  const temp = compileAuthoringPath(
    "/content[openEHR-EHR-OBSERVATION.body_temperature.v2]/data/events[at0003]/data/items[at0004]/value/magnitude",
    "json",
  );
  assertEquals(fontoxpath.evaluateXPathToNumber(pulse, null, null, { source }), 72);
  assertEquals(fontoxpath.evaluateXPathToNumber(temp, null, null, { source }), 37.2);
});

Deno.test("name/value shortcut selects Organisationsnummer among at0003 siblings", () => {
  const source = {
    items: [
      { archetype_node_id: "at0003", name: { value: "Identifierare" }, value: { id: "HSA-1" } },
      { archetype_node_id: "at0003", name: { value: "Organisationsnummer" }, value: { id: "556000-0000" } },
    ],
  };
  const hsa = compileAuthoringPath("/items[at0003, 'Identifierare']/value/id", "json");
  const org = compileAuthoringPath("/items[at0003, 'Organisationsnummer']/value/id", "json");
  assertEquals(fontoxpath.evaluateXPathToString(hsa, null, null, { source }), "HSA-1");
  assertEquals(fontoxpath.evaluateXPathToString(org, null, null, { source }), "556000-0000");
});
