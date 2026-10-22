# Instructions for AI programming agents

## Documentation guidance

- Human-facing docs (`README.md`, `README_DEVELOPERS.md`, `docs/TUTORIAL.md`,
  and similar) are for people. Keep them concise and focused on what a human
  reader needs. Do not put agent-only instructions there — those belong in
  `AGENTS.md` or `docs/agents/`. Shared project conventions that humans and
  agents both need (e.g. `docs/TESTING.md`, `CONTEXT.md`) stay human-written;
  agents are pointed at them from `AGENTS.md`.
- Always prefer reading and analyzing original documentation of latest version
  of libraries and projects rather than random search hits or training data
  that may be of lower quality or based on outdated versions.
- It is good to offload some tasks to external MCP (Model Context Protocol)
  you may need to ask user to add certain MCP servers to your configuration
  (please do ask user if you can not do it yourself).
- Deepwiki.com is a great source for outsourcing analysis of any project on
  github. If possible, delegate your questions about the library to the Deepwiki
  MCP server. Successful connections to the Deepwiki server has been established
  using all the methods described above, so if connection fails stop and ask
  user for help, don't try to invent other ways to call MCP servers. If you are
  a local agent (e.g. Gemini CLI), you should have direct access to the Deepwiki
  MCP tools already (configured by user), if not install that or ask user for help.
  Do NOT proceed without deepwiki access.
- The DeepWiki MCP server offers three main tools:
  1. read_wiki_structure - Get a list of documentation topics for a GitHub
     repository
  2. read_wiki_contents - View documentation about a GitHub repository
  3. ask_question - Ask any question about a GitHub repository and get an
     AI-powered, context-grounded response

## Development process guidance

Use the **Matt Pocock engineering skills** shipped in this repo (`.cursor/skills/`,
`.agents/skills/`). Refresh with:

`npx skills@latest add mattpocock/skills --agent cursor --skill '*' --yes --copy`

Pick the skill that matches the task:

| Skill | Use when |
|-------|----------|
| `domain-modeling` | Editing CONTEXT.md, ADRs, or terminology |
| `implement` | Building a feature from a spec or issue |
| `tdd` | Test-first development |
| `diagnosing-bugs` | Reproducible bugs needing runtime evidence |
| `code-review` | Reviewing changes against standards and spec |
| `triage` | GitHub issue triage |
| `research` | Primary-source investigation → markdown file |
| `prototype` | Throwaway design validation |
| `grilling` | Stress-testing a plan or decision |

Project-specific: `intehrgrator-mapping` for desktop Agent API / MCP mapping work
(Function library: [`function-library/index.md`](function-library/index.md);
when a contribution issue is accepted, [`function-library/AGENTS.md`](function-library/AGENTS.md));
`convert-mappings` when translating an existing mapping (Go `text/template`, Handlebars, TypeScript, …) into intEHRgrator Blockly / `intehrgrator-suggestions`.

**Tests.** When adding, changing, or reviewing tests, read [docs/TESTING.md](docs/TESTING.md) first: pick the existing seam (unit, WorkbenchController, Playwright UI, or Agent/MCP), keep the UI green-path covering major authoring steps, and skip cloning an assertion onto a second layer unless that layer can miss a real bug.

**End-user UI.** The web UI must work on Windows in Microsoft Edge; prefer
compatibility with other common OS/browser combinations as well. Desktop builds
target Windows, Linux, and macOS (no Deno required on the user’s machine). See
[docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md).

**Changelog.** PRs that change user-visible behaviour add a concise line (with PR link) under **Unreleased** in [CHANGELOG.md](CHANGELOG.md); release PRs move it to the new version (see README_DEVELOPERS.md § Releases).

For specs and design documents, use `docs/prd/` and `docs/design/`.
Planning lives in **GitHub Issues** ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)).
Archived roadmaps and superseded drafts live in `docs/historical-archive/`.

## Development tooling guidance

- When working with Javascript or Typescript based projects prefer using Deno
  for management over using Node.js and NPM. Developers or agents like Jules 
  and other agents running in cloud environments might need to install Deno in
  its VM before using it.
