# CONVENTIONS.md — Code Style and Patterns

> Normative guide for all code in this project.
> Read before writing any new file.
> This is not a log — it always reflects the current standard.
> When a new pattern is established during implementation, update this file, not a task note.

---

## Universal Rules

These apply across every stack in this project.

- **No secrets in source.** All credentials and tokens come from environment variables only.
  See [`ENV_VARS.md`](ENV_VARS.md) for the canonical variable matrix.
- **No PII in logs.** Never log participant identifiers, names, or other direct identifiers.
- **No business logic in route handlers.** Route handlers call service functions; service
  functions call domain modules or data helpers.
- **No orphaned code.** Dead code is removed — not commented out, not wrapped in a flag.
- **No direct writes to Codex internal state files.** Treat `.codex-global-state.json` as
  read-only reference only — never write to it.
- **IPC channel names are constants.** All IPC channel name strings are defined in
  `src/shared/ipc-channels.ts`. Never hardcode channel name strings in main or renderer files.
- **HTTP sidecar binds 127.0.0.1 only.** Never bind to 0.0.0.0 or any non-loopback address.

---

## Stack 1 — Electron Main (TypeScript / Node.js)

### Language and Types

- TypeScript strict mode is enabled — no `any`; use `unknown` + type narrowing.
- All exported functions have explicit return types.
- Named exports only — no default exports outside of Electron entry points (`main.ts`).
- `console.log` is banned in production paths — use the project logger (`src/main/logger.ts`).

### Module and File Organization

- `src/main/` — one file per concern: `avatar-window.ts`, `state-store.ts`, `sidecar.ts`,
  `tray.ts`, `hooks-install.ts`.
- `src/cli/` — command implementations must be safe to run outside Electron and must not
  import Electron APIs. `buddy hatch` delegates `$imagegen` work to Codex CLI rather than
  calling an image provider API directly.
- `vite.cli.config.ts` owns the package CLI bundle. Keep `package.json` `bin.buddy`
  pointed at the emitted `out/cli/index.js`, and keep `npm run build:app` producing that
  file on both Windows PowerShell and WSL.
- `src/preload/preload.ts` — single preload file; exposes only `petApi` via
  `contextBridge.exposeInMainWorld`.
- State read/write is isolated to `state-store.ts` — no other file writes to `state.json`.
- HTTP sidecar is isolated to `sidecar.ts` — no other file creates an HTTP server.

### Naming Conventions

- Files: `kebab-case.ts`
- Exported functions: camelCase; exported classes: PascalCase
- IPC channel names: `kebab-case` strings, defined as constants in `src/shared/ipc-channels.ts`
  (e.g., `pet:state-change`, `drag-start`)
- Constants: `UPPER_SNAKE_CASE`

### Patterns

- **IPC:** main sends to renderer via `win.webContents.send(channel, payload)`. Renderer
  listens via `petApi.onXxx()`. All bridge calls go through `contextBridge` — never enable
  `nodeIntegration`.
- **Click-through toggling:** renderer calls `petApi.setPointerInteractive(bool)`, main
  handles `setIgnoreMouseEvents` accordingly.
- **State persistence:** always read state at startup via `state-store.ts`; always write
  state on `close`, `drag-end`, `display-change`, and `app-quit` events.

---

## Stack 2 — Svelte Renderer (Svelte / TypeScript / Vite)

### Language and Types

- TypeScript strict mode — same rules as the main process.
- Svelte component props are typed with `export let prop: Type`.
- No direct `window` or `document` access for Electron IPC — use `petApi` from
  `contextBridge` only.

### Module and File Organization

- One `.svelte` file per visual component.
- `src/renderer/main.ts` is the only renderer bootstrap file; it mounts `App.svelte`
  into `#app` and imports global styles.
- Shared types: `src/renderer/types.ts`.
- Animation logic: colocated in `PetSprite.svelte` — not extracted into a separate service.

### Naming Conventions

- Svelte components: `PascalCase.svelte`
- CSS classes: `kebab-case`
- Reactive state variables: camelCase

### Patterns

- **Sprite animation:** CSS `background-position` on a `<div>` with known grid dimensions
  (8 columns × 9 rows). Position formula: `col / (columns - 1) * 100%` for X,
  `row / (rows - 1) * 100%` for Y.
- **Animation loop:** `setInterval`-based with per-frame duration sourced from the `pet.json`
  state machine definition.
- **Pointer interactivity:** `pointermove` handler on the root element;
  `event.target.closest('[data-avatar-mascot]')` determines whether the cursor is over the
  interactive region.
