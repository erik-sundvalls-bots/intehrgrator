import { assertEquals } from "@std/assert";
import {
  findHits,
  formatFindCount,
  pickCurrentAfterRefresh,
  stepIndex,
} from "../src/ui/pane_find_core.ts";

const q = (search: string, extra: Partial<Parameters<typeof findHits>[1]> = {}) => ({
  search,
  caseSensitive: false,
  regexp: false,
  wholeWord: false,
  ...extra,
});

Deno.test("pane find: plain substring is case-insensitive by default, every occurrence", () => {
  const hits = findHits(["Blood pressure", "pressure cuff", "none"], q("PRESS"));
  assertEquals(hits, [
    { unit: 0, from: 6, to: 11 },
    { unit: 1, from: 0, to: 5 },
  ]);
});

Deno.test("pane find: match case, by word and regexp options", () => {
  assertEquals(findHits(["Press press"], q("press", { caseSensitive: true })), [
    { unit: 0, from: 6, to: 11 },
  ]);
  assertEquals(findHits(["systolic sys sys_x"], q("sys", { wholeWord: true })), [
    { unit: 0, from: 9, to: 12 },
  ]);
  assertEquals(findHits(["at0004 at0005", "x"], q("at000[45]", { regexp: true })), [
    { unit: 0, from: 0, to: 6 },
    { unit: 0, from: 7, to: 13 },
  ]);
});

Deno.test("pane find: empty query, invalid regexp and zero-width regexp give no hits", () => {
  assertEquals(findHits(["abc"], q("")), []);
  assertEquals(findHits(["abc"], q("(", { regexp: true })), null);
  assertEquals(findHits(["abc"], q("x*", { regexp: true })), []);
});

Deno.test("pane find: next / previous wrap around", () => {
  assertEquals(stepIndex(3, 0, 1), 1);
  assertEquals(stepIndex(3, 2, 1), 0);
  assertEquals(stepIndex(3, 0, -1), 2);
  assertEquals(stepIndex(0, -1, 1), -1);
});

Deno.test("pane find: refresh keeps the current hit while it still matches, else first", () => {
  const before = [{ unit: 0, from: 0, to: 3 }, { unit: 2, from: 1, to: 4 }];
  // Query grew: hit at unit 2 still starts at the same place.
  assertEquals(
    pickCurrentAfterRefresh(before, 1, [{ unit: 2, from: 1, to: 5 }, { unit: 3, from: 0, to: 4 }]),
    0,
  );
  assertEquals(
    pickCurrentAfterRefresh(before, 1, [{ unit: 0, from: 0, to: 3 }, { unit: 2, from: 1, to: 4 }]),
    1,
  );
  // Current hit gone: land on the first match.
  assertEquals(pickCurrentAfterRefresh(before, 1, [{ unit: 5, from: 0, to: 1 }]), 0);
  assertEquals(pickCurrentAfterRefresh(before, 1, []), -1);
  // Nothing selected before: auto-select the first hit.
  assertEquals(pickCurrentAfterRefresh([], -1, before), 0);
});

Deno.test("pane find: count label", () => {
  assertEquals(formatFindCount(0, 0, "{current} of {total}", "No matches"), "No matches");
  assertEquals(formatFindCount(1, 7, "{current} of {total}", "No matches"), "2 of 7");
});
