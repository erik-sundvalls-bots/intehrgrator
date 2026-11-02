/**
 * Source Format Handler public surface.
 * Prefer these exports over reaching into schema_loader / query_runtime directly.
 */

export {
  type SourceFormatHandler,
  type SourceFormatId,
  type SourceContext,
  registerSourceFormatHandler,
  getSourceFormatHandler,
  listSourceFormatIds,
  isSourceFormatId,
  detectSourceFormat,
} from "./format_handler.ts";

export {
  canonicalSyncPath,
  findNodeBySyncPath,
  pathToFontoxpath,
} from "./schema_loader.ts";

export { evaluate, createSourceContext, collectJsonNodes } from "./query_runtime.ts";

export { ExampleInstanceManager } from "./example_manager.ts";

export {
  type InstanceValidationIssue,
  validateInstanceAgainstSchema,
} from "./instance_validation.ts";