- **Dragging:** `pointerdown` starts drag, `pointermove` sends `drag-move` via `petApi`,
  `pointerup` ends the drag and sends `drag-end`.

---

## Stack 3 — petdex-bridge (Rust)

### Language and Types

- Rust 2021 edition.
- `cargo fmt` and `cargo clippy -- -D warnings` must pass before any commit.
- Use `thiserror` for error types; avoid `unwrap()` in production paths — use `?`
  propagation throughout.
- No `unsafe` blocks.

### Module Structure

- Single binary crate in `petdex-bridge/`.
- `src/main.rs` — CLI arg parsing (clap), token reading, HTTP POST to sidecar.
- No library crate needed — keep it a single file unless the binary grows significantly.

### Naming Conventions

- `snake_case` for all Rust identifiers (standard Rust conventions).
- CLI subcommands: `state <name>`, `up`, `down`, `doctor`.

### Patterns

- **Token resolution:** read from `$HOME/.petdex-win/runtime/update-token`; accept
  `BUDDY_TOKEN` env var as an override.
- **HTTP client:** use `ureq` (sync, small binary footprint) — not `reqwest` (async, large).
- **Exit codes:** 0 on success, non-zero on connection failure. Electron not running is a
  common and expected case — do not panic, just exit with a non-zero code.

---

## Sprite / pet.json Format

The `pets/<id>/pet.json` file defines the sprite state machine consumed by both the renderer
and any tooling that manages pet state. The format is:

```json
{
  "id": "hirono-bear",
  "name": "Hirono Bear",
  "spritesheet": "spritesheet.webp",
  "frameWidth": 142,
  "frameHeight": 154,
  "columns": 8,
  "rows": 9,
  "states": {
    "idle":    { "frames": [{"row":0,"col":0,"ms":280},{"row":0,"col":1,"ms":110}] },
    "running": { "frames": [{"row":7,"col":0,"ms":120},{"row":7,"col":1,"ms":120}] },
    "waiting": { "frames": [{"row":6,"col":0,"ms":150},{"row":6,"col":1,"ms":150}] },
    "jumping": { "frames": [{"row":3,"col":0,"ms":100},{"row":3,"col":1,"ms":100}], "once": true, "fallback": "idle" },
    "waving":  { "frames": [{"row":4,"col":0,"ms":150},{"row":4,"col":1,"ms":150}], "once": true, "fallback": "idle" },
    "failed":  { "frames": [{"row":5,"col":0,"ms":200}] },
    "review":  { "frames": [{"row":8,"col":0,"ms":200},{"row":8,"col":1,"ms":200}] }
  }
}
```

- `once: true` — the animation plays exactly once, then transitions to the `fallback` state.
  States without `once` loop indefinitely.
- `fallback` — the state to enter when a `once` animation completes. Must be a valid state key.
- **CSS background-position formula:**
  - X: `col / (columns - 1) * 100%`
  - Y: `row / (rows - 1) * 100%`

---

## Testing

- Every new public function in `sidecar.ts` or `state-store.ts` requires a Vitest unit test
  before the task is marked done.
- Svelte unit tests must not launch Electron — mock `petApi` via `vi.mock`.
- State machine tests are pure input/output — no mocks needed.
- Any change to an IPC channel name must include an updated assertion in the E2E test for
  that channel.

Full testing guide: [`TESTING.md`](TESTING.md)

---

## Never

Hard rules. Agents follow these unconditionally.

- Never commit secrets or credentials to source control.
- Never bulk-rewrite `docs/workboard.json` — use targeted edits only.
- Never bypass or weaken the auth middleware on protected routes.
- Never use `any` in TypeScript new code.
- Never write to `%USERPROFILE%\.codex\.codex-global-state.json` — treat Codex state as
  read-only reference only.
- Never set `nodeIntegration: true` in `webPreferences` — all renderer↔main communication
  goes through `contextBridge`.
- Never bind the HTTP sidecar to anything other than `127.0.0.1`.
- Never store or commit the update token (`BUDDY_TOKEN` / `update-token` file contents) in
  source code.

## Always

- Always run the fast verification suite before marking a task done.
- Always update `docs/` files when public behavior, interfaces, or invariants change.
- Always use the project logger (`src/main/logger.ts`) — not `console.log` — in production
  paths.
- Always call `showInactive()` to display the pet window — never `show()`, which would steal
  focus from the user's foreground application.
- Always save window bounds on: `close`, `drag-end`, `display-change`, and `app-quit` events.
- Always validate the `X-Petdex-Update-Token` header before acting on any sidecar request.
