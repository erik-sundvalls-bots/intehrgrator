import { assertEquals, assert, assertExists, assertFalse } from "@std/assert";
import { join } from "@std/path";
import {
  bindDefaultPoints,
  createMemoryDefaultsCatalog,
  DEFAULTS_MAP_NAME,
  FACTORY_ENCODING,
  FACTORY_HEALTH_CARE_FACILITY,
  FACTORY_TIME,
  FACTORY_TERRITORY,
  DEFAULT_CONTEXT_MAP_TYPE,
  entriesFromScaffoldTargetList,
  factoryDefaultsEntries,
  mapBlockFromDefaultsJson,
  mapsGetExpression,
  namedMapsFromBlocklyState,
} from "@intehrgrator/core/defaults/mod.ts";
import { evaluate, createSourceContext } from "@intehrgrator/core/source/query_runtime.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { applyExpressionEdit, createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { parseExpression, serialize } from "@intehrgrator/core/expression/mod.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { registerRmBlocks } from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { registerMapBlocks } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import { loadSkeletonIntoWorkspace } from "@intehrgrator/blockly/skeleton_loader.ts";
import { relabelWorkspaceFromSkeleton } from "@intehrgrator/blockly/block_labels.ts";
import {
  applyDefaultContextMap,
  ensureDefaultsBlock,
  findDefaultsBlock,
  hydrateDefaultsMapArgument,
} from "@intehrgrator/blockly/defaults_canvas.ts";
import { createSourceQueryBlock } from "@intehrgrator/blockly/source_query.ts";
import { initBlocklyGenerators, workspaceToModelJson } from "@intehrgrator/blockly/mod.ts";
import {
  optionalRmInputName,
  rmAttributeInputName,
} from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { projectBlocklyState } from "@intehrgrator/workbench/mapping_spec/mod.ts";
import { scaffoldBlocklyFromSkeleton } from "@intehrgrator/workbench/blockly_sync.ts";

const opt = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
);

Deno.test("factory default context map seeds UI language once and dummy facility", () => {
  const entries = factoryDefaultsEntries("sv");
  const byKey = Object.fromEntries(entries.map((entry) => [entry.runtimeKey, entry]));
  assertEquals(byKey["language"]?.value, "sv");
  assertEquals(byKey["language"]?.scaffoldTargets, ["*.language"]);
  assertEquals(byKey["territory"]?.value, FACTORY_TERRITORY);
  assertEquals(byKey["territory"]?.scaffoldTargets, ["COMPOSITION.territory"]);
  assertEquals(byKey["encoding"]?.value, FACTORY_ENCODING);
  assertEquals(byKey["start_time"]?.value, FACTORY_TIME);
  assertEquals(byKey["origin"]?.value, FACTORY_TIME);
  assertEquals(byKey["time"]?.value, FACTORY_TIME);
  assertEquals(byKey["composer"]?.value, "Dr. Who Demo");
  assertEquals(byKey["facility"]?.value, FACTORY_HEALTH_CARE_FACILITY);
  assertEquals(byKey["facility"]?.scaffoldTargets, ["EVENT_CONTEXT.health_care_facility"]);
  assertEquals(byKey["subject"]?.value, "PARTY_SELF");
  assertEquals(factoryDefaultsEntries("de").find((e) => e.runtimeKey === "language")?.value, "de");
});

Deno.test("namedMapsFromBlocklyState reads field keys and value sockets", () => {
  const state = {
    blocks: {
      blocks: [
        {
          type: DEFAULT_CONTEXT_MAP_TYPE,
          extraState: { itemCount: 2, targets: [[], []] },
          fields: { KEY0: "language", KEY1: "territory" },
          inputs: {
            VAL0: { shadow: { type: "text", fields: { TEXT: "sv" } } },
            VAL1: { shadow: { type: "text", fields: { TEXT: "SE" } } },
          },
        },
      ],
    },
  };
  const maps = namedMapsFromBlocklyState(state);
  assertEquals(maps[DEFAULTS_MAP_NAME]?.language, "sv");
  assertEquals(maps[DEFAULTS_MAP_NAME]?.territory, "SE");
});

