/**
 * Handlebars helpers for generated conversion scripts.
 *
 * A generated `.hbs` file does not paste these functions. The workbench and a
 * pipeline register the same set before rendering. See
 * `createKintegrateHandlebars` for the VMS-Hbs registrations.
 */
export { createKintegrateHandlebars } from "../../output/handlebars_dialect.ts";
export { VMS_HBS_HELPERS } from "../../output/vms_hbs.ts";
