/**
 * Sandbox host for one conversion-script language plugin.
 *
 * The parent grants `net` for a remote module, or `read` of the plugin
 * directory for a `file:` module. This worker has no env, run, write, or ffi.
 */
export interface PluginWorkerReady {
  type: "ready";
  id: string;
  label: string;
  extension: string;
  mime: string;
  runnable: boolean;
}

type PluginModule = {
  plugin?: {
    id?: string;
    label?: string;
    extension?: string;
    mime?: string;
    runnable?: boolean;
    generate?: (model: unknown, options?: unknown) => unknown;
  };
  default?: PluginModule["plugin"];
};

let generate: ((model: unknown, options?: unknown) => unknown) | null = null;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; moduleUrl?: string; requestId?: number; model?: unknown; options?: unknown };
  if (msg.type === "load") {
    try {
      const mod = await import(String(msg.moduleUrl)) as PluginModule;
      const plugin = mod.plugin ?? mod.default;
      if (!plugin || typeof plugin.generate !== "function") {
        throw new Error("Plugin module must export plugin.generate(model, options)");
      }
      if (!plugin.id || !plugin.label || !plugin.extension) {
        throw new Error("Plugin must set id, label, and extension");
      }
      generate = plugin.generate.bind(plugin);
      const ready: PluginWorkerReady = {
        type: "ready",
        id: plugin.id,
        label: plugin.label,
        extension: plugin.extension,
        mime: plugin.mime || "text/plain",
        runnable: Boolean(plugin.runnable),
      };
      self.postMessage(ready);
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (msg.type === "generate") {
    if (!generate) {
      self.postMessage({ type: "error", requestId: msg.requestId, message: "Plugin is not loaded" });
      return;
    }
    try {
      const code = await generate(msg.model, msg.options);
      self.postMessage({ type: "script", requestId: msg.requestId, code: String(code ?? "") });
    } catch (err) {
      self.postMessage({
        type: "error",
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
