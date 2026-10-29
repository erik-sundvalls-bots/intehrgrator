// Bundled for the browser check only (z3-solver's browser build is CommonJS and reads `global.initZ3`).
(globalThis as unknown as { global: unknown }).global = globalThis;
export { init } from "z3-solver";