- Local environments can be any OS, e.g. Windows, mac or linux, and with or 
  without admin privileges. Development should preferably be possible on any
  of these environments. Base any advice on that.

## File name conventions

No file names should include spaces.

For typescript source code, follow the standard snake_case convention (e.g. `my_file.ts`).

For typescript scripts, prefer kebab-case (e.g. `my-script.ts`) or snake_case.

For test fixtures, i.e. test data input and expected output, prefer kebab-case (e.g. `example-input.json`) for generated synthetic test data. For imported external artifacts where the original file name might be clearer, feel free to keep the original file name, but remove any spaces from the filename.

For user-facing documentation, prefer SCREAMING_SNAKE (e.g. `README.md`, `README_DEVELOPERS.md`). For repo-internal documentation under docs/adr and docs/agents, prefer kebab-case.

## Cursor Cloud specific instructions

- Intended stack (per the PRD/prompt): a local-first TypeScript static web app
  (GitHub Pages) using Blockly + CodeMirror, `ehrtslib` for openEHR
  TypeScript, and `fontoxpath` for source queries; a VS Code extension follows
  later. Per repo preference, this is a **Deno-based** project (not Node/npm).
- `deno` (latest stable, 2.9.0 at setup time) is installed in the VM and on
  `PATH` via `~/.deno/env` (sourced from `~/.bashrc`). Node.js and `pnpm` also
  happen to be present but are not the intended toolchain. Use `deno` for
  install/lint/test/run/build once code exists (e.g. `deno install`,
  `deno lint`, `deno test`, `deno task <name>`).
- Once implementation begins and a `deno.json`/`deno.jsonc` (or `package.json`)
  appears, the startup update script already runs `deno install` to fetch
  dependencies. Until then it is a no-op.
- Go 1.22+ is on PATH in this Cloud Agent image. It is only needed to rebuild
  the vendored Go `text/template` WASM (`deno task wasm:go-template` writes
  `web/wasm/go_texttemplate.wasm` and `wasm_exec.js`). The web app loads
  those files at runtime; ordinary lint/test/run does not need a Go toolchain.
  Rebuild only when `go/texttemplate` changes.
- Optional XQuery engine golden tests (`deno task test:xquery-engine`) need
  [BaseX](https://basex.org) on `PATH` (Java 21 is already present). See
  `docs/agents/xquery-engine.md` for install/bind hints (`parse-json` for JSON
  Example Instances; `BASEX_CMD` override).
- Playwright UI tests (`deno task test:ui`) need Chromium
  (`npx playwright@1.51.0 install chromium`). CI runs them on pull requests and
  releases; see [docs/TESTING.md](docs/TESTING.md).
- New chrome (tabs, dialogs, drawers) should use [Shoelace](https://shoelace.style/)
  where it fits; keep Karolinska `--sl-color-primary-*` tokens. See
  [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md).

## Agent skills

Matt Pocock engineering skills (`grill-with-docs`, `grilling`, `domain-modeling`,
`implement`, `tdd`, `triage`, …) ship in this repo so Cloud Agents see the same
set as a laptop Cursor install. Canonical copies live in `.cursor/skills/`
(Cursor discovery) and `.agents/skills/` (`npx skills` / skills.sh lockfile).
Refresh with:

`npx skills@latest add mattpocock/skills --agent cursor --skill '*' --yes --copy`

Use lowercase `--agent cursor`. Comma-separated `--skill` lists are not
supported; use `--skill '*'` or repeat `--skill <name>`.

A Cloud Agent VM can also hold a **global** copy under `~/.agents/skills` and
`~/.cursor/skills`. That copy dies with the pod and is **not** shared with other
GitHub repos. Other Cursor Cloud projects need the same repo files, or a saved
environment snapshot of a VM that already ran the global install.

### Issue tracker

GitHub Issues via `gh` (PRs are not a triage request surface). See
`docs/agents/issue-tracker.md`.

### Triage labels

Default role labels: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
