# intEHRgrator

Visual integration workbench for healthcare informaticians: map source data (JSON, XML, openEHR compositions) into target data instances (based on openEHR templates, JSON Schema, XML Schema) or to free-form text — then test and export conversion scripts.

**Audience:** medical informaticians, clinical super-users, and technically minded business developers mapping clinical data.

## Try it

| Option | URL |
|--------|-----|
| **Web app (recommended version)** | [regionstockholm.github.io/intehrgrator/recommended/](https://regionstockholm.github.io/intehrgrator/recommended/) |
| **Web app (latest / bleeding-edge)** | [regionstockholm.github.io/intehrgrator/](https://regionstockholm.github.io/intehrgrator/) |
| **Pinned web versions** | [versions.json](https://regionstockholm.github.io/intehrgrator/versions.json) lists stable URLs such as `…/v0.7/` |
| **Desktop app** | [GitHub Releases](https://github.com/regionstockholm/intehrgrator/releases) — Windows, Linux, macOS; no install of Deno required |

On Linux the desktop AppImage uses the system WebKitGTK 4.1 (with libsoup 3), also for `--headless`. If it stops with `libwebkit2gtk-4.1.so.0: cannot open shared object file`, install it: `sudo apt install libwebkit2gtk-4.1-0` (Debian/Ubuntu) or `sudo dnf install webkit2gtk4.1` (Fedora). Windows and macOS need nothing extra.

The recommended web app link redirects to the current stable pinned release from `versions.json`. The site root tracks the latest `main` (bleeding-edge) build and may change day to day. Use the recommended build, a pinned `/vX.Y/` URL, or a desktop release when you need a stable baseline for production mapping work.

## Get started

1. Open the [web app](https://regionstockholm.github.io/intehrgrator/recommended/) or download a [desktop build](https://github.com/regionstockholm/intehrgrator/releases).
2. Read the **[tutorials](docs/TUTORIAL.md)** — a short index of focused lectures (basic mapping, loops, AI, desktop MCP, and the rest).
3. Click the **ⓘ** tips in the interface for context-sensitive help on panes and controls.

## Saving your work

Your mappings are saved on **your computer** — in the browser for the web app, and the desktop app uses the same kind of local hidden storage. They are not uploaded to a server, and not saved as ordinary files that you can find in your file explorer.

- **Autosave:** After you edit, the app waits a short pause (about 10 seconds) and then saves automatically. The status bar at the **bottom** of the window shows when that happened (for example, “autosaved at 14:32”).
- **Save as:** Use this for a named snapshot you can reopen later via **Load Project**.
- **Survives restarts:** Both autosave and named saves remain after you close the browser or desktop app or restart the computer.
- **Can be cleared:** Erasing this site’s data in the browser (or similar “clear storage” actions) removes those saves.
- **Portable backup:** Use **Export Project** to download a `.intehrgrator` file you can keep, share, or **Import** on another computer or browser.

## Report issues and ideas

We welcome bug reports and feature requests:

- **[Open a GitHub issue](https://github.com/regionstockholm/intehrgrator/issues/new/choose)** — describe what happened, what you expected, and attach a `.intehrgrator` project export if you can.
- The in-app **Help** menu links here too.

## Learn more

| Topic | Document |
|-------|----------|
| What changed per release | [CHANGELOG.md](CHANGELOG.md) |
| Tutorial series | [docs/TUTORIAL.md](docs/TUTORIAL.md) |
| Terminology glossary | [CONTEXT.md](CONTEXT.md) |
| openEHR primer | [docs/OPENEHR_PRIMER.md](docs/OPENEHR_PRIMER.md) |
| Contributing / development | [README_DEVELOPERS.md](README_DEVELOPERS.md) |

## Libraries

Built on [ehrtslib](https://github.com/ErikSundvall/ehrtslib) (openEHR TypeScript), [Blockly](https://developers.google.com/blockly), [CodeMirror](https://codemirror.net/), and [fontoxpath](https://github.com/FontoXML/fontoxpath).
