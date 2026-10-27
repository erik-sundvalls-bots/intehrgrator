/**
 * THROWAWAY SPIKE for issue #41 — not product code; not imported by the app or the tests.
 *
 * Encodes three properties of real fixture Decision tables as SMT, solves them with
 * `z3-solver` (Z3 compiled to WASM) under Deno, and replays every counterexample on the
 * app's own `evaluateDecisionTable` (the Test Run / preview oracle).
 *
 *   cd experiments/z3-spike && deno task spike
 *
 * Writes `results.json` and `sbp_band_gap.smt2` next to this file.
 *
 * The encoder below is hand-written to mirror src/core/sheets/decision_table.ts
 * (FIRST hit policy; a catch-all row matches only when no earlier row matched; don't-care
 * glyphs; numeric predicates `a..b`, `>= n`, `< n`, …; otherwise string equality).
 * It is NOT generated from the Mapping Model — that generator is what #41 would build.
 */
import { evaluateDecisionTable, isDontCare, parseNumericPredicate } from "../../src/core/sheets/decision_table.ts";
import type { SheetDocument } from "../../src/core/sheets/types.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => JSON.parse(Deno.readTextFileSync(new URL(p, ROOT)));
const ms = (t0: number) => Math.round((performance.now() - t0) * 10) / 10;

const timings: Record<string, number> = {};
let t = performance.now();
const { init, killThreads } = await import("z3-solver");
timings.import_ms = ms(t);
t = performance.now();
const api = await init();
const { Context } = api;
timings.init_wasm_ms = ms(t);
const Z3 = Context("main");
/** Z3 prints rationals as `279/2` (or `(/ 279.0 2.0)` in SMT-LIB form). */
function ratToNumber(s: string): number {
  const m = /^\(?\/?\s*(-?[\d.]+)\s*\/?\s*([\d.]+)?\)?$/.exec(s.trim());
  if (!m) throw new Error(`cannot read rational ${s}`);
  return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
}
// deno-lint-ignore no-explicit-any
type B = any;

function table(path: string, name: string): SheetDocument {
  const raw = read(path);
  const arr = Array.isArray(raw) ? raw : [raw];
  const s = arr.find((x: SheetDocument) => x.name === name);
  if (!s) throw new Error(`${name} not in ${path}`);
  return s;
}

/**
 * Symbolic inputs: one String per condition column; columns listed in `numeric` also get a
 * Real, used by numeric-predicate cells. (Simplification: the String and the Real of the same
 * column are not linked, so a numeric column's equality cells are over-approximated.)
 */
function encode(sheet: SheetDocument, numeric: Set<string>, prefix = "") {
  const meta = sheet.decisionColumns ?? [];
  const conds = sheet.headers.map((h, x) => ({ h, x })).filter(({ x }) => meta[x]?.role === "condition");
  const vars: Record<string, { s: B; n?: B }> = {};
  for (const { h } of conds) {
    vars[h] = { s: Z3.String.const(`${prefix}${h}`) };
    if (numeric.has(h)) vars[h].n = Z3.Real.const(`${prefix}${h}_num`);
  }
  const cellMatch = (cell: unknown, h: string): B => {
    if (isDontCare(cell as never)) return Z3.Bool.val(true);
    const pred = parseNumericPredicate(cell as never);
    const n = vars[h].n;
    if (pred) {
      if (!n) return Z3.Bool.val(false); // app: non-numeric input never satisfies a numeric predicate
      switch (pred.kind) {
        case "range":
          return Z3.And(n.ge(pred.min), n.le(pred.max));
        case "ge":
          return n.ge(pred.value);
        case "gt":
          return n.gt(pred.value);
        case "le":
          return n.le(pred.value);
        case "lt":
          return n.lt(pred.value);
        case "eq":
          return n.eq(pred.value);
      }
    }
    return vars[h].s.eq(Z3.String.val(String(cell)));
  };
  const match: B[] = sheet.values.map((row, y) =>
    sheet.rowCatchAll?.[y]
      ? Z3.Bool.val(true)
      : Z3.And(Z3.Bool.val(true), ...conds.map(({ h, x }) => cellMatch(row[x], h)))
  );
  const earlier = (y: number): B => (y === 0 ? Z3.Bool.val(false) : Z3.Or(...match.slice(0, y)));
  const selected = match.map((m, y) => Z3.And(m, Z3.Not(earlier(y))));
  const noMatch = Z3.Not(Z3.Or(...match));
  return { vars, conds, match, selected, noMatch };
}

