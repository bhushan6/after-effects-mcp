# After Effects Agent Bridge

A working local vertical slice of [the implementation plan](PLAN.md): one authenticated loopback service, a CEP/ExtendScript panel, a stdio MCP interface, a CLI, durable edit jobs, typed text/shape/transform operations, and native frame/contact-sheet delivery when the AE host supports it.

**Status:** the service and mock-panel tests pass. This machine has no After Effects installation, so the actual CEP/ExtendScript behavior and native frame API remain **uncertified**. The panel reports `liveFrame: false` and rendering returns `UNSUPPORTED_CAPABILITY` if the host method is absent; it never substitutes a screenshot.

## Requirements

- macOS with After Effects 22 or newer for the CEP adapter. Layer IDs appeared in AE 22; this is a minimum API requirement, not a certified version claim.
- Node.js 24 or newer.
- FFmpeg on `PATH` for contact sheets and viewing derivatives.
- A CEP development setup that can load an unsigned panel, or a signed distribution package. The installer does not change Adobe's global debug settings.

## Run

```sh
npm run cli -- install-panel
npm run cli -- doctor
npm run cli -- panel-config
```

Open the **Agent Bridge** panel from After Effects' **Window → Extensions** menu (shown as **Extensions (Legacy)** on some builds). Enter the port and pairing secret printed by `panel-config`. Check **Allow edits in the current project** before connecting when you want the agent to edit. The project scope is read only by default. Keep the panel open.

The MCP server starts or discovers the shared bridge service automatically:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/after-effect-agent/apps/mcp/main.js"]
}
```

The MCP process and CLI must run as the same OS user. Set `AE_BRIDGE_HOME` to the same absolute directory for both if you override the default `~/.after-effects-agent-bridge`. The runtime directory contains a mode-0600 pairing secret, SQLite journal, and image artifacts. Do not add it to version control.

For manual CLI inspection:

```sh
npm run cli -- context
npm run cli -- inspect
npm run cli -- catalog
```

To apply a batch, first copy the current `projectSessionId`, `activeComp.ref`, and `inspectionToken` from `context` or `inspect`. Create `batch.json`:

```json
{
  "requestId": "create-title-001",
  "projectSessionId": "session_FROM_INSPECT",
  "expectedInspectionToken": "inspection_FROM_INSPECT",
  "label": "Create title",
  "operations": [
    { "id": "title", "op": "layer.create_text", "compRef": "comp_FROM_INSPECT", "text": "Hello", "name": "Title" },
    { "id": "place", "op": "property.set", "target": { "createdBy": "title" }, "path": ["ADBE Transform Group", "ADBE Position"], "value": [960, 540], "coordinateSpace": "parent" }
  ]
}
```

```sh
npm run cli -- apply batch.json
```

Use a new `requestId` for each new edit. Repeating the same ID returns the original journalled outcome and does not dispatch another mutation. A disconnect during an edit yields `outcome_unknown`; inspect AE before doing anything else.

## Current MCP tools

`ae_context`, `ae_inspect`, `ae_catalog`, `ae_apply`, `ae_render_frame`, `ae_render_contact_sheet`, `ae_job`, and `ae_artifact`. Rendering tools return a PNG image content block and JSON metadata. Frames are zero-based relative to comp time zero. Ranges are `[startFrame, endFrameExclusive)`.

`ae_apply` currently supports editable text and rounded-rectangle shape layers, plus 2D position, scale, opacity, and rotation values/keyframes. It rejects parented, 3D, separated-dimension, and expression-driven transform targets. One batch contains at most 24 operations. The host groups completed operations under one undo label; a failed operation may leave earlier operations applied.

Contact sheets support uniform or explicit frame sampling, at most 12 frames, and a labelled tile-to-source manifest. If some frames fail, the result is marked partial. Native frame availability is determined by a runtime capability probe on the connected AE build.
Use `ae_artifact` with a frame artifact ID and a `{x,y,width,height}` crop in original comp pixels to inspect text or other small details.

## Verification

```sh
npm test
node tests/live-loopback.mjs
```

The unit suite covers schema validation, time sampling, duplicate requests, stale-state rejection, disconnect uncertainty, actual PNG contact-sheet assembly with FFmpeg, and MCP stdio framing. The separate loopback test connects a mock panel to the service and confirms an MCP tool response contains PNG image bytes. See [compatibility and remaining work](docs/compatibility.md).

## References

The CEP panel uses Adobe's documented `CSInterface.evalScript` bridge pattern (through its `window.__adobe_cep__` primitive), and the MCP transport uses newline-delimited JSON-RPC and image content blocks. See [Adobe CEP](https://github.com/Adobe-CEP/Getting-Started-guides), [After Effects scripting Layer.id](https://ae-scripting.docsforadobe.dev/layer/layer/), and [MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio).
