# Tasks: intEHRgrator v1

Based on [PRD-intehrgrator-v1.md](./PRD-intehrgrator-v1.md)

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`. This helps track progress and ensures you don't skip any steps.

Update the file after completing each sub-task, not just after completing an entire parent task. If implementation steps happen to fulfil several things at once then ticking off several boxes is OK.

## Step 1 — Foundation

- [x] 1.1 Deno project (`deno.json`, import map, vendor script for ehrtslib)
- [x] 1.2 Core types (`MappingModel`, `SkeletonNode`, `ProjectBundle`, …)
- [x] 1.3 `MANDATORY_RM_ATTRIBUTES` mirror + RM attachment catalog
- [x] 1.4 Expression language (parse / serialize / validate)
- [x] 1.5 OPT skeleton generator (`generateSkeleton`)
- [x] 1.6 Mapping Model (`applyExpressionEdit`, `validateModel`)
- [x] 1.7 Mapping Specification engine (`toSpec`)
- [x] 1.8 Blockly RM + expression blocks and mutators
- [x] 1.9 TypeScript and Java export generators
- [x] 1.10 Unit tests for foundation modules

## Step 2 — Workbench

- [x] 2.1 Host abstraction (`HostAdapter`, `WebHostAdapter`)
- [x] 2.2 Source schema loader + example instance manager
- [x] 2.3 fontoxpath query runtime (JSON + XML)
- [x] 2.4 Test runner (in-browser slot evaluation preview)
- [x] 2.5 Project persistence (IndexedDB + `.intehrgrator` bundle)
- [x] 2.6 AI assist (copy prompt + import suggestions)
- [x] 2.7 Workbench controller (template, schema, examples, mapping, autoplay)
- [x] 2.8 Three-pane web app UI (Blockly + CodeMirror + output)
- [x] 2.9 Build pipeline (`deno task build` → `dist/`)
- [x] 2.10 GitHub Actions CI + Pages workflow

## Follow-ups (post-v1)

- [x] Full Blockly skeleton injection from OPT (currently slot rail + spec)
- [ ] Java Export UI + deeper TS codegen wiring to ehrtslib RM constructors
- [ ] VS Code extension host adapter
- [x] E2E browser tests for click-to-map (Workbench Test API + Playwright; see `docs/UI_TESTING.md`)
- [ ] E2E coverage for Autoplay debounce / tab-switch cache
