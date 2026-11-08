# Better Form Renderer stays in the browser

The Better Form Renderer (`form-renderer.js`, `styles.css`, `styles-theme.css`) is proprietary. It is not committed and it is not part of any build, including a developer machine that happens to have the files locally. The user uploads the three files in the Better form viewer. The browser keeps them in a dedicated Cache API store (`intehrgrator-better-renderer`), the same approach Kintegrate used (`kintegrate-vendor-v1`). Deploys do not wipe that store, and the app never fetches those URLs from the network.

**Status:** accepted
**Date:** 2026-10-16

**Considered:** committing `vendor/better/`; copying a local checkout into `dist/` at build time (`deno task setup:better-forms`); probing the URL at startup to see if a build included it; storing the bytes in `localStorage`. Rejected: the license forbids publishing the files, a build-time copy still ships them to everyone who receives that build, a missing-file probe is a 404 in the console, and `localStorage` is the wrong size and type for a script plus stylesheets.

The viewer shell and the Push/Pull messages ship with the app. Full Better ScriptApi / form binding remains deferred. See [KINTEGRATE_MIGRATION.md](../KINTEGRATE_MIGRATION.md).
