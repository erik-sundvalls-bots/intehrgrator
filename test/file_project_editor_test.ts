import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchController } from "../src/workbench/controller.ts";
import { createFsHostAdapter } from "../src/host/fs_adapter.ts";
import { loadFileProject } from "../src/workbench/file_project.ts";
import {
  connectFileProjectEditor,
  type ProjectEditorMessage,
  type ProjectHostMessage,
} from "../src/workbench/file_project_editor.ts";

Deno.test("file project editor: Ctrl+S waits until every pending canvas edit reaches the document", async () => {
  const root = join(import.meta.dirname!, "../examples/file-project");
  const project = await loadFileProject(
    await Deno.readTextFile(join(root, "intehrgrator.json")),
    {
      readText: (path) => Deno.readTextFile(join(root, path)),
      listExamples: () => Promise.resolve(["person-01.json"]),
    },
  );
  const controller = new WorkbenchController(createFsHostAdapter());
  const messages: ProjectEditorMessage[] = [];
  let receive: (message: ProjectHostMessage) => void = () => {};
  const dispose = connectFileProjectEditor(controller, {
    postProjectMessage: (message) => messages.push(message),
    onProjectMessage: (listener) => {
      receive = listener;
      return () => {};
    },
  });
  try {
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 1,
      generation: 10,
    });
    const first = structuredClone(project.bundle.mapping.blocklyState);
    const serialized = JSON.stringify(first).replace(
      '"EXPRESSION":"$.id"',
      '"EXPRESSION":"$.changedId"',
    );
    controller.loadBlocklyDefinition("mapping", serialized);
    const save = Object.defineProperties(
      new Event("keydown", { cancelable: true }),
      {
        key: { value: "s" },
        ctrlKey: { value: true },
        metaKey: { value: false },
        altKey: { value: false },
      },
    );
    globalThis.dispatchEvent(save);
    assertEquals(messages.map((m) => m.type), [
      "intehrgrator:project-ready",
      "intehrgrator:project-edit",
    ]);
    controller.loadBlocklyDefinition(
      "mapping",
      serialized.replace("$.changedId", "$.latestId"),
    );
    receive({ type: "intehrgrator:project-ack", version: 2, generation: 10 });
    assertEquals(messages.map((m) => m.type), [
      "intehrgrator:project-ready",
      "intehrgrator:project-edit",
      "intehrgrator:project-edit",
    ]);
    const latest = messages.at(-1);
    if (latest?.type !== "intehrgrator:project-edit") {
      throw new Error("Expected latest mapping edit");
    }
    assertEquals(latest.version, 2);
    assertEquals(latest.mapping.includes("$.latestId"), true);
    receive({ type: "intehrgrator:project-ack", version: 3, generation: 10 });
    assertEquals(messages.at(-1), {
      type: "intehrgrator:project-command",
      command: "save",
    });
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 4,
      generation: 11,
    });
    assertEquals(
      controller.exportDocumentSnapshot().mapping.blocklyState,
      project.bundle.mapping.blocklyState,
    );
  } finally {
    dispose();
    controller.newProject();
  }
});

Deno.test("file project editor: an input refresh preserves a canvas edit that has not reached the document", async () => {
  const root = join(import.meta.dirname!, "../examples/file-project");
  const project = await loadFileProject(
    await Deno.readTextFile(join(root, "intehrgrator.json")),
    {
      readText: (path) => Deno.readTextFile(join(root, path)),
      listExamples: () => Promise.resolve(["person-01.json"]),
    },
  );
  const controller = new WorkbenchController(createFsHostAdapter());
  const messages: ProjectEditorMessage[] = [];
  let receive: (message: ProjectHostMessage) => void = () => {};
  const dispose = connectFileProjectEditor(controller, {
    postProjectMessage: (message) => messages.push(message),
    onProjectMessage: (listener) => {
      receive = listener;
      return () => {};
    },
  });
  try {
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 1,
      generation: 1,
    });
    controller.loadBlocklyDefinition(
      "mapping",
      JSON.stringify(project.bundle.mapping.blocklyState).replace(
        '"EXPRESSION":"$.id"',
        '"EXPRESSION":"$.unsavedId"',
      ),
    );
    const refreshed = structuredClone(project.bundle);
    refreshed.examples[0].content =
      '{"unsavedId":"NEW-ID","displayName":"Changed source"}';
    receive({
      type: "intehrgrator:project-load",
      bundle: refreshed,
      version: 1,
      generation: 2,
      reason: "inputs",
    });
    const latest = messages.at(-1);
    if (latest?.type !== "intehrgrator:project-edit") {
      throw new Error("Pending edit was not preserved");
    }
    assertEquals(latest.mapping.includes("$.unsavedId"), true);
    assertEquals(latest.generation, 2);
    assertEquals(
      controller.exportDocumentSnapshot().examples[0].content,
      refreshed.examples[0].content,
    );
    controller.runTestNow();
    assertEquals(controller.getState().testResult?.output, {
      identifier: "NEW-ID",
      name: "Changed source",
    });
    receive({ type: "intehrgrator:project-ack", version: 2, generation: 2 });
    controller.loadBlocklyDefinition(
      "mapping",
      latest.mapping.replace("$.unsavedId", "$.anotherUnsavedId"),
    );
    globalThis.dispatchEvent(
      Object.defineProperties(new Event("keydown", { cancelable: true }), {
        key: { value: "z" },
        ctrlKey: { value: true },
        metaKey: { value: false },
        altKey: { value: false },
      }),
    );
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 3,
      generation: 3,
      reason: "document",
    });
    const conflict = messages.find((message) =>
      message.type === "intehrgrator:project-conflict"
    );
    if (conflict?.type !== "intehrgrator:project-conflict") {
      throw new Error("External edit discarded the local version");
    }
    assertEquals(conflict.mapping.includes("$.anotherUnsavedId"), true);
    assertEquals(
      messages.some((message) =>
        message.type === "intehrgrator:project-command" &&
        message.command === "undo"
      ),
      false,
    );
  } finally {
    dispose();
    controller.newProject();
  }
});