Deno.test("namedMapsFromBlocklyState reads term_pick codes from Defaults Map values", () => {
  const maps = namedMapsFromBlocklyState({
    blocks: {
      blocks: [
        {
          type: DEFAULT_CONTEXT_MAP_TYPE,
          extraState: { itemCount: 1, targets: [["*.language"]] },
          fields: { KEY0: "language" },
          inputs: {
            VAL0: {
              shadow: {
                type: "term_pick",
                fields: { SET: "ISO_639-1", CODE: "sv" },
              },
            },
          },
        },
      ],
    },
  });
  assertEquals(maps[DEFAULTS_MAP_NAME]?.language, "sv");
});

Deno.test("mapBlockFromDefaultsJson converts maps_create_with / workspace to a default context map", () => {
  const block = { type: "maps_create_with", extraState: { itemCount: 0 } };
  const converted = mapBlockFromDefaultsJson(block) as { type?: string };
  assertEquals(converted?.type, DEFAULT_CONTEXT_MAP_TYPE);
  const wrapped = {
    blocks: { blocks: [{ type: "defaults_block", inputs: { MAP: { block } } }] },
  };
  assertEquals((mapBlockFromDefaultsJson(wrapped) as { type?: string })?.type, DEFAULT_CONTEXT_MAP_TYPE);
  assertEquals(mapBlockFromDefaultsJson({ nested: { x: 1 } }), null);
  const fromPlain = mapBlockFromDefaultsJson({ Time: "20250101000000", PatientId: "194002287086" }) as {
    type?: string;
    extraState?: { itemCount?: number };
    fields?: Record<string, string>;
  };
  assertEquals(fromPlain?.type, DEFAULT_CONTEXT_MAP_TYPE);
  assertEquals(fromPlain?.extraState?.itemCount, 2);
  assertEquals(fromPlain?.fields?.KEY0, "Time");
  assertEquals(fromPlain?.fields?.KEY1, "PatientId");
});

Deno.test("maps_get evaluates against namedMaps on SourceContext", () => {
  const ctx = createSourceContext("{}", "json");
  ctx.namedMaps = { defaults: { language: "sv" } };
  assertEquals(evaluate('maps_get("defaults", "language")', ctx, "string"), "sv");
  assertEquals(evaluate('maps_get("defaults", "missing")', ctx, "string"), null);
});

