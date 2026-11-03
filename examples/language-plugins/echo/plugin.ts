/**
 * Sample conversion-script language plugin.
 *
 * Loaded by the desktop app from manifest.json. `generate` receives the
 * Mapping Model and returns the script text. It must not read the filesystem
 * or the environment; the worker sandbox does not allow that.
 */
export const plugin = {
  id: "echo",
  label: "Echo",
  extension: "txt",
  mime: "text/plain",
  runnable: false,
  generate(model: { templateId?: string }): string {
    const id = model?.templateId ?? "";
    return [
      "# Echo conversion script",
      `# template: ${id}`,
      "# This plugin is an example. Replace generate() with a real emitter.",
      "",
    ].join("\n");
  },
};
