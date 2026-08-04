# Live Architecture Preview Design

## Goal

Add an opt-in live browser preview for Blug so users can keep the architecture diagram visible while they work, without manually reopening `ARCHITECTURE.md` after each architectural change.

## User Interface

The feature is enabled from the watcher:

```bash
blug watch --preview
```

For the current npm scripts, the equivalent development command is:

```bash
npm run watch:daemon -- --preview
```

When enabled, Blug starts the normal watcher plus a local preview server and opens one browser tab at a localhost URL. The preview updates only when architecture drift is detected. Ignored file saves and no-op checks do not refresh the preview.

## Architecture

Create a small preview server in `src/preview-server.ts`.

Responsibilities:

- Serve a minimal HTML page.
- Serve the current Mermaid diagram from the in-memory model or generated `ARCHITECTURE.md`.
- Render Mermaid client-side in the browser.
- Keep the page connected with Server-Sent Events.
- Broadcast an update event when the watcher detects drift.

The watcher remains the owner of filesystem events. It calls `scanAndUpdate()` as it does today, alerts on drift, and then notifies the preview server only when at least one `DriftReport` exists.

## Data Flow

```text
file save
  -> watcher
  -> scanAndUpdate()
  -> model + ARCHITECTURE.md regenerated if drift exists
  -> alertDrift()
  -> previewServer.broadcastRefresh()
  -> browser fetches latest diagram
  -> Mermaid renders updated diagram
```

## Preview Server API

Use a local HTTP server bound to `127.0.0.1`.

- `GET /`
  - Returns the preview HTML.

- `GET /diagram`
  - Returns JSON:

```json
{
  "mermaid": "flowchart LR\n...",
  "updatedAt": "2026-08-04T00:00:00.000Z"
}
```

- `GET /events`
  - Server-Sent Events stream.
  - Sends `event: refresh` when a drift update occurs.

The browser page listens for refresh events, fetches `/diagram`, and re-renders.

## Browser Opening

The preview server should open the URL once when `--preview` starts.

Opening should use a small platform-aware helper:

- macOS: `open <url>`
- Windows: `cmd /c start "" <url>`
- Linux: `xdg-open <url>`

If opening fails, Blug should print the URL and continue running. Browser-opening failure must not stop the watcher.

## Mermaid Loading

Use Mermaid client-side in the preview page.

Initial implementation can load Mermaid from a CDN because the preview is an optional developer convenience. The HTML should clearly fail with a visible message if Mermaid cannot load.

Future offline support can bundle Mermaid locally, but that is out of scope for the first version.

## CLI Behavior

Update watcher argument parsing:

- `--preview`: starts preview server and opens the browser.
- no flag: current behavior remains unchanged.

Update CLI/help text to mention preview mode.

## Error Handling

- Preview server port conflict: try the next port in a small range, starting at `4327`.
- Browser open failure: print the URL and continue.
- Mermaid rendering failure in the browser: show an error message on the page.
- Server error while reading the model: return an empty diagram plus an error message; do not crash the watcher.
- Watcher drift handling errors: keep the current warning behavior and continue watching.

## Testing

Add focused unit/integration tests without launching a real browser:

- Preview server returns HTML from `/`.
- Preview server returns Mermaid JSON from `/diagram`.
- Preview server emits a refresh event when `broadcastRefresh()` is called.
- Watcher preview notification logic calls refresh only when drift reports exist.
- CLI argument parsing enables preview only for `--preview`.

Do not test OS browser opening through a real browser. Put browser opening behind a helper and test command selection or failure handling with dependency injection.

## Out of Scope

- Forcing a small side window size or desktop position.
- Electron or native app packaging.
- Rendering SVG/PDF/PNG through Puppeteer.
- Refreshing on every file save.
- Preview support for remote/shared tunnels.

## Acceptance Criteria

- `npm run watch:daemon -- --preview` starts the watcher, starts a local preview server, and opens a browser tab.
- The preview displays the current architecture diagram.
- Relevant architecture changes refresh the preview automatically.
- Ignored/no-op file saves do not refresh the preview.
- Watcher behavior without `--preview` is unchanged.
- Tests and typecheck pass.