async function solve(label: string, assertions: B[]) {
  const s = new Z3.Solver();
  for (const a of assertions) s.add(a);
  const t0 = performance.now();
  const r = await s.check();
  const solve_ms = ms(t0);
  timings[`${label}_ms`] = solve_ms;
  return { r, s, solve_ms };
}

const results: Record<string, unknown> = {};

// ---------------------------------------------------------------------------------------------
// P1  sbp_band (dummy-json-vitals): completeness of a numeric Decision table vs Source Schema,
//     and required-slot coverage of the target schema (`band` is required).
// ---------------------------------------------------------------------------------------------
{
  const path = "test/fixtures/dummy-json-vitals/mapping/ai-created-sbp-band.decision-table.json";
  const sheet = table(path, "sbp_band");
  const src = read("test/fixtures/dummy-json-vitals/source.schema.json");
  const tgt = read("test/fixtures/dummy-json-vitals/mapping/ai-created-sbp-band.target.schema.json");
  const srcType = src.properties.systolic.type; // "number" → Real (not Int)
  const bandRequired = (tgt.required as string[]).includes("band");
  const e = encode(sheet, new Set(["sbp"]));
  const sbp = e.vars.sbp.n;
  // Source precondition: systolic is a JSON number (any Real). Asking: can no row match?
  const pre = new Z3.Solver();
  pre.add(e.noMatch);
  const smtText = pre.toString(); // SMT-LIB text before solving (what an emitter would write)
  const { r, s, solve_ms } = await solve("p1_sbp_band_gap", [e.noMatch]);
  const p1: Record<string, unknown> = { path, srcType, bandRequired, verdict: r, solve_ms };
  if (r === "sat") {
    const v = s.model().eval(sbp, true);
    const asNumber = ratToNumber(v.toString());
    p1.counterexample = { sbp: v.toString(), sbp_decimal: asNumber };
    p1.replay_evaluateDecisionTable = evaluateDecisionTable(sheet, { sbp: asNumber }, "band");
    p1.smtlib_bytes = smtText.length;
    Deno.writeTextFileSync(new URL("sbp_band_gap.smt2", import.meta.url), smtText + "(check-sat)\n(get-model)\n");
  }
  // Same question restricted to integers (what the three demo instances happen to contain).
  const { r: rInt } = await solve("p1_sbp_band_gap_int", [e.noMatch, Z3.ToInt(sbp).eq(sbp)]);
  p1.verdict_if_integer = rInt;
  // Round-trip through SMT-LIB text (the "emit .smt2" architecture): fresh solver, fromString.
  {
    const text = smtText;
    const s2 = new Z3.Solver();
    const t0 = performance.now();
    s2.fromString(text);
    const r2 = await s2.check();
    p1.smtlib_roundtrip = { verdict: r2, parse_and_solve_ms: ms(t0) };
  }
  results.p1_sbp_band = p1;
}

