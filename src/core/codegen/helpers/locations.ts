/**
 * Stable URLs for conversion-script helper modules.
 *
 * Generated scripts import the raw GitHub URL (Deno and BaseX can load it).
 * The CodeMirror viewer rewrites that URL to the blob page so a click opens
 * the source. `main` tracks this repository; the helper bodies do not change
 * per mapping.
 */
export const HELPERS_GITHUB_REPO = "regionstockholm/intehrgrator";
export const HELPERS_GITHUB_REF = "main";

const RAW = `https://raw.githubusercontent.com/${HELPERS_GITHUB_REPO}/${HELPERS_GITHUB_REF}`;
const BLOB = `https://github.com/${HELPERS_GITHUB_REPO}/blob/${HELPERS_GITHUB_REF}`;

export const TYPESCRIPT_HELPERS_SPECIFIER =
  `${RAW}/src/core/codegen/helpers/typescript.ts`;
export const TYPESCRIPT_HELPERS_BLOB =
  `${BLOB}/src/core/codegen/helpers/typescript.ts`;

export const JAVA_RUNTIME_BLOB =
  `${BLOB}/src/core/codegen/helpers/java/IntehrgratorRuntime.java`;
export const JAVA_HANDLEBARS_BLOB =
  `${BLOB}/src/core/codegen/helpers/java/HandlebarsSupport.java`;
export const JAVA_CODED_TEXT_BLOB =
  `${BLOB}/src/core/codegen/helpers/java/CodedTextSupport.java`;

export const XQUERY_SOURCE_NS =
  "https://github.com/regionstockholm/intehrgrator/ns/helpers/source";
export const XQUERY_RM_NS =
  "https://github.com/regionstockholm/intehrgrator/ns/helpers/rm";
export const XQUERY_SHEETS_NS =
  "https://github.com/regionstockholm/intehrgrator/ns/helpers/sheets";

export const XQUERY_SOURCE_SPECIFIER =
  `${RAW}/src/core/codegen/helpers/xquery/source.xqm`;
export const XQUERY_RM_SPECIFIER =
  `${RAW}/src/core/codegen/helpers/xquery/rm.xqm`;
export const XQUERY_SHEETS_SPECIFIER =
  `${RAW}/src/core/codegen/helpers/xquery/sheets.xqm`;

export const XQUERY_SOURCE_BLOB =
  `${BLOB}/src/core/codegen/helpers/xquery/source.xqm`;
export const XQUERY_RM_BLOB =
  `${BLOB}/src/core/codegen/helpers/xquery/rm.xqm`;
export const XQUERY_SHEETS_BLOB =
  `${BLOB}/src/core/codegen/helpers/xquery/sheets.xqm`;

export const HANDLEBARS_HELPERS_BLOB =
  `${BLOB}/src/core/codegen/helpers/handlebars.ts`;

export const GO_TEMPLATE_HELPERS_BLOB =
  `${BLOB}/go/texttemplate/main.go`;

/** ehrtslib pin matching deno.json `ehrtslib/` (jsDelivr `gh@v0.11`). */
export const EHRTSLIB_BLOB_PREFIX =
  "https://github.com/ErikSundvall/ehrtslib/blob/v0.11/";
