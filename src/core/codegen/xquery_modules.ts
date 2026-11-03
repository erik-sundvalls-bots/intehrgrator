import {
  XQUERY_RM_NS,
  XQUERY_RM_SPECIFIER,
  XQUERY_SOURCE_NS,
  XQUERY_SOURCE_SPECIFIER,
} from "./helpers/locations.ts";
import { xquerySheetsImport, xquerySheetsModule } from "./xquery_sheets.ts";

const SOURCE_BODY = [
    "(: --- Source access (fontoxpath-authored paths → XQuery 3.1) --- :)",
    "",
    "declare function ig:iterable-sequence($nodes as item()*) as item()* {",
    "  if ($nodes instance of array(*)) then $nodes?*",
    "  else $nodes",
    "};",
    "",
    "declare function ig:lookup-sequence($ctx as item()*, $path as xs:string) as item()* {",
    "  (: Dynamic or non-literal loop paths — prefer compile-time $. / / paths from export :) ",
    "  if (starts-with($path, \"$\"))",
    "  then let $nodes := ig:json-lookup($ctx, $path)",
    "       return if ($nodes instance of array(*)) then $nodes?* else $nodes",
    "  else error(",
    '    QName("http://intehrgrator.local/xquery", "DYNAMIC-LOOP-PATH"),',
    '    "Prefer compile-time literal loop PATH from intEHRgrator export; got: " || $path',
    "  )",
    "};",
    "",
    "declare function ig:string-at($ctx as item()*, $path as xs:string) as xs:string? {",
    "  let $value := ig:lookup($ctx, $path)",
    "  return if (empty($value)) then () else xs:string($value)",
    "};",
    "",
    "declare function ig:number-at($ctx as item()*, $path as xs:string) as xs:decimal? {",
    "  let $value := ig:lookup($ctx, $path)",
    "  return if (empty($value)) then () else xs:decimal($value)",
    "};",
    "",
    "declare function ig:boolean-at($ctx as item()*, $path as xs:string) as xs:boolean? {",
    "  let $value := ig:lookup($ctx, $path)",
    "  return if (empty($value)) then () else xs:boolean($value)",
    "};",
    "",
    "declare function ig:lookup($ctx as item()*, $path as xs:string) as item()* {",
    "  if (starts-with($path, \"$\"))",
    "  then ig:json-lookup($ctx, $path)",
    "  else error(",
    '    QName("http://intehrgrator.local/xquery", "DYNAMIC-XML-PATH"),',
    '    "Prefer compile-time literal XML paths from intEHRgrator export; got: " || $path',
    "  )",
    "};",
    "",
    "declare function ig:json-lookup($ctx as item()*, $path as xs:string) as item()* {",
    "  let $body := replace(replace(replace($path, \"^\\\\$\\\\.?\", \"\"), \"\\\\[(\\\\d+)\\\\]\", \".$1\"), \"\\\\[\\\\*\\\\]\", \".*\")",
    "  let $segments := tokenize($body, \"\\\\.\")[. ne \"\"]",
    "  return fold-left(",
    "    $segments,",
    "    $ctx,",
    "    function($acc as item()*, $seg as xs:string) as item()* {",
    "      if (empty($acc)) then ()",
    "      else if ($seg eq \"*\") then",
    "        if ($acc instance of array(*)) then $acc?* else $acc",
    "      else if ($seg castable as xs:integer) then",
    "        if ($acc instance of array(*)) then $acc?(xs:integer($seg)) else ($acc)[xs:integer($seg)]",
    "      else if ($acc instance of array(*)) then $acc?*?($seg)",
    "      else $acc?($seg)",
    "    }",
    "  )",
    "};",
    "",
].join("\n");

