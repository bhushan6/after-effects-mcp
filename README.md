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

After its first successful Connect the panel reconnects by itself: if the bridge service restarts (it reuses its last port), the panel retries with backoff (1 s doubling to 30 s) using the saved port, secret and edit setting, and re-evaluates `host.jsx` from disk on every reconnect. Reopening the panel or After Effects resumes the connection too. **Disconnect** stops retrying until the next manual Connect. A rejected secret or another panel taking over also stops retrying.

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

`ae_context`, `ae_inspect`, `ae_catalog`, `ae_apply`, `ae_render_frame`, `ae_render_contact_sheet`, `ae_render_video`, `ae_job`, and `ae_artifact`. Frame and contact-sheet tools return a PNG image content block and JSON metadata. They open the target comp in the viewer when another item is active (a token from an earlier inspect stays valid across that switch) and leave it open.

`ae_render_video` renders `[startFrame, endFrameExclusive)` (at most 7200 frames) through the same native frame path and encodes an H.264 MP4 (CRF 16, yuv420p, faststart) with FFmpeg at the comp frame rate. It returns a `jobId` at once; poll `ae_job` until `state` is `succeeded` (`result.path`, `result.artifactId`) or `failed`. While it runs, `result.progress` reports frames done, and other bridge calls wait in the lane. `outputPath` (absolute `.mp4`, overwritten) defaults to the artifacts directory; `maxLongEdge` downscales. From the CLI: `npm run cli -- video SESSION COMP START END [OUT.mp4]`, then `npm run cli -- job ID`. Frames are zero-based relative to comp time zero. Ranges are `[startFrame, endFrameExclusive)`.

`ae_apply` currently supports composition creation (`comp.create`, alone in its batch), layer trimming (`layer.set_timing`), editable text and rounded-rectangle shape layers, whole-layer text style (`text.set_style`: PostScript font, fill colour, font size, leading, tracking, justification, and `anchor: "center"` so Position places the text's visual centre), plus 2D anchor point, position, scale, opacity, and rotation values/keyframes, and temporal easing on those keyframes (`keyframe.ease`: `ease_in`, `ease_out`, `ease_in_out`, or `linear`, with optional influence). It rejects 3D, separated-dimension, and expression-driven transform targets.

Media, shapes and rigging:

- `layer.create_image` imports a PNG/JPEG/PSD/TIFF by absolute path (reusing footage already imported from that file) and adds it centred.
- `layer.replace_image` points an existing footage layer at an image file. If that file is already imported, its footage is reloaded from disk first, so re-exporting an asset to the same path and replacing with it updates AE without **Reload Footage**. Transforms are kept; the anchor point is not re-centred if the image size changes.
- `layer.create_shape` also draws ellipses (`shape: "ellipse"`) and can stroke (`strokeRgb`, `strokeWidthPx`) as well as or instead of fill.
- `layer.create_path` builds a shape layer from bezier paths (vertices plus optional in/out tangents, open or closed) with fill/stroke, line cap/join, and optional Trim Paths (`trim: "simultaneous" | "individual"`); animate the draw-on with `keyframe.set` on `["ADBE Root Vectors Group","ADBE Vector Filter - Trim","ADBE Vector Trim End"]` (or `Trim Start`).
- `layer.set_parent` parents or unparents a layer. Values are kept and reinterpreted in the parent's layer space (origin at the parent source's top-left), so set Position after parenting. Children inherit the parent's scale, which makes zooming a UI image with overlays attached straightforward.
- `layer.set_track_matte` uses another layer as an alpha/luma (optionally inverted) matte and hides the matte layer (AE 23+).
- `layer.set_switches` toggles motion blur and enables comp motion blur when turned on.
- `project.save` saves the project in place, or to an absolute `.aep` path when it has never been saved (Save As). It must be alone in its batch and refuses to overwrite a different existing file.
- `text.typewriter` types a text layer out between two frames through a `Typewriter` slider and a Source Text expression, so the text stays editable. With `caret` it adds a blinking caret layer that follows the typed text's right edge, shares the text's parent and timing, and becomes the operation's created ref. Style text before typing it out; styling refuses expression-driven text. One batch contains at most 24 operations. The host groups completed operations under one undo label; a failed operation may leave earlier operations applied.

Contact sheets support uniform or explicit frame sampling, at most 12 frames, and a labelled tile-to-source manifest. If some frames fail, the result is marked partial. Native frame availability is determined by a runtime capability probe on the connected AE build.
Use `ae_artifact` with a frame artifact ID and a `{x,y,width,height}` crop in original comp pixels to inspect text or other small details.

## Verification

```sh
npm test
node tests/live-loopback.mjs
```

The unit suite covers schema validation, time sampling, duplicate requests, stale-state rejection, disconnect uncertainty, actual PNG contact-sheet assembly and MP4 encoding with FFmpeg, opening the target comp before rendering, image replacement against mock footage, and MCP stdio framing. The separate loopback test connects a mock panel to the service and confirms an MCP tool response contains PNG image bytes. See [compatibility and remaining work](docs/compatibility.md).

## References

The CEP panel uses Adobe's documented `CSInterface.evalScript` bridge pattern (through its `window.__adobe_cep__` primitive), and the MCP transport uses newline-delimited JSON-RPC and image content blocks. See [Adobe CEP](https://github.com/Adobe-CEP/Getting-Started-guides), [After Effects scripting Layer.id](https://ae-scripting.docsforadobe.dev/layer/layer/), and [MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio).
