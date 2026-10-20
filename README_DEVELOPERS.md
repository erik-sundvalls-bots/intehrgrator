# intEHRgrator — Developer guide

Technical setup and architecture pointers for contributors and AI-assisted development.

For terms and definitions used in this repo, including in this readme, see [CONTEXT.md](CONTEXT.md).

**End-user docs:** [README.md](README.md) · [docs/TUTORIAL.md](docs/TUTORIAL.md)

## Project persistence

The web app stores mapping projects in its **IndexedDB** storage.

The desktop app also saves data using IndexedDB, through its embedded browser engine (OS webview).

Saves are done as debounced **autosave** (~10 s after edits) plus named **Save as** snapshots. Details: [docs/PROJECT_PERSISTENCE.md](docs/PROJECT_PERSISTENCE.md) and [Autosave & Status Bar](docs/UI_ARCHITECTURE.md#autosave--status-bar) in `docs/UI_ARCHITECTURE.md`. Portable backup is the `.intehrgrator` export/import path.

## Prerequisites

- **[Deno](https://docs.deno.com/runtime/getting_started/installation/)** 2.9+ — the project runtime, task runner, test runner, and desktop packager. We use Deno instead of Node/npm for installs, linting, testing, and builds.
- **Go 1.22+** (optional) — only to rebuild the vendored Go `text/template` WASM (`deno task wasm:go-template`).
- **Playwright** (optional) — installed automatically by `deno task test:ui` for browser tests.

## How to run locally

install deno, and then:

```bash
git clone https://github.com/regionstockholm/intehrgrator.git
cd intehrgrator
deno task vendor   # clone example archetypes; refresh the local ehrtslib validator override
deno task build  # build web app into /dist
deno task dev`  # start and serve on `http://localhost:5173`
```

NOTE: ehrtslib is not cloned. `deno.json` imports it from the jsDelivr URL for release [v0.5.1](https://github.com/ErikSundvall/ehrtslib/releases/tag/v0.5.1) (includes [ehrtslib #132](https://github.com/ErikSundvall/ehrtslib/pull/132) canonical-strict type registration). `deno task vendor` still clones example archetypes, and it rewrites one local file, `vendor/ehrtslib-overrides/validation/template_validator.ts`, when upstream `TemplateValidator` still needs sibling constraint matching patches (`scripts/patch-ehrtslib-validator.ts`). Re-run vendor after pull if openEHR validation tests fail oddly.

## Tests

Strategy, seams, facets, and CI gates: **[docs/TESTING.md](docs/TESTING.md)**. Playwright harness: [docs/UI_TESTING.md](docs/UI_TESTING.md).

| Layer | Command | When it runs |
|-------|---------|----------------|
| Unit + Agent/MCP (`test/`, not `test/ui`) | `deno task test` | Locally; CI on every PR; Pages; release |
| UI / Playwright (`test/ui/`) | `deno task test:ui` | Locally; CI on every PR; release (must pass before publish) |
| Unit then UI | `deno task test:all` | Local convenience |
| Optional BaseX XQuery golden | `deno task test:xquery-engine` | When BaseX is on `PATH` (skips otherwise) |

The UI **green-path** (`test/ui/green_path_test.ts`) walks load → Click-to-Map → RM COMPOSITION / Defaults / Optional RM Insertion → Test Run → Generated Export. Add new Mapping Editor chrome as a focused `test/ui/` case; extend the green-path when the change is a major authoring step.

## Deno tasks

| Task | Purpose |
| ------ | --------- |
| `deno task vendor` | Clone example archetypes and refresh the local ehrtslib TemplateValidator override |
| `deno task build` | Static site → `dist/` (includes `examples/` + `test/fixtures/`) (+ desktop www staging) |
| `deno task dev` | Serve `dist/` on `http://localhost:5173` (re-run `build` after source changes; if UI looks half-updated, open with `?nopwa=1` or hard-refresh to bypass a stale service worker) |
| `deno task test` | Unit + Agent tests (`test/`, parallel, no browser) |
| `deno task test:ui` | Playwright UI tests — see [docs/TESTING.md](docs/TESTING.md) and [docs/UI_TESTING.md](docs/UI_TESTING.md) |
| `deno task test:all` | `test` then `test:ui` |
| `deno task test:xquery-engine` | Optional BaseX golden (`test/xquery_engine_test.ts`) |
| `deno task lint` | `deno lint` on `src`, `test`, `scripts` |
| `deno task check` | Type-check TypeScript sources |
| `deno task desktop` | Build + run native window (`deno desktop`) |
| `deno task compile:desktop` | Platform binaries → `dist/release/` |
| `deno task mcp` | Stdio MCP server for IDE agents (proxies to `INTEHR_AGENT_URL` or embeds a headless `WorkbenchService`) |
| `deno task release -- --version X.Y.Z` | Bump, tag, push; CI publishes desktop + pinned Pages |
| `deno task release:no-test -- --version X.Y.Z` | Same as `release`, skip local unit tests (`--no-test`); CI still tests the tag |
| `deno task wasm:go-template` | Rebuild Go template WASM in `web/wasm/` |

### GitHub Pages

Every push to `main` deploys the bleeding-edge web app. `deno task release` also publishes an immutable copy under `/vX.Y/` and updates [versions.json](https://regionstockholm.github.io/intehrgrator/versions.json).

`versions.json` also carries a `recommended` field naming the tag (e.g. `"v0.7.5"`) the web app suggests end users stick to. It defaults to the newest published release tag on every deploy, but a still-published previous recommendation is preserved across deploys unless overridden. To pin an older release as recommended (e.g. while a new one is still shaking out), commit a `RECOMMENDED_VERSION` file at the repo root containing just the tag; `scripts/assemble-pages.ts` reads it (or the `RECOMMENDED_VERSION` env var) on the next Pages deploy. Visiting any non-recommended version of the deployed site (including the bleeding-edge root) shows a popup linking to the recommended version, the tutorial, and the README.

CI runs **`deno task vendor`** (example archetypes, plus the local TemplateValidator override). ehrtslib itself stays on the jsDelivr pin in `deno.json`.

## Releases

Maintainers cut releases with **`deno task release`** (not GitHub **Releases → Draft a new release** alone). The Deno script bumps version files, runs vendor/build/tests locally, commits if needed, creates an annotated tag, and pushes `HEAD` + the tag. **GitHub Actions** (`.github/workflows/release.yml`) runs on the tag: vendor → unit tests → build → UI tests → frozen GitHub Pages under `https://regionstockholm.github.io/intehrgrator/<tag>/` → desktop binaries → GitHub Release assets.

### Happy path (new version)

1. Work from a clean `main` (or agreed release branch). Ensure `git` and `gh` auth work (`deno task release` checks `gh` unless `--dry-run`).
2. Run `deno task release -- --version X.Y.Z` (or `--current` to tag the version already in `deno.json`). Prefer the `--` separator so Deno does not swallow script flags.
3. Locally the script may bump `deno.json`, `package.json`, `scripts/desktop.compile.json`, and `APP_VERSION`; run `deno task vendor` (unless skipped), unit tests (unless `--no-test`), and `deno task build`; then commit, tag, and push.
4. The tag push triggers `release.yml` (unit + UI must pass before publish).

**Release notes** live in [`CHANGELOG.md`](CHANGELOG.md). Feature and fix PRs add a line under **Unreleased**; the release PR (version bump) renames that section to the new version and date. The GitHub Release description and the annotated tag message link to `CHANGELOG.md` at the tag.

Example: package version `0.8.8` → tag **`v0.8.8`**. Patch segment `0` is special: `0.8.0` → tag **`v0.8`** (see `releaseTagForVersion` in `scripts/release_version.ts`).

### Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Validate and build; no commit, tag, or push. Version files may still be rewritten locally — revert before committing if you only wanted a smoke run. |
| `--no-test` / `deno task release:no-test` | Skips **local** unit tests only; CI still runs unit + UI on the tag. |
| `--message` | Annotated tag title (default: `intEHRgrator desktop <version>`); a tag-pinned `CHANGELOG.md` link is always appended. |

### Immutable published tags vs recovery

Frozen Pages builds for a tag are **immutable**: `assembleReleasePagesSite` errors if that tag is already listed in `versions.json`, and `release.yml` assembles Pages **before** desktop upload.

- **Routine fix after a successful release:** ship a **new** version and tag (e.g. `0.8.9` / `v0.8.9`). Do not try to rebuild `v0.8.8` in place.
- **`workflow_dispatch` → “Existing release tag”** on `release.yml` is for **recovery** when the first Actions run failed *before* that version was published to Pages — not for republishing. Re-dispatching a tag already on Pages typically fails at assemble and does not refresh what users already have.

### `deno task release` vs GitHub “Draft a new release”

| | `deno task release` + tag → `release.yml` | GitHub **Draft a new release** UI |
|--|--|--|
| Bumps version files | Yes (unless `--current`) | No |
| Enforces `releaseTagForVersion` | Yes | Easy to pick a mismatched tag |
| Tests, frozen `/v…/` Pages, desktop via CI | On tag push | Only if a new `v*` tag is created/pushed; no version bump |
| Creates GitHub Release assets | Via Actions after tag | Yes (primary UI purpose) |

Release notes go in `CHANGELOG.md` (in the release PR), not in the GitHub Release UI; use that UI only for extra attachments, not as a substitute for the guided release path. A future Actions “make new release” UI is tracked in [#220](https://github.com/regionstockholm/intehrgrator/issues/220).

### Recommended end-user version

`versions.json` field **`recommended`** drives the “not on recommended version” popup and the stable `/recommended/` alias (which redirects directly to the active recommended release). On assemble, precedence is: `RECOMMENDED_VERSION` env or repo-root [`RECOMMENDED_VERSION`](RECOMMENDED_VERSION) file → else keep the previous recommendation if still published → else newest tag. To promote a release (e.g. `v0.8.8`), commit `RECOMMENDED_VERSION` containing that tag and let the next Pages deploy (main and/or release assemble) run.

Bleeding-edge site root (`main` Pages) is not the same as the recommended stable tag.

## Repository layout

| Path | Role |
|------|------|
| `src/core/` | Mapping Model, codegen, persistence, AI prompt/import |
| `src/blockly/` | openEHR blocks, VMS profile, generators |
| `src/workbench/` | UI controller, trees, CodeMirror, mapping spec |
| `src/host/` | `HostAdapter` seam (web + VS Code webview) |
| `src/desktop/` | `deno desktop` entry, Agent API HTTP server |
| `src/agent/` | MCP stdio server |
| `web/` | HTML/CSS entry; bundled to `dist/bundle.js` |
| `test/` | Deno unit tests + fixtures |
| `test/ui/` | Playwright tests (Workbench Test API) |
| `docs/adr/` | Architecture Decision Records |
| `docs/design/` | Design investigations |
| `docs/planning/` | v1 implementation task list (archived chunks in `docs/historical-archive/`) |
| `docs/historical-archive/` | Superseded drafts |

## Architecture docs

| Topic | Document |
|-------|----------|
| **Glossary** (canonical terms) | [CONTEXT.md](CONTEXT.md) |
| **ADRs** (decisions) | [docs/adr/](docs/adr/) |
| UI layout & interactions | [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md) |
| Blockly blocks & generators | [docs/BLOCKLY_INTEGRATION.md](docs/BLOCKLY_INTEGRATION.md) |
| Mapping spec & sync | [docs/MAPPING_SPECIFICATION.md](docs/MAPPING_SPECIFICATION.md) |
| Source formats & XPath | [docs/SOURCE_FORMATS.md](docs/SOURCE_FORMATS.md) · [docs/SOURCE_QUERY.md](docs/SOURCE_QUERY.md) |
| Project persistence | [docs/PROJECT_PERSISTENCE.md](docs/PROJECT_PERSISTENCE.md) |
| AI suggestion format | [docs/AI_SUGGESTION_FORMAT.md](docs/AI_SUGGESTION_FORMAT.md) |
| Agent / MCP workflow | [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) |
| Built-in MCP architecture | [docs/MCP_ARCHITECTURE.md](docs/MCP_ARCHITECTURE.md) |
| Testing strategy | [docs/TESTING.md](docs/TESTING.md) |
| UI testing (Playwright harness) | [docs/UI_TESTING.md](docs/UI_TESTING.md) |
| Planning | [GitHub Issues](https://github.com/regionstockholm/intehrgrator/issues) — see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) |
| Archived roadmap | [docs/historical-archive/ROADMAP.md](docs/historical-archive/ROADMAP.md) |
| Deferred ideas | [docs/future/](docs/future/) |

## AI-assisted development

### Agent instructions

- **[AGENTS.md](AGENTS.md)** — documentation sources, Deno toolchain, issue tracker, domain docs.
- **[docs/TESTING.md](docs/TESTING.md)** — test seams, facets, green-path, CI gates (read when adding tests).
- **[docs/agents/](docs/agents/)** — issue tracker conventions, triage labels, domain modelling.

### Skills (Matt Pocock engineering skills)

The repo ships [Matt Pocock skills](https://github.com/mattpocock/skills) in `.cursor/skills/` and `.agents/skills/` for Cursor and other agents:

```bash
npx skills@latest add mattpocock/skills --agent cursor --skill '*' --yes --copy
```

Useful skills for this project:

| Skill | When |
|-------|------|
| `domain-modeling` | Editing CONTEXT.md or ADRs |
| `implement` / `tdd` | Feature work test-first |
| `diagnosing-bugs` | Hard bugs with runtime evidence |
| `code-review` | Reviewing diffs against standards and spec |
| `triage` | GitHub issue triage |
| `research` | Primary-source investigation |

Project-specific:

| Skill | When |
|-------|------|
| `intehrgrator-mapping` | Driving mappings via desktop Agent API / MCP |

Refresh project skills from the lockfile in `.agents/skills/` when upstream changes.

### Recommended MCP servers

| Server | Purpose |
|--------|---------|
| **DeepWiki** | ehrtslib, archie, openEHR repos — `read_wiki_structure`, `ask_question` |
| **openEHR assistant** | Archetypes, templates, terminology, spec lookup |
| **intEHRgrator** (local) | `deno task mcp` against a running desktop session, or headless with no `INTEHR_AGENT_URL`. Desktop also accepts `intEHRgrator --headless --load project.intehrgrator`. |

Configure MCP in `.cursor/mcp.json` (see [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) for the desktop URL). How the built-in MCP, the Agent API and AI chat share one tool set: [docs/MCP_ARCHITECTURE.md](docs/MCP_ARCHITECTURE.md).

### Issue tracker

GitHub Issues via `gh`. Conventions: [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md). Triage labels: [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

## Libraries

- [ehrtslib](https://github.com/ErikSundvall/ehrtslib) — openEHR TypeScript, imported from the jsDelivr pin in `deno.json`
- [openEHR-model-examples](https://github.com/Ehrlibs/openEHR-model-examples) — demo templates
- [fontoxpath](https://github.com/FontoXML/fontoxpath) — source XPath evaluation
- [Blockly 11](https://developers.google.com/blockly) + [CodeMirror 6](https://codemirror.net/)
