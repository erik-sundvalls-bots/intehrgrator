/**
 * Ensures stock Blockly message table (Blockly.Msg) is populated with English fallback
 * and intEHRgrator custom message keys.
 *
 * Prevents "TypeError: Cannot read properties of undefined (reading 'alt')" when stock
 * blocks with dropdown fields (e.g. lists_getIndex, logic_compare, math_number_property)
 * are instantiated or deserialized before a full UI locale is loaded.
 */
import { Blockly } from "./blockly_core.ts";
import * as enMsg from "blockly/msg/en";
import { msg } from "./i18n/custom_msg.ts";

export function ensureStockBlocklyMessages(): void {
  const Msg = (Blockly as unknown as { Msg?: Record<string, string> }).Msg;
  if (!Msg?.LISTS_GET_INDEX_FIRST) {
    const anyMod = enMsg as { default?: Record<string, string> } & Record<string, string>;
    const table = anyMod.default && typeof anyMod.default === "object" ? anyMod.default : anyMod;
    Blockly.setLocale(table);
  }
  const custom = msg("en");
  const msgObj = (Blockly as unknown as { Msg?: Record<string, string> }).Msg;
  if (msgObj && !msgObj["INTEHR_SOURCE_QUERY"]) {
    msgObj["INTEHR_SOURCE_QUERY"] = custom.SOURCE_QUERY;
    msgObj["INTEHR_SOURCE_QUERY_TOOLTIP"] = custom.SOURCE_QUERY_TOOLTIP;
    msgObj["INTEHR_FOR_EACH_SOURCE_PREFIX"] = custom.FOR_EACH_SOURCE_PREFIX;
    msgObj["INTEHR_FOR_EACH_SOURCE_IN"] = custom.FOR_EACH_SOURCE_IN;
    msgObj["INTEHR_FOR_EACH_SOURCE_NODES"] = custom.FOR_EACH_SOURCE_NODES;
    msgObj["INTEHR_FOR_EACH_SOURCE_DO"] = custom.FOR_EACH_SOURCE_DO;
    msgObj["INTEHR_FOR_EACH_SOURCE_TOOLTIP"] = custom.FOR_EACH_SOURCE_TOOLTIP;
  }
}