// ---------------------------------------------------------------------------------------------
// P2  medication_ism (administrerad-medicinsk-onkologisk-behandling, Karda): value-set
//     consistency of Decision table outputs vs the target OPT's ISM_TRANSITION constraints,
//     plus a sensitivity check (do the outputs depend on the inputs at all?).
// ---------------------------------------------------------------------------------------------
{
  const dir = "test/fixtures/administrerad-medicinsk-onkologisk-behandling/";
  const sheet = table(dir + "mapping/mapping.sheets.json", "medication_ism");
  const opt = Deno.readTextFileSync(
    new URL(dir + "target-schema/AdministreradMedicinskOnkologiskBehandlingPerSubstans.1.0.0-alpha.5.sv.en.opt", ROOT),
  );
  // Extract the C_CODE_PHRASE code lists the OPT allows on ISM_TRANSITION.
  const ism = opt.slice(opt.indexOf("<rm_type_name>ISM_TRANSITION</rm_type_name>"));
  const codes = (attr: string) => {
    const seg = ism.slice(ism.indexOf(`<rm_attribute_name>${attr}</rm_attribute_name>`));
    const end = seg.indexOf("</attributes>");
    return [...seg.slice(0, end).matchAll(/<code_list>([^<]+)<\/code_list>/g)].map((m) => m[1]);
  };
  const allowedCurrentState = codes("current_state"); // openehr terminology codes
  const allowedCareflow = codes("careflow_step"); // local at-codes
  // Code → rubric for what the table emits (openEHR terminology 532 = "completed"; at-code text
  // read from the OPT's sv term definitions, which is the label the table emits).
  const openehrRubric: Record<string, string> = { "532": "completed" };
  const careflowText = (code: string) => {
    const m = new RegExp(`<term_definitions code="${code}">\\s*<items id="text">([^<]+)</items>`).exec(opt);
    return m?.[1];
  };
  const allowedStateLabels = allowedCurrentState.map((c) => openehrRubric[c]).filter(Boolean);
  const allowedCareflowLabels = allowedCareflow.map(careflowText).filter(Boolean) as string[];

  const e = encode(sheet, new Set());
  const ix = (h: string) => sheet.headers.indexOf(h);
  const outOf = (h: string, sel: B[]) =>
    sel.reduceRight(
      (acc: B, cond: B, y: number) => Z3.If(cond, Z3.String.val(String(sheet.values[y][ix(h)])), acc),
      Z3.String.val("<null>"),
    );
  const curState = outOf("current_state", e.selected);
  const careflow = outOf("careflow_step", e.selected);
  const inSet = (x: B, xs: string[]) => Z3.Or(Z3.Bool.val(false), ...xs.map((v) => x.eq(Z3.String.val(v))));
  // Negated property: some input makes an output fall outside what the OPT allows.
  const { r } = await solve("p2_ism_valueset", [
    Z3.Not(Z3.And(inSet(curState, allowedStateLabels), inSet(careflow, allowedCareflowLabels))),
  ]);
  // Sensitivity: two input vectors that yield different (current_state, careflow_step)?
  const e2 = encode(sheet, new Set(), "b_");
  const { r: rSens } = await solve("p2_ism_sensitivity", [
    Z3.Or(
      Z3.Not(curState.eq(outOf("current_state", e2.selected))),
      Z3.Not(careflow.eq(outOf("careflow_step", e2.selected))),
    ),
  ]);
  const dead: number[] = [];
  for (let y = 0; y < sheet.values.length; y++) {
    const { r: ry } = await solve(`p2_ism_row${y + 1}_reachable`, [e.selected[y]]);
    if (ry === "unsat") dead.push(y + 1);
  }
  results.p2_medication_ism = {
    allowedCurrentState,
    allowedCareflow,
    allowedStateLabels,
    allowedCareflowLabels,
    verdict_outputs_outside_opt: r,
    verdict_outputs_depend_on_inputs: rSens,
    dead_rows: dead,
  };
}

