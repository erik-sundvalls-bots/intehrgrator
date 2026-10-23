# intEHRgrator — Tutorials

Short lectures for medical informaticians mapping source data to openEHR (or other targets). Terminology lives in [CONTEXT.md](../CONTEXT.md).

Start with the basic lecture, then open the one that matches what you are trying to do. Each page stands on its own.

| Lecture | What you learn |
|---------|----------------|
| [Basic mapping](tutorial/basic-mapping.md) | Open the workbench, load source and target, click-to-map a field that does not repeat, try an Example Set, save, get help |
| [Default context](tutorial/default-context.md) | Factory defaults, scaffold targets, and values that come from the runtime rather than the source |
| [Optional RM fields](tutorial/optional-rm.md) | Add Reference Model structure the template does not mention (feeder audit and similar) |
| [Loops](tutorial/loops.md) | Repeated source rows: `for each`, loop index, and loop length |
| [Sheets and decision tables](tutorial/sheets-and-decision-tables.md) | Grids pasted from a spreadsheet, and decision tables for combinational rules |
| [Functions](tutorial/functions.md) | Save, load, and share a Blockly Function |
| [Tests and export](tutorial/tests-and-export.md) | Conversion Test Run, then download a conversion script |
| [AI in the web app](tutorial/ai-in-the-web-app.md) | Copy a prompt and import the reply, or call an AI with your own credentials |
| [Desktop and a local IDE](tutorial/desktop-and-local-ai.md) | Downloaded app, start/stop the local MCP server, and connect Cursor or another IDE |

Formal verification of a mapping (in-app checks that support inspection) is not written yet. It waits on [issue 41](https://github.com/regionstockholm/intehrgrator/issues/41).

The toolbar **Help** menu opens this page. **ⓘ** next to a pane header explains the formats that pane accepts.