const RM_BODY = [
    "(: --- DV_* constructors (RM XML) --- :)",
    "",
    "declare function igrm:dv-text($value as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_TEXT" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function igrm:dv-coded-text($value as xs:string?, $code as xs:string?, $terminology as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_CODED_TEXT" },',
    "    element rm:value { $value },",
    "    element rm:defining_code {",
    "      element rm:terminology_id { element rm:value { $terminology } },",
    "      element rm:code_string { $code }",
    "    }",
    "  }",
    "};",
    "",
    "declare function igrm:dv-quantity($magnitude as xs:decimal?, $units as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_QUANTITY" },',
    "    element rm:magnitude { $magnitude },",
    "    element rm:units { $units }",
    "  }",
    "};",
    "",
    "declare function igrm:dv-count($magnitude as xs:integer?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_COUNT" },',
    "    element rm:magnitude { $magnitude }",
    "  }",
    "};",
    "",
    "declare function igrm:dv-boolean($value as xs:boolean?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_BOOLEAN" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function igrm:dv-date-time($value as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_DATE_TIME" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function igrm:dv-uri($value as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_URI" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function igrm:as-value($rm-type as xs:string, $value as item()*) as element()* {",
    "  switch ($rm-type)",
    '    case "DV_QUANTITY" return igrm:dv-quantity(($value)[1] ! xs:decimal(.), ())',
    '    case "DV_COUNT" return igrm:dv-count(($value)[1] ! xs:integer(.))',
    '    case "DV_INTEGER" return igrm:dv-count(($value)[1] ! xs:integer(.))',
    '    case "DV_BOOLEAN" return igrm:dv-boolean(($value)[1] ! xs:boolean(.))',
    '    case "DV_DATE_TIME" return igrm:dv-date-time(($value)[1] ! xs:string(.))',
    '    case "DV_DATE" return igrm:dv-date-time(($value)[1] ! xs:string(.))',
    '    case "DV_TIME" return igrm:dv-date-time(($value)[1] ! xs:string(.))',
    '    case "DV_URI" return igrm:dv-uri(($value)[1] ! xs:string(.))',
    '    case "DV_EHR_URI" return igrm:dv-uri(($value)[1] ! xs:string(.))',
    '    case "DV_CODED_TEXT" return igrm:dv-coded-text(($value)[1] ! xs:string(.), (), ())',
    "    default return igrm:dv-text(($value)[1] ! xs:string(.))",
    "};",
    "",
].join("\n");

export function xquerySourceModule(): string {
  return [
    `module namespace ig = "${XQUERY_SOURCE_NS}";`,
    "",
    SOURCE_BODY,
    "",
  ].join("\n");
}

export function xqueryRmModule(): string {
  return [
    `module namespace igrm = "${XQUERY_RM_NS}";`,
    'declare namespace rm = "http://schemas.openehr.org/v1";',
    'declare namespace xsi = "http://www.w3.org/2001/XMLSchema-instance";',
    "",
    RM_BODY,
    "",
  ].join("\n");
}

export function xquerySheetsModuleText(): string {
  return xquerySheetsModule();
}

/** Import lines for helper modules actually referenced by a generated query. */
export function xqueryHelperImports(script: string): string[] {
  const lines: string[] = [];
  if (/\big:/.test(script)) {
    lines.push(`import module namespace ig = "${XQUERY_SOURCE_NS}" at "${XQUERY_SOURCE_SPECIFIER}";`);
  }
  if (/\bigrm:/.test(script)) {
    lines.push(`import module namespace igrm = "${XQUERY_RM_NS}" at "${XQUERY_RM_SPECIFIER}";`);
  }
  if (/\bigsh:/.test(script)) lines.push(xquerySheetsImport());
  return lines;
}

export interface XQueryHelperModule {
  prefix: string;
  namespace: string;
  at: string;
  text: string;
}

export function xqueryHelperModules(): XQueryHelperModule[] {
  return [
    { prefix: "ig", namespace: XQUERY_SOURCE_NS, at: XQUERY_SOURCE_SPECIFIER, text: xquerySourceModule() },
    { prefix: "igrm", namespace: XQUERY_RM_NS, at: XQUERY_RM_SPECIFIER, text: xqueryRmModule() },
    {
      prefix: "igsh",
      namespace: "https://github.com/regionstockholm/intehrgrator/ns/helpers/sheets",
      at: "https://raw.githubusercontent.com/regionstockholm/intehrgrator/main/src/core/codegen/helpers/xquery/sheets.xqm",
      text: xquerySheetsModule(),
    },
  ];
}