// ---------------------------------------------------------------------------------------------
// P3  Every Decision table in the fixtures: dead (shadowed) rows under FIRST, and reachable
//     no-match (→ convert returns null) when the table has no catch-all.
// ---------------------------------------------------------------------------------------------
{
  const files = [
    ...Deno.readDirSync(new URL("test/fixtures/", ROOT)),
  ].flatMap((d) => {
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const f of Deno.readDirSync(new URL(rel, ROOT))) {
        const p = `${rel}${f.name}`;
        if (f.isDirectory) walk(p + "/");
        else if (f.name.endsWith(".sheets.json") || f.name.endsWith(".decision-table.json")) out.push(p);
      }
    };
    if (d.isDirectory) walk(`test/fixtures/${d.name}/`);
    return out;
  });
  // Source Schema preconditions we could read off the fixtures' schemas (JSON Schema enum / oneOf const).
  const bpSchema = read("test/fixtures/legacy-simulated-json/bp-schema.json");
  const seriesSchema = read("test/fixtures/legacy-simulated-json/bp-series-schema.json");
  const schemaDomain: Record<string, Record<string, string[]>> = {
    body_position: { position: bpSchema.properties.bodyPosition.enum },
    icd10_display: {
      code: seriesSchema.properties.diagnosis.oneOf.map((o: { properties: { code: { const: string } } }) =>
        o.properties.code.const
      ),
    },
  };
  const t0 = performance.now();
  let queries = 0;
  let maxQuery = 0;
  const findings: unknown[] = [];
  let tables = 0;
  for (const f of files.sort()) {
    const raw = read(f);
    for (const sheet of (Array.isArray(raw) ? raw : [raw]) as SheetDocument[]) {
      if (sheet.kind !== "decision-table") continue;
      tables++;
      const numeric = new Set(
        sheet.headers.filter((_, x) => sheet.values.some((row) => parseNumericPredicate(row[x] as never))),
      );
      const e = encode(sheet, numeric);
      // Inputs are present (non-empty) — absent optional source is a separate, by-design case.
      const present = e.conds.map(({ h }) => Z3.Not(e.vars[h].s.eq(Z3.String.val(""))));
      const legacy = f.startsWith("test/fixtures/legacy-simulated-json/");
      const domain = legacy ? schemaDomain[sheet.name] : undefined;
      const pre: B[] = [...present];
      // Columns whose cells are all JSON numbers (e.g. Obstetrix integer codes): input is a digit string.
      const intCols = e.conds.filter(({ x }) =>
        sheet.values.every((row, y) => sheet.rowCatchAll?.[y] || typeof row[x] === "number")
      );
      for (const { h } of intCols) pre.push(Z3.InRe(e.vars[h].s, Z3.Plus(Z3.Range("0", "9"))));
      if (domain) {
        for (const [h, vals] of Object.entries(domain)) {
          pre.push(Z3.Or(...vals.map((v) => e.vars[h].s.eq(Z3.String.val(v)))));
        }
      }
      const dead: number[] = [];
      const deadUnderSchema: number[] = [];
      for (let y = 0; y < sheet.values.length; y++) {
        const q0 = performance.now();
        const { r } = await solve("_scratch", [e.selected[y]]);
        maxQuery = Math.max(maxQuery, ms(q0));
        queries++;
        if (r === "unsat") dead.push(y + 1);
        else if (domain) {
          const { r: r2 } = await solve("_scratch", [e.selected[y], ...pre]);
          queries++;
          if (r2 === "unsat") deadUnderSchema.push(y + 1);
        }
      }
      let noMatch: unknown = "has catch-all";
      if (!sheet.rowCatchAll?.some(Boolean)) {
        const q0 = performance.now();
        const { r, s } = await solve("_scratch", [e.noMatch, ...pre]);
        maxQuery = Math.max(maxQuery, ms(q0));
        queries++;
        if (r === "sat") {
          const m = s.model();
          const cx: Record<string, unknown> = {};
          for (const { h } of e.conds) {
            const v = e.vars[h];
            cx[h] = v.n ? ratToNumber(m.eval(v.n, true).toString()) : JSON.parse(m.eval(v.s, true).toString());
          }
          // Replay: numeric-looking strings are passed as numbers when the table's cells are numbers.
          const replayIn = Object.fromEntries(
            Object.entries(cx).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]),
          );
          noMatch = { counterexample: cx, replay: evaluateDecisionTable(sheet, replayIn) };
        } else noMatch = r;
      }
      findings.push({
        file: f,
        table: sheet.name,
        rows: sheet.values.length,
        source_schema_precondition: domain ?? null,
        dead_rows: dead,
        dead_rows_given_source_schema: deadUnderSchema,
        no_match: noMatch,
        // What the app returns when the (optional) input is absent, if the table is invoked at all.
        absent_input_replay: evaluateDecisionTable(sheet, Object.fromEntries(e.conds.map(({ h }) => [h, ""]))),
      });
    }
  }
  delete timings["_scratch_ms"];
  results.p3_all_tables = { tables, queries, total_ms: ms(t0), max_query_ms: maxQuery, findings };
}

// ---------------------------------------------------------------------------------------------
// Pitfall check (from the AI conversation's "naive reassignment" example): encoding
// `unit = src.unit; if (unit == "mmHg") unit = "mm[Hg]"` as two assertions on ONE constant.
// ---------------------------------------------------------------------------------------------
{
  const naive = `(declare-const src_unit String)(declare-const unit String)
(assert (= unit src_unit))
(assert (ite (= unit "mmHg") (= unit "mm[Hg]") true))`;
  const a = new Z3.Solver();
  a.fromString(naive);
  const b = new Z3.Solver();
  b.fromString(naive + `(assert (= src_unit "mmHg"))`);
  results.pitfall_naive_reassignment = {
    whole_query: await a.check(), // sat — not "UNSAT" as the conversation claimed
    when_src_unit_is_mmHg: await b.check(), // unsat — that branch is silently pruned
  };
}

const wasm = new URL("z3-built.wasm", import.meta.resolve("z3-solver").replace(/build\/node\.js$/, "build/"));
let wasmBytes: number | string = "unknown";
try {
  wasmBytes = Deno.statSync(wasm).size;
} catch { /* npm cache layout differs */ }
const out = { z3_solver: "5.3.2", deno: Deno.version.deno, wasm_bytes: wasmBytes, timings, results };
Deno.writeTextFileSync(new URL("results.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
await killThreads(api.em); // otherwise z3-solver worker threads keep Deno alive
