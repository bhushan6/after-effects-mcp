# Compatibility and phase status

## Verified in this workspace

- Node.js 24.19.0 service startup and SQLite journal.
- Loopback HTTP authentication, WebSocket panel handshake, single command lane, and edit request dispatch with a simulated panel.
- MCP 2025-11-25 stdio initialization/tool listing and PNG image result construction.
- FFmpeg contact-sheet assembly on macOS from actual PNG files, with frame-to-tile mapping.
- State-conflict, duplicate-request, and disconnect outcome tests.

## Requires a real After Effects host

- Loading the unsigned CEP panel and `host.jsx` on the target AE/CEP build.
- Verifying `CompItem.saveFrameToPng` in the ExtendScript engine, its exact signature, synchronicity, output appearance, and state restoration.
- Editing an actual text and shape layer, including matchName paths and shape property behavior.
- Testing native IDs, non-English names, fractional frame durations, expression errors, and project switches.
- Checking native image delivery in intended MCP clients, not just the protocol payload.
- Measuring latency, undo behavior, and visual quality on fixed project fixtures.

Adobe's [UXP CompItem reference](https://developer.adobe.com/after-effects/uxp/after-effects-api/compitem) documents a deferred PNG method in a future UXP host API. That is **not** proof that the CEP/ExtendScript method in this adapter is available or synchronous. The adapter probes for it and reports unsupported if absent.

## Scope remaining from PLAN.md

This is the first vertical slice, not the full alpha. Composition creation, asset import, richer inspection, effects, easing, recipes, automated revert/checkpoints, short video/export, Windows certification, packaging/signing, and a built-in chat client remain open. The core is plain JavaScript rather than the planned TypeScript because package registry access was unavailable during this build; it uses only Node built-ins and FFmpeg. A typed migration and dependency pinning remain on the roadmap.

Before claiming Phase 0 complete, run the exact eight-step vertical slice in a real AE installation and benchmark existing bridge candidates on the same fixture. The current development machine has no After Effects installation, so no AE compatibility claim is made.