Deno.test("file project editor: metadata-only edits survive input refresh and wait for manifest acknowledgement", async () => {
  const root = join(import.meta.dirname!, "../examples/file-project");
  const project = await loadFileProject(
    await Deno.readTextFile(join(root, "intehrgrator.json")),
    {
      readText: (path) => Deno.readTextFile(join(root, path)),
      listExamples: () => Promise.resolve(["person-01.json"]),
    },
  );
  const controller = new WorkbenchController(createFsHostAdapter());
  const messages: ProjectEditorMessage[] = [];
  let receive: (message: ProjectHostMessage) => void = () => {};
  const dispose = connectFileProjectEditor(controller, {
    postProjectMessage: (message) => messages.push(message),
    onProjectMessage: (listener) => {
      receive = listener;
      return () => {};
    },
  });
  const save = () =>
    globalThis.dispatchEvent(
      Object.defineProperties(new Event("keydown", { cancelable: true }), {
        key: { value: "s" },
        ctrlKey: { value: true },
        metaKey: { value: false },
        altKey: { value: false },
      }),
    );
  try {
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 1,
      manifestVersion: 7,
      generation: 1,
    });
    controller.setSourceDisplayLanguage("sv");
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 1,
      manifestVersion: 7,
      generation: 2,
      reason: "inputs",
    });
    save();
    const edit = messages.findLast((message) =>
      message.type === "intehrgrator:project-edit"
    );
    if (edit?.type !== "intehrgrator:project-edit") {
      throw new Error("Metadata edit did not reach the host");
    }
    assertEquals(edit.metadata.sourceSchema?.labelLanguage, "sv");
    assertEquals(edit.manifestVersion, 7);
    assertEquals(
      messages.some((message) =>
        message.type === "intehrgrator:project-command"
      ),
      false,
    );
    receive({
      type: "intehrgrator:project-ack",
      version: 1,
      manifestVersion: 8,
      generation: 2,
    });
    assertEquals(messages.at(-1), {
      type: "intehrgrator:project-command",
      command: "save",
    });
    controller.setSourceDisplayLanguage("en");
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 1,
      manifestVersion: 9,
      generation: 3,
      reason: "document",
    });
    const conflict = messages.findLast((message) =>
      message.type === "intehrgrator:project-conflict"
    );
    if (conflict?.type !== "intehrgrator:project-conflict") {
      throw new Error("Pending metadata was discarded");
    }
    assertEquals(conflict.metadata.sourceSchema?.labelLanguage, "en");
  } finally {
    dispose();
    controller.newProject();
  }
});

Deno.test("file project editor: a late acknowledgement cannot acknowledge a newer rebased edit", async () => {
  const { rebaseProjectMapping } = await import(
    "../src/workbench/file_project.ts"
  );
  const root = join(import.meta.dirname!, "../examples/file-project");
  const project = await loadFileProject(
    await Deno.readTextFile(join(root, "intehrgrator.json")),
    {
      readText: (path) => Deno.readTextFile(join(root, path)),
      listExamples: () => Promise.resolve(["person-01.json"]),
    },
  );
  const controller = new WorkbenchController(createFsHostAdapter());
  const messages: ProjectEditorMessage[] = [];
  let receive: (message: ProjectHostMessage) => void = () => {};
  const dispose = connectFileProjectEditor(controller, {
    postProjectMessage: (message) => messages.push(message),
    onProjectMessage: (listener) => {
      receive = listener;
      return () => {};
    },
  });
  try {
    receive({
      type: "intehrgrator:project-load",
      bundle: project.bundle,
      version: 1,
      generation: 1,
    });
    const editA = JSON.stringify(project.bundle.mapping.blocklyState).replace(
      '"EXPRESSION":"$.id"',
      '"EXPRESSION":"$.A"',
    );
    controller.loadBlocklyDefinition("mapping", editA);
    globalThis.dispatchEvent(
      Object.defineProperties(new Event("keydown", { cancelable: true }), {
        key: { value: "s" },
        ctrlKey: { value: true },
        metaKey: { value: false },
        altKey: { value: false },
      }),
    );
    controller.loadBlocklyDefinition("mapping", editA.replace("$.A", "$.B"));
    receive({
      type: "intehrgrator:project-load",
      bundle: rebaseProjectMapping(project.bundle, editA),
      version: 2,
      generation: 2,
      reason: "inputs",
    });
    receive({ type: "intehrgrator:project-ack", version: 2, generation: 1 });
    controller.loadBlocklyDefinition("mapping", editA.replace("$.A", "$.C"));
    receive({ type: "intehrgrator:project-ack", version: 3, generation: 2 });
    const edits = messages.filter((message) =>
      message.type === "intehrgrator:project-edit"
    );
    assertEquals(edits.map((message) => message.version), [1, 2, 3]);
    assertEquals(
      JSON.stringify(controller.exportDocumentSnapshot().mapping.blocklyState)
        .includes("$.C"),
      true,
    );
    receive({ type: "intehrgrator:project-ack", version: 4, generation: 2 });
    assertEquals(messages.at(-1), {
      type: "intehrgrator:project-command",
      command: "save",
    });
  } finally {
    dispose();
    controller.newProject();
  }
});
