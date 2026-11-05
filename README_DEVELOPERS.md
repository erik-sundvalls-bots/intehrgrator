# intEHRgrator — Developer guide

Technical setup and architecture pointers for contributors and AI-assisted development.

For terms and definitions used in this repo, including in this readme, see [CONTEXT.md](CONTEXT.md).

**End-user docs:** [README.md](README.md) · [docs/TUTORIAL.md](docs/TUTORIAL.md)

## Project persistence

The web app stores mapping projects in its **IndexedDB** storage.

The desktop app also saves data using IndexedDB, through its embedded browser engine (OS webview).

Saves are done as debounced **autosave** (~10 s after edits) plus named **Save as** snapshots. Details: [docs/PROJECT_PERSISTENCE.md](docs/PROJECT_PERSISTENCE.md) and [Autosave & Status Bar](docs/UI_ARCHITECTURE.md#autosave--status-bar) in `docs/UI_ARCHITECTURE.md`. Portable backup is the `.intehrgrator` export/import path.


## VS Code file projects

In addition to the web and desktop storage above, the VS Code extension works on file projects: a Git-backed project with separate source, mapping and output files. The same files can be checked headlessly with `deno task project:run`. See [VS Code file projects](docs/VS_CODE.md) for setup, reviewable results and the CI runner.

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

NOTE: ehrtslib is not cloned. `deno.json` (and `scripts/ehrtslib.compile.json`) import it, unpatched, from the jsDelivr URL for release [v0.11](https://github.com/ErikSundvall/ehrtslib/releases/tag/v0.11). `deno task vendor` only clones the example archetypes.

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
| `deno task desktop` | Build + run native window. Flags after `--` are forwarded (`--headless`, `--load`, `--language-plugin`, …) |
| `deno task compile:desktop` | Platform binaries → `dist/release/` |
| `deno task mcp` | Stdio MCP server for IDE agents (proxies to `INTEHR_AGENT_URL` or embeds a headless `WorkbenchService`) |
| `deno task release -- --version X.Y.Z` | Bump, tag, push; CI publishes desktop + pinned Pages |
| `deno task release:no-test -- --version X.Y.Z` | Same as `release`, skip local unit tests (`--no-test`); CI still tests the tag |
| `deno task wasm:go-template` | Rebuild Go template WASM in `web/wasm/` |

### GitHub Pages

Every push to `main` deploys the bleeding-edge web app. A release also publishes an immutable copy under `/vX.Y/` and updates [versions.json](https://regionstockholm.github.io/intehrgrator/versions.json).

`versions.json` also carries a `recommended` field naming the tag (e.g. `"v0.7.5"`) the web app suggests end users stick to. It defaults to the newest published release tag on every deploy, but a still-published previous recommendation is preserved across deploys unless overridden. To pin an older release as recommended (e.g. while a new one is still shaking out), commit a `RECOMMENDED_VERSION` file at the repo root containing just the tag; `scripts/assemble-pages.ts` reads it (or the `RECOMMENDED_VERSION` env var) on the next Pages deploy. Visiting any non-recommended version of the deployed site (including the bleeding-edge root) shows a popup linking to the recommended version, the tutorial, and the README.

CI runs **`deno task vendor`** (example archetypes, plus the local TemplateValidator override). ehrtslib itself stays on the jsDelivr pin in `deno.json`.

## Releases

Two entry points start a release. Each one prepares the version files, commits when they change, and pushes an annotated tag. **Publish is only** [`.github/workflows/release.yml`](.github/workflows/release.yml), which runs on that tag push: vendor → unit tests → build → UI tests → frozen GitHub Pages under `https://regionstockholm.github.io/intehrgrator/<tag>/` → desktop binaries → VS Code VSIX (`dist/release/intEHRgrator.vsix`) → GitHub Release assets.

The tag name comes from `releaseTagForVersion` in `scripts/release_version.ts`. Package version `0.8.8` → tag **`v0.8.8`**. Patch segment `0` drops: `0.8.0` → tag **`v0.8`**.

**Release notes** live in [`CHANGELOG.md`](CHANGELOG.md). Feature and fix PRs add a line under **Unreleased**. Both entry points move those notes under `## [X.Y.Z]` (the heading and date already there, or a new one), leave **Unreleased** empty, and point the compare link at the new tag. The GitHub Release description and the annotated tag message link to `CHANGELOG.md` at the tag. On Actions the changelog date is the UTC date of the run.

### Actions: Release create (new version)

**Actions → Release create → Run workflow** ([`.github/workflows/release-create.yml`](.github/workflows/release-create.yml)). The workflow calls `scripts/release_create.ts`, which uses the same bump, changelog, commit message, and tag helpers as the CLI. It does not run tests or upload assets.

| Input | Default | Effect |
|-------|---------|--------|
| `version` | required | Semver written into `deno.json`, `package.json`, `scripts/desktop.compile.json`, and `APP_VERSION`. |
| `ref` | `main` | Branch that receives the version-bump commit. A branch name, such as `main`. |
| `update_recommended` | false | Also write repo-root [`RECOMMENDED_VERSION`](RECOMMENDED_VERSION) to the new tag. Leave this off unless this release should be the version the web app suggests. |
| `dry_run` | false | Check the version, the tag, and Pages. No commit, tag, or push. |

The run refuses when the derived tag already exists on `origin`, when Pages [`versions.json`](https://regionstockholm.github.io/intehrgrator/versions.json) already lists it, or when `/<tag>/index.html` is already published. If Pages cannot be read, or the index status is anything other than 200 or 404, the run stops and pushes nothing. The push is `git push --atomic` (no `--force`): the branch and the tag land together, and a branch that moved is rejected.

Dispatches of the same `version` share a concurrency group and do not cancel each other, so two runs cannot both create that tag. A second version can run at the same time; if both try to push the same branch, the atomic push rejects the one that loses the race.

The commit message is `chore: release X.Y.Z`. [`pages.yml`](.github/workflows/pages.yml) skips those commits, so the tag workflow owns the Pages deploy. The annotated tag title is the default (`intEHRgrator desktop <version>` plus the changelog link). Use the CLI `--message` flag when the title should be different.

**Who can run it.** The job uses the GitHub Environment `release`. Create that environment and add required reviewers before the first real dispatch (Settings → Environments). The workflow file cannot turn reviewers on. Until reviewers are required, anyone who can dispatch workflows can start a run once the environment exists.

**Token.** Store a fine-grained personal access token or GitHub App installation token as the Actions secret `RELEASE_PAT` (an environment secret on `release` is the tighter place). It needs Contents read and write on this repository. The workflow's own `GITHUB_TOKEN` stays read-only. A push made with `GITHUB_TOKEN` does not start other workflows, so `release.yml` would not publish Pages, desktop binaries, or the GitHub Release. `dry_run` checks out with the read-only token and does not need `RELEASE_PAT`.

The same script can be dry-run locally (it still refuses a tag that exists or is on Pages; it does not push):

```bash
deno run -A scripts/release_create.ts --version 0.8.9 --dry-run
```

### Command line

`deno task release` is the other entry point. It needs `git` and a clean work tree. It does not need the GitHub CLI. Your git credentials push the tag, and that push starts `release.yml`.

1. Clean `main`, or another branch you mean to release from.
2. `deno task release -- --version X.Y.Z`, or `--current` to tag the version already in `deno.json`. Keep the `--` so Deno does not swallow the flags.
3. The script bumps version files unless `--current`, moves CHANGELOG notes, runs `deno task vendor`, unit tests (unless `--no-test`), and `deno task build`, then commits if needed, tags, and pushes `HEAD` and the tag.

The CLI does not change `RECOMMENDED_VERSION`. It also does not pre-check Pages; `release.yml` still refuses to assemble a tag that is already listed.

### Flags (`deno task release`)

| Flag | Effect |
|------|--------|
| `--dry-run` | Validate and build; no commit, tag, or push. Version files may still be rewritten locally — revert before committing if you only wanted a smoke run. |
| `--no-test` / `deno task release:no-test` | Skips **local** unit tests only; CI still runs unit + UI on the tag. |
| `--message` | Annotated tag title (default: `intEHRgrator desktop <version>`); a tag-pinned `CHANGELOG.md` link is always appended. |

### Immutable published tags, and recovery of an existing tag

Frozen Pages builds for a tag are **immutable**: `assembleReleasePagesSite` errors if that tag is already listed in `versions.json`, and `release.yml` assembles Pages **before** desktop upload.

- **Routine fix after a successful release:** ship a **new** version with **Release create** or `deno task release` (for example `0.8.9` / `v0.8.9`). Rebuilding an existing `/v0.8.8/` in place is not available.
- **Release create** is how you make a **new** tag from Actions.
- **`release.yml` → Run workflow → “Existing release tag”** is recovery for a tag that **already exists**, when the first publish stopped before that version reached Pages. It does not bump version files and it does not create a tag. Re-dispatching a tag already on Pages fails at assemble and leaves the frozen site as it is.

### Why GitHub “Draft a new release” is not this flow

**Releases → Draft a new release** creates a GitHub Release and can create a tag. A new `v*` tag still starts `release.yml`, and that workflow uploads assets when the Release already exists. Draft a new release still leaves the version bump, the tag rules, and the Pages check to you:

| | Release create, or `deno task release` | Draft a new release |
|--|--|--|
| Bumps `deno.json`, `package.json`, `scripts/desktop.compile.json`, and `APP_VERSION` | Yes (CLI `--current` tags the version already in the files) | The tagged commit has to contain them already |
| Tag follows `releaseTagForVersion` (`0.8.0` → `v0.8`) | Yes | Whatever tag you type |
| Refuses a tag that already exists or is already on Pages | Release create refuses before the push; assemble also rejects a Pages path that is already published | Whatever tag you type, including one already published |
| Moves CHANGELOG **Unreleased** into the version | Yes | The tagged commit has to contain the notes already |
| `RECOMMENDED_VERSION` | Opt-in on Release create (default off). The CLI leaves the pin unchanged | Unchanged |
| Tests, frozen `/<tag>/`, desktop, VSIX | `release.yml` after the tag push | Only when the new tag matches `v*` and the commit is already prepared |

Write release notes in `CHANGELOG.md`. Use the GitHub Release screen to attach extra files.

### Recommended end-user version

`versions.json` field **`recommended`** drives the “not on recommended version” popup and the stable `/recommended/` alias (which redirects directly to the active recommended release). On assemble, precedence is: `RECOMMENDED_VERSION` env or repo-root [`RECOMMENDED_VERSION`](RECOMMENDED_VERSION) file → else keep the previous recommendation if still published → else newest tag. To promote a release (e.g. `v0.8.8`), commit `RECOMMENDED_VERSION` containing that tag and let the next Pages deploy (main and/or release assemble) run. Release create writes that file only when `update_recommended` is true; otherwise the pin stays as it is, including across the new release.

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
