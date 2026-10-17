# Desktop and a local IDE

The downloaded app can let an IDE’s agent edit the open canvas. You start that server yourself, and you can stop it.

Back to the [tutorial index](../TUTORIAL.md). Calling a model from inside the app, without an IDE, is [AI in the web app](ai-in-the-web-app.md).

## Start or stop the local MCP server

1. Install and run a [desktop release](https://github.com/regionstockholm/intehrgrator/releases).
2. Open **AI → Desktop → Local MCP server…**. This item is not in the web app on GitHub Pages.
3. The panel shows **Running** or **Stopped**, the Agent API URL, a token if you started the app with one, and an `mcp.json` snippet.
4. **Stop** makes agent tools refuse new calls. **Start** allows them again. Call AI and your own edits keep working either way.
5. **Copy configuration** and paste it into the IDE’s MCP settings (for Cursor, `.cursor/mcp.json`).

The snippet uses this app as the MCP command (`intEHRgrator --mcp`) and sets `INTEHR_AGENT_URL` to the URL in the panel. Leave the workbench open. The IDE process only proxies; the canvas you are looking at is the one that changes.

A source checkout, instead of the release binary, gets a Deno command in that same panel:

```json
{
  "mcpServers": {
    "intehrgrator": {
      "command": "deno",
      "args": ["run", "-A", "src/agent/mcp_stdio.ts"],
      "env": { "INTEHR_AGENT_URL": "http://127.0.0.1:8765" }
    }
  }
}
```

Replace the URL with the one the panel shows. If the panel lists a token, the snippet includes `INTEHR_AGENT_TOKEN`.

The mapping skill, from a clone:

```bash
npx skills@latest add regionstockholm/intehrgrator --agent cursor --skill intehrgrator-mapping --yes --copy
```

## What the IDE can change

- Map **node by node** (`map_slot`), which is the transparent default while you watch the canvas, or apply a suggestion envelope (`import_suggestions`)
- Inspect slots, source trees, sheets, decision tables, and constraint warnings
- Run tests, export a project or a conversion script, undo and redo
- **Open observer** shows a live timeline of agent edits

Headless, with no window:

```text
intEHRgrator --headless --port 8765
intEHRgrator --headless --load project.intehrgrator
```

Binding anything other than loopback requires `--token` (or `INTEHR_AGENT_TOKEN`).

Full API reference: [AGENT_WORKFLOW.md](../AGENT_WORKFLOW.md).

## Other MCP connections

| MCP | Purpose |
|-----|---------|
| **intEHRgrator** (local) | Drive this workbench |
| **openEHR assistant** | Archetype and template lookup, terminology, spec guidance |
| **DeepWiki** | Questions about ehrtslib and openEHR libraries |

The web app does not expose this server. Use **Call AI** or copy-and-paste there, or install the desktop build.