Deno.test("Test Run resolves maps_get from Blockly Defaults Map JSON", () => {
  const model = applyExpressionEdit(
    createEmptyModel("vitals"),
    "s1",
    mapsGetExpression("defaults", "language"),
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const result = runTest(model, "{}", "json", {
    blocklyState: {
      blocks: {
        blocks: [
          {
            type: "defaults_block",
            inputs: {
              MAP: {
                block: {
                  type: "maps_create_with",
                  extraState: { itemCount: 1 },
                  fields: { KEY0: "language" },
                  inputs: {
                    VAL0: { shadow: { type: "text", fields: { TEXT: "sv" } } },
                  },
                },
              },
            },
          },
        ],
      },
    },
  });
  assertEquals(result.ok, true);
  const output = result.output as { slots?: Record<string, unknown> };
  assertEquals(output.slots?.s1, "sv");
});

Deno.test("maps_get expression round-trips", () => {
  const src = 'maps_get("defaults", "territory")';
  assertEquals(serialize(parseExpression(src)), src);
});

Deno.test("memory Defaults catalog save/load", async () => {
  const catalog = createMemoryDefaultsCatalog();
  const saved = await catalog.save("Clinic", { type: "maps_create_with" });
  assertEquals(saved.displayName, "Clinic");
  const listed = await catalog.list();
  assertEquals(listed[0]?.id, saved.id);
  assertEquals(await catalog.load(saved.id), { type: "maps_create_with" });
});

Deno.test("bindDefaultPoints matches COMPOSITION language on a BP OPT", () => {
  const { skeleton } = generateSkeleton(opt);
  const bound = bindDefaultPoints(skeleton, factoryDefaultsEntries("sv"));
  assert(bound.some((item) => item.point.mapKey === "language" && item.parent.rmType === "COMPOSITION"));
  assert(bound.some((item) => item.point.mapKey === "territory"));
  assert(bound.some((item) => item.point.mapKey === "encoding" && item.parent.rmType === "OBSERVATION"));
  assert(bound.some((item) => item.point.mapKey === "composer"));
  assert(bound.some((item) => item.point.mapKey === "subject" && item.point.leaf === "party"));
  assert(bound.some((item) => item.point.mapKey === "start_time"));
  assert(bound.some((item) => item.point.mapKey === "origin"));
  assert(bound.some((item) => item.point.mapKey === "time"));
});

Deno.test("bindDefaultPoints ignores runtime keys with empty scaffold targets", () => {
  const { skeleton } = generateSkeleton(opt);
  const bound = bindDefaultPoints(
    skeleton,
    [
      "language",
      "territory",
      "encoding",
      "time",
      "composer_name",
      "health_care_facility",
      "subject",
    ].map((runtimeKey) => ({ runtimeKey, scaffoldTargets: [] })),
  );
  assertEquals(bound.length, 0);
});

function facilityLookups(workspace: InstanceType<typeof Blockly.Workspace>) {
  const context = workspace.getAllBlocks(false).find((block) => block.type === "event_context");
  assertExists(context, "EVENT_CONTEXT block");
  return context.getInputTargetBlock(optionalRmInputName("health_care_facility")) ??
    context.getInputTargetBlock(rmAttributeInputName("health_care_facility"));
}

function mapsGetKey(block: { getInputTargetBlock: (name: string) => { getFieldValue: (name: string) => unknown } | null } | null) {
  return String(block?.getInputTargetBlock("KEY")?.getFieldValue("TEXT") ?? "");
}

Deno.test("bindDefaultPoints inserts optional EVENT_CONTEXT.health_care_facility when the map has that target", () => {
  const { skeleton } = generateSkeleton(opt);
  const withoutKey = bindDefaultPoints(
    skeleton,
    entriesFromScaffoldTargetList(["*.language", "COMPOSITION.territory"]),
  );
  assertFalse(
    withoutKey.some((item) => item.point.rmAttribute === "health_care_facility"),
    "optional facility is not a silent-mandatory skeleton child",
  );
  const withBareKey = bindDefaultPoints(
    skeleton,
    [{ runtimeKey: "facility", scaffoldTargets: [] }],
  );
  assertEquals(
    withBareKey.filter((item) => item.point.rmAttribute === "health_care_facility").length,
    0,
    "runtime-only keys do not insert optional RM",
  );
});

Deno.test("bindDefaultPoints lights optional facility from EVENT_CONTEXT.health_care_facility or COMPOSITION.context.health_care_facility", () => {
  const { skeleton } = generateSkeleton(opt);
  const fromType = bindDefaultPoints(
    skeleton,
    [{ runtimeKey: "facility", scaffoldTargets: ["EVENT_CONTEXT.health_care_facility"] }],
  );
  assertEquals(
    fromType.find((item) => item.point.rmAttribute === "health_care_facility")?.mapKey,
    "facility",
  );
  const fromPath = bindDefaultPoints(
    skeleton,
    [{ runtimeKey: "facility", scaffoldTargets: ["COMPOSITION.context.health_care_facility"] }],
  );
  assertEquals(
    fromPath.find((item) => item.point.rmAttribute === "health_care_facility")?.mapKey,
    "facility",
  );
});

Deno.test("bindDefaultPoints wildcard *.territory binds COMPOSITION.territory", () => {
  const { skeleton } = generateSkeleton(opt);
  const bound = bindDefaultPoints(skeleton, entriesFromScaffoldTargetList(["*.territory"]));
  const territory = bound.find((item) =>
    item.point.rmAttribute === "territory" && item.parent.rmType === "COMPOSITION"
  );
  assertExists(territory);
  assertEquals(territory.mapKey, "territory");
});

Deno.test("bindDefaultPoints does not invent missing mandatory language on a bare OBSERVATION", () => {
  const skeleton = [{
    slotId: "t",
    blockType: "composition",
    rmType: "COMPOSITION",
    label: "Encounter",
    kind: "container" as const,
    mandatory: true,
    children: [{
      slotId: "t/content/bp",
      blockType: "observation",
      rmType: "OBSERVATION",
      label: "Blood pressure",
      rmAttribute: "content",
      kind: "container" as const,
      mandatory: false,
      children: [],
    }],
  }];
  const bound = bindDefaultPoints(skeleton, entriesFromScaffoldTargetList(["*.language"]));
  assertEquals(
    bound.filter((item) => item.parent.rmType === "OBSERVATION").length,
    0,
  );
});

Deno.test("bindDefaultPoints prefers Class.attribute over a wildcard when choosing a runtime key", () => {
  const { skeleton } = generateSkeleton(opt);
  const bound = bindDefaultPoints(
    skeleton,
    [
      { runtimeKey: "all_language", scaffoldTargets: ["*.language"] },
      { runtimeKey: "composition_language", scaffoldTargets: ["COMPOSITION.language"] },
    ],
  );
  assertEquals(
    bound.find((item) =>
      item.parent.rmType === "COMPOSITION" && item.point.rmAttribute === "language"
    )?.mapKey,
    "composition_language",
  );
  assertEquals(
    bound.find((item) =>
      item.parent.rmType === "OBSERVATION" && item.point.rmAttribute === "language"
    )?.mapKey,
    "all_language",
  );
});

Deno.test("bindDefaultPoints ENTRY.language lights OBSERVATION language", () => {
  const { skeleton } = generateSkeleton(opt);
  const bound = bindDefaultPoints(skeleton, entriesFromScaffoldTargetList(["ENTRY.language"]));
  assert(
    bound.some((item) =>
      item.parent.rmType === "OBSERVATION" && item.point.rmAttribute === "language"
    ),
  );
  assertFalse(
    bound.some((item) =>
      item.parent.rmType === "COMPOSITION" && item.point.rmAttribute === "language"
    ),
  );
});

Deno.test("namedMapsFromBlocklyState reads party name and identifiers from Defaults Map values", () => {
  const maps = namedMapsFromBlocklyState({
    blocks: {
      blocks: [
        {
          type: "defaults_block",
          inputs: {
            MAP: {
              block: {
                type: "maps_create_with",
                extraState: { itemCount: 1 },
                fields: { KEY0: "COMPOSITION.composer" },
                inputs: {
                  VAL0: {
                    block: {
                      type: "party_identified",
                      fields: { RM_TYPE: "PARTY_IDENTIFIED" },
                      inputs: {
                        ATTR_name: { block: { type: "text", fields: { TEXT: "Dr. Who Demo" } } },
                        ATTR_identifiers: {
                          block: {
                            type: "lists_create_with",
                            extraState: { itemCount: 1 },
                            inputs: {
                              ADD0: {
                                block: {
                                  type: "dv_identifier",
                                  inputs: {
                                    FLD_id: { block: { type: "text", fields: { TEXT: "9876543210" } } },
                                    OPTFLD_type: {
                                      block: {
                                        type: "text",
                                        fields: { TEXT: "Professional Registration Number" },
                                      },
                                    },
                                    OPTFLD_issuer: {
                                      block: { type: "text", fields: { TEXT: "General Medical Council" } },
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
            },
          },
        },
      ],
    },
  });
  assertEquals(maps[DEFAULTS_MAP_NAME]?.["composer"], {
    _type: "PARTY_IDENTIFIED",
    name: "Dr. Who Demo",
    identifiers: [{
      _type: "DV_IDENTIFIER",
      id: "9876543210",
      type: "Professional Registration Number",
      issuer: "General Medical Council",
    }],
  });
});

Deno.test("skeleton scaffolding joins an existing Defaults block and plugs language lookup", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  const beforeId = findDefaultsBlock(workspace)?.id;
  assertExists(beforeId);
  const { skeleton } = generateSkeleton(opt);
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");
  const defaults = findDefaultsBlock(workspace);
  assertExists(defaults);
  assertEquals(defaults.id, beforeId);
  const maps = namedMapsFromBlocklyState(Blockly.serialization.workspaces.save(workspace));
  assertEquals(maps[DEFAULTS_MAP_NAME]?.language, "sv");
  assertEquals(maps[DEFAULTS_MAP_NAME]?.encoding, FACTORY_ENCODING);
  assertEquals(defaults.type, DEFAULT_CONTEXT_MAP_TYPE);
  assertEquals(defaults.getFieldValue("KEY0"), "language");
  assert(!defaults.getInput("MAP"));
  const languageVal = defaults.getInputTargetBlock("VAL0");
  assertEquals(languageVal?.type, "term_pick");
  assertEquals(languageVal?.getFieldValue("SET"), "ISO_639-1");
  assertEquals(languageVal?.getFieldValue("CODE"), "sv");
  const encodingIndex = [...Array(12).keys()].find((i) =>
    defaults.getFieldValue(`KEY${i}`) === "encoding"
  );
  assertEquals(encodingIndex, 2);
  const encodingVal = defaults.getInputTargetBlock(`VAL${encodingIndex}`);
  assertEquals(encodingVal?.type, "term_pick");
  assertEquals(encodingVal?.getFieldValue("SET"), "IANA_character-sets");
  assertEquals(encodingVal?.getFieldValue("CODE"), FACTORY_ENCODING);
  const lookups = workspace.getAllBlocks(false).filter((block) => block.type === "maps_get");
  assert(lookups.length > 0, "expected Default point Map lookups on the skeleton");
  assert(
    lookups.some((block) =>
      block.getFieldValue("NAME") === "defaults" &&
      block.getInputTargetBlock("KEY")?.getFieldValue("TEXT") === "language"
    ),
    "expected a language Default point lookup",
  );
  assert(
    lookups.some((block) =>
      block.getFieldValue("NAME") === "defaults" &&
      block.getInputTargetBlock("KEY")?.getFieldValue("TEXT") === "encoding"
    ),
    "expected an encoding Default point lookup",
  );
  assert(
    lookups.some((block) =>
      block.getFieldValue("NAME") === "defaults" &&
      block.getInputTargetBlock("KEY")?.getFieldValue("TEXT") === "subject"
    ),
    "expected a subject Default point lookup when Defaults Map has subject",
  );
  const subjectIndex = [...Array(12).keys()].find((i) =>
    defaults.getFieldValue(`KEY${i}`) === "subject"
  );
  assertExists(subjectIndex);
  assertEquals(defaults.getInputTargetBlock(`VAL${subjectIndex}`)?.type, "party_self");
  const partyProxy = workspace.getAllBlocks(false).find((block) =>
    block.type === "party_proxy" &&
    block.getInputTargetBlock("KIND")?.type === "maps_get"
  );
  assertExists(partyProxy, "subject should keep PARTY_PROXY shell with maps_get in KIND");
  assertEquals(
    partyProxy.getInputTargetBlock("KIND")?.getInputTargetBlock("KEY")?.getFieldValue("TEXT"),
    "subject",
  );
  const derived = workspaceToModelJson(workspace);
  assert(
    derived.slots.some((slot) => slot.expression.includes('maps_get("defaults", "language")')),
    "language lookup should appear in the Mapping Model",
  );
  assert(
    derived.slots.some((slot) => slot.expression.includes('maps_get("defaults", "encoding")')),
    "encoding lookup should appear in the Mapping Model",
  );
  workspace.dispose();
});

Deno.test("object-valued Defaults Map keys plug maps_get into the RM attribute mouth", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  const { skeleton } = generateSkeleton(opt);
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");

  const composition = workspace.getAllBlocks(false).find((block) => block.type === "composition");
  assertExists(composition);
  const language = composition.getInputTargetBlock(rmAttributeInputName("language"));
  assertEquals(language?.type, "maps_get");
  assertEquals(language?.getParent()?.type, "composition");
  assertEquals(language?.getInputTargetBlock("KEY")?.getFieldValue("TEXT"), "language");
  assert(language?.getFieldValue("SLOT_ID"), "language maps_get should keep the skeleton slot id");

  const territory = composition.getInputTargetBlock(rmAttributeInputName("territory"));
  assertEquals(territory?.type, "maps_get");
  assertEquals(territory?.getParent()?.type, "composition");

  const encodingLookups = workspace.getAllBlocks(false).filter((block) =>
    block.type === "maps_get" &&
    block.getInputTargetBlock("KEY")?.getFieldValue("TEXT") === "encoding"
  );
  assert(encodingLookups.length > 0, "expected encoding Default point lookups");
  for (const lookup of encodingLookups) {
    assertEquals(
      lookup.getParent()?.type === "code_phrase",
      false,
      "encoding maps_get should sit on ENTRY.encoding, not CODE_PHRASE.code",
    );
  }

  const timeLookups = workspace.getAllBlocks(false).filter((block) => {
    const key = String(block.getInputTargetBlock("KEY")?.getFieldValue("TEXT") ?? "");
    return block.type === "maps_get" &&
      (key === "time" || key === "start_time" || key === "origin");
  });
  assert(
    timeLookups.some((block) => {
      const parentType = block.getParent()?.type ?? "";
      return parentType.startsWith("dv_") || parentType === "dv_date_time";
    }),
    "scalar timestamp keys should still plug into the DV date/time value leaf",
  );

  const projection = projectBlocklyState(Blockly.serialization.workspaces.save(workspace));
  const languageRow = projection.lines.find((line) =>
    line.attribute === "language" && line.type === "maps_get"
  );
  assertExists(languageRow);
  assertEquals(languageRow.shell, undefined);
  assertEquals(
    projection.lines.some((line) =>
      line.attribute === "code" && line.type === "maps_get" && line.shell === "code_phrase"
    ),
    false,
    "language lookup must not appear as CODE_PHRASE.code",
  );

  workspace.dispose();
});

Deno.test("Apply default context map keeps a Source query on language", () => {
  initBlocklyGenerators();
  const workspace = new Blockly.Workspace();
  try {
    const { skeleton } = generateSkeleton(opt);
    loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");
    const composition = workspace.getAllBlocks(false).find((block) => block.type === "composition");
    assertExists(composition);
    const language = composition.getInputTargetBlock(rmAttributeInputName("language"));
    assertEquals(language?.type, "maps_get");
    const parentConn = language!.outputConnection?.targetConnection;
    assertExists(parentConn);
    language!.dispose(false);
    const source = createSourceQueryBlock(workspace, "$.lang", "string");
    assertExists(source.outputConnection);
    source.outputConnection.setCheck(null);
    parentConn.connect(source.outputConnection);
    assertEquals(
      composition.getInputTargetBlock(rmAttributeInputName("language"))?.type,
      "source_query",
      "language mouth should hold the Source query before Apply",
    );
    applyDefaultContextMap(workspace, skeleton);
    const after = composition.getInputTargetBlock(rmAttributeInputName("language"));
    assertEquals(after?.type, "source_query");
    assertEquals(after?.getFieldValue("EXPRESSION"), "$.lang");
  } finally {
    workspace.dispose();
  }
});

Deno.test("hydrateDefaultsMapArgument loads maps_create_with field-key JSON", () => {
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  hydrateDefaultsMapArgument(workspace, {
    type: "maps_create_with",
    extraState: { itemCount: 1 },
    fields: { KEY0: "language" },
    inputs: {
      VAL0: { shadow: { type: "text", fields: { TEXT: "xx" } } },
    },
  }, "sv");
  const map = findDefaultsBlock(workspace);
  assertEquals(map?.type, DEFAULT_CONTEXT_MAP_TYPE);
  assertEquals(map?.getFieldValue("KEY0"), "language");
  assert(!map?.getInput("MAP"));
  const maps = namedMapsFromBlocklyState(Blockly.serialization.workspaces.save(workspace));
  assertEquals(maps[DEFAULTS_MAP_NAME]?.language, "xx");
  workspace.dispose();
});

Deno.test("openEHR factory Defaults Map uses party objects for composer and facility", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  const map = findDefaultsBlock(workspace);
  assertExists(map);
  const composerIndex = [...Array(12).keys()].find((i) =>
    map.getFieldValue(`KEY${i}`) === "composer"
  );
  const facilityIndex = [...Array(12).keys()].find((i) =>
    map.getFieldValue(`KEY${i}`) === "facility"
  );
  assertExists(composerIndex);
  assertExists(facilityIndex);
  assertEquals(map.getInputTargetBlock(`VAL${composerIndex}`)?.type, "party_identified");
  assertEquals(map.getInputTargetBlock(`VAL${facilityIndex}`)?.type, "party_identified");
  const maps = namedMapsFromBlocklyState(Blockly.serialization.workspaces.save(workspace));
  const composer = maps[DEFAULTS_MAP_NAME]?.composer as { name?: string } | undefined;
  const facility = maps[DEFAULTS_MAP_NAME]?.facility as { name?: string } | undefined;
  assertEquals(composer?.name, "Dr. Who Demo");
  assertEquals(facility?.name, FACTORY_HEALTH_CARE_FACILITY);
  workspace.dispose();
});

Deno.test("scaffolding inserts EVENT_CONTEXT.health_care_facility lookup from the Defaults Map", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  const { skeleton } = generateSkeleton(opt);
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");
  const facility = facilityLookups(workspace);
  assertEquals(facility?.type, "maps_get");
  assertEquals(facility?.getFieldValue("NAME"), "defaults");
  assertEquals(mapsGetKey(facility), "facility");
  const composition = workspace.getAllBlocks(false).find((block) => block.type === "composition");
  const composer = composition?.getInputTargetBlock(rmAttributeInputName("composer"));
  assertEquals(composer?.type, "maps_get");
  assertEquals(composer?.getFieldValue("NAME"), "defaults");
  assertEquals(mapsGetKey(composer), "composer");
  workspace.dispose();
});

Deno.test("relabel keeps maps_get NAME as defaults rather than the skeleton label", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  const { skeleton } = generateSkeleton(opt);
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");
  relabelWorkspaceFromSkeleton(workspace, skeleton);
  const lookups = workspace.getAllBlocks(false).filter((block) => block.type === "maps_get");
  assert(lookups.length > 0, "expected Default point lookups");
  for (const lookup of lookups) {
    assertEquals(
      lookup.getFieldValue("NAME"),
      "defaults",
      `maps_get key ${mapsGetKey(lookup)} should look up the defaults map, not the slot label`,
    );
  }
  workspace.dispose();
});

Deno.test("path-qualified Defaults Map key scaffolds the matching optional RM slot", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  hydrateDefaultsMapArgument(workspace, {
    type: "maps_create_with",
    extraState: { itemCount: 1 },
    fields: { KEY0: "EVENT_CONTEXT.health_care_facility" },
    inputs: {
      VAL0: { block: { type: "text", fields: { TEXT: "Ward 7" } } },
    },
  }, "sv");
  const { skeleton } = generateSkeleton(opt);
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");
  const facility = facilityLookups(workspace);
  assertExists(facility);
  const lookup = facility.type === "maps_get"
    ? facility
    : facility.getInputTargetBlock(rmAttributeInputName("name"));
  assertEquals(lookup?.type, "maps_get", `facility mouth was ${facility.type}`);
  assertEquals(lookup?.getFieldValue("NAME"), "defaults");
  assertEquals(mapsGetKey(lookup), "facility");
  workspace.dispose();
});

Deno.test("empty Defaults Map does not insert optional health_care_facility", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  ensureDefaultsBlock(workspace, "sv");
  hydrateDefaultsMapArgument(workspace, {
    type: "maps_create_with",
    extraState: { itemCount: 0 },
  }, "sv");
  const { skeleton } = generateSkeleton(opt);
  loadSkeletonIntoWorkspace(
    workspace,
    skeleton,
    createEmptyModel("t"),
    null,
    "sv",
    undefined,
    { factory: false },
  );
  const context = workspace.getAllBlocks(false).find((block) => block.type === "event_context");
  assertExists(context);
  assertEquals(
    context.getInputTargetBlock(optionalRmInputName("health_care_facility"))?.type ?? null,
    null,
  );
  assertEquals(
    context.getInputTargetBlock(rmAttributeInputName("health_care_facility"))?.type ?? null,
    null,
  );
  workspace.dispose();
});

Deno.test("scaffoldBlocklyFromSkeleton binds optional RM from a pending Defaults Map", () => {
  const { skeleton } = generateSkeleton(opt);
  const { extract } = scaffoldBlocklyFromSkeleton(skeleton, createEmptyModel("t"), {
    uiLanguage: "sv",
    defaultsMap: {
      type: "maps_create_with",
      extraState: { itemCount: 1 },
      fields: { KEY0: "EVENT_CONTEXT.health_care_facility" },
      inputs: {
        VAL0: { block: { type: "text", fields: { TEXT: "Ward 7" } } },
      },
    },
  });
  const facility = extract.optionalRm.find((row) => row.attributeName === "health_care_facility");
  assertExists(facility, JSON.stringify(extract.optionalRm));
  const lookup = extract.slots.find((slot) =>
    slot.slotId.includes("health_care_facility") &&
    slot.expression.includes("facility")
  );
  assertExists(lookup, JSON.stringify(extract.slots.map((slot) => ({
    slotId: slot.slotId,
    expression: slot.expression,
  }))));
});

Deno.test("blank canvas default context map has no factory rows", () => {
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  try {
    const block = ensureDefaultsBlock(workspace, "sv", undefined, { factory: false });
    assertEquals(block.type, DEFAULT_CONTEXT_MAP_TYPE);
    const maps = namedMapsFromBlocklyState(Blockly.serialization.workspaces.save(workspace));
    assertEquals(Object.keys(maps[DEFAULTS_MAP_NAME] ?? {}).length, 0);
  } finally {
    workspace.dispose();
  }
});

Deno.test("first target scaffold dumps factory when the canvas map is still empty", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  try {
    ensureDefaultsBlock(workspace, "sv", undefined, { factory: false });
    assertEquals(
      (findDefaultsBlock(workspace) as { itemCount_?: number } | null)?.itemCount_,
      0,
    );
    const { skeleton } = generateSkeleton(opt);
    loadSkeletonIntoWorkspace(
      workspace,
      skeleton,
      createEmptyModel("t"),
      null,
      "sv",
      undefined,
      { factory: true },
    );
    const defaults = findDefaultsBlock(workspace);
    assertExists(defaults);
    assertEquals(defaults.getFieldValue("KEY0"), "language");
    assertEquals(defaults.getInputTargetBlock("VAL0")?.type, "term_pick");
    assertEquals(defaults.getInputTargetBlock("VAL0")?.getFieldValue("SET"), "ISO_639-1");
    const lookups = workspace.getAllBlocks(false).filter((block) => block.type === "maps_get");
    assert(lookups.length > 0, "expected Default point maps_get lookups after factory dump");
    assert(
      lookups.some((block) =>
        block.getFieldValue("NAME") === "defaults" &&
        block.getInputTargetBlock("KEY")?.getFieldValue("TEXT") === "language"
      ),
      "language Default point should look up runtime key language",
    );
  } finally {
    workspace.dispose();
  }
});

Deno.test("New empty default context map survives skeleton load when factory dump is off", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  try {
    ensureDefaultsBlock(workspace, "sv", undefined, { factory: false });
    const { skeleton } = generateSkeleton(opt);
    loadSkeletonIntoWorkspace(
      workspace,
      skeleton,
      createEmptyModel("t"),
      null,
      "sv",
      undefined,
      { factory: false },
    );
    const defaults = findDefaultsBlock(workspace);
    assertExists(defaults);
    assertEquals((defaults as { itemCount_?: number }).itemCount_, 0);
    assertEquals(
      workspace.getAllBlocks(false).filter((block) => block.type === "maps_get").length,
      0,
    );
  } finally {
    workspace.dispose();
  }
});

Deno.test("hydrating another default context map does not rebuild the Product stack", () => {
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  try {
    const { skeleton } = generateSkeleton(opt);
    loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");
    const compositionId = workspace.getAllBlocks(false).find((block) => block.type === "composition")
      ?.id;
    assertExists(compositionId);
    hydrateDefaultsMapArgument(workspace, {
      type: DEFAULT_CONTEXT_MAP_TYPE,
      extraState: { itemCount: 1, targets: [["*.language"]] },
      fields: { KEY0: "language" },
      inputs: { VAL0: { shadow: { type: "text", fields: { TEXT: "de" } } } },
    }, "sv");
    assert(
      workspace.getAllBlocks(false).some((block) => block.id === compositionId),
      "Product stack COMPOSITION must survive picking another saved map",
    );
    const maps = namedMapsFromBlocklyState(Blockly.serialization.workspaces.save(workspace));
    assertEquals(maps[DEFAULTS_MAP_NAME]?.language, "de");
  } finally {
    workspace.dispose();
  }
});
