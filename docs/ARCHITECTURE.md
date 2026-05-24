# Architecture

> Canonical source for system topology, runtime boundaries, and component responsibilities.
> Other docs should link here rather than restating architecture details.

---

## Overview

buddy is an npm-distributed developer tool that renders a floating, always-on-top, transparent pet character directly on the Windows desktop. It is built on a four-component architecture: a CLI entry point (`buddy`) that handles install-time setup and runtime commands, an Electron main process managing the window and HTTP sidecar, a Svelte renderer driving pet animation, and a Rust CLI binary (petdex-bridge) that runs in WSL and bridges shell hook events from WSL agents into the Windows-side Electron process. The system is entirely local — there are no cloud services, no accounts, and no network traffic leaving the machine.

buddy is installed via `npm install -g buddy` from either a Windows terminal or a WSL terminal. When installed in WSL the CLI uses the WSL interop layer to launch the Windows Electron process; when installed on Windows it launches directly.

---

## System Topology

All components run on a single developer workstation. There is no server, no cloud service, and no external network dependency.

- **buddy CLI** (`src/cli/`): npm `bin` entry point. Handles `start`, `stop`, `hooks install`, `state <name>`, `doctor`, and `hatch <prompt>` subcommands. Detects whether it is running in WSL or on Windows and adjusts behavior accordingly — in WSL it launches the Windows Electron app via WSL interop (`buddy.exe`). For asset generation, `buddy hatch` delegates visual generation to a Codex run that can use `$imagegen`, then packages the deterministic hatch-pet outputs for buddy.
- **Electron main process** (Windows, `src/main/`): Manages the transparent frameless BrowserWindow, runs the local HTTP sidecar on `127.0.0.1:7777`, persists state to disk, and owns the system tray.
- **Svelte renderer** (Windows, Electron webview, `src/renderer/`): Renders the pet character, drives the sprite animation state machine, and handles pointer interactivity and dragging.
- **petdex-bridge** (WSL, Rust CLI binary, `petdex-bridge/`): A tiny cross-compiled Linux binary distributed as the companion npm package `buddy-bridge`. Invoked by WSL shell hooks; reads the shared update token and POSTs agent lifecycle events to the Electron HTTP sidecar via WSL localhost passthrough.

---

## Component Responsibilities

### buddy CLI (`src/cli/`)

Detailed command behavior, terminal output rules, hatch progress expectations, pet
selection UX, and CLI lifecycle semantics live in [`CLI.md`](CLI.md).

**Owns:**
- The npm `bin` entry point — the `buddy` command developers run in their terminal.
- Environment detection: reads `/proc/version` to determine if running in WSL or natively on Windows.
- On Windows: `buddy start` spawns the Electron app process detached and returns control to the terminal; `buddy stop` terminates it.
- In WSL: `buddy start` invokes the Windows-side `buddy.exe` via WSL interop; prints a clear actionable error if interop is unavailable.
- `buddy hooks install`: writes shell hook entries for Claude Code CLI and Codex CLI (both operate via shell hooks / rc files — no desktop app config is written).
- `buddy state <name>`: sends an HTTP POST to the running sidecar (works from both Windows and WSL via localhost passthrough).
- `buddy doctor`: checks that the Electron process is running, the sidecar responds, the update token exists, and hooks are installed.
- `buddy hatch <prompt>`: prepares a hatch-pet run, verifies Codex CLI is installed and ready with `codex doctor`, then invokes `codex exec` as the image-generation worker so `$imagegen` is provided by Codex rather than by a buddy-owned image API adapter. The command packages the completed run into buddy's `pets/<id>/pet.json`, `spritesheet.webp`, and `build/icon.ico` formats.
- Pet-management commands enumerate and select valid buddy-managed pets and Codex-compatible pet asset folders. Selection is persisted in buddy-owned state only.
- CLI output is concise by default, styled when supported, plain in non-TTY contexts, and avoids dumping raw child-process output unless verbose/debug behavior is explicitly requested.
- Pet discovery module: `src/cli/pets.ts` — `discoverPets()` enumerates valid pets from `%USERPROFILE%\.petdex-win\pets` (buddy-managed) and `%USERPROFILE%\.codex\pets` (Codex-compatible, read-only). `validatePetFolder()` checks `pet.json` structure and spritesheet existence before admitting a candidate. `BUDDY_SPRITES_DIR` overrides the buddy-managed pets directory.
- Files: `src/cli/index.ts`, `src/cli/commands/`, `src/cli/pets.ts`.
- Build output: `npm run build:app` runs `electron-vite build` for Electron bundles and a Vite CLI build that emits `out/cli/index.js`, the package `bin.buddy` target.

**Does NOT:**
- Never manages window state directly — all window operations go through the Electron main process.
- Never starts a long-running server process itself — it starts the Electron app which owns the sidecar.
- Never owns image-provider credentials for hatch generation. If a user starts hatching from Claude Code or any other shell, buddy still delegates the visual generation phase to Codex CLI so `$imagegen` routing remains centralized.
- Never reads or writes Codex internal state while discovering Codex-compatible pet folders.

### Electron Main Process (`src/main/`)

**Owns:**
- BrowserWindow lifecycle: creates a transparent, frameless, always-on-top, non-focusable, skip-taskbar window (`frame:false, transparent:true, hasShadow:false, skipTaskbar:true, alwaysOnTop:true, focusable:false, thickFrame:false, roundedCorners:false, backgroundColor:"#00000000"`).
- After window creation: calls `setVisibleOnAllWorkspaces(true)`, `setAlwaysOnTop(true, "floating")`, and `showInactive()`.
- Click-through toggle via `setIgnoreMouseEvents(true, { forward: true })` — disabled when renderer signals pointer is over an interactive region.
- Local HTTP sidecar on `127.0.0.1:7777` (configurable via `BUDDY_PORT`): receives hook events, validates the `X-Petdex-Update-Token` header, and forwards events to the renderer via Electron IPC.
- State persistence: reads and writes `%USERPROFILE%\.petdex-win\state.json` (window open/hidden, bounds, pet id, current animation state). Restored bounds are clamped into the nearest display work area before the window is created so stale or off-screen coordinates cannot hide the pet.
- Window resize: receives resize interactions from the renderer, updates BrowserWindow bounds, preserves click-through behavior, and persists final bounds on resize end.
- Pet selection: owns active pet state and asset loading. The CLI may request or persist selection through buddy-owned surfaces, but Electron main remains responsible for loading assets into the renderer.
- System tray (Show / Hide / Quit) to keep the process alive when the window is hidden.
- Hook installation: `hooks-install.ts` exports `installHooks(options)` and `getHooksStatus(options)`. For Claude Code CLI it writes hook entries to `~/.claude/settings.json` (hooks section); for Codex CLI it appends shell environment-variable blocks to the target rc file. Both operations are idempotent. The module contains no top-level Electron import and is safe to call from the CLI layer (FEAT-09) without an Electron environment. The `installHooksWithDialog()` helper is intended for tray use only and dynamically requires Electron's `dialog` API at call time.
- Files: `main.ts`, `avatar-window.ts`, `state-store.ts`, `sidecar.ts`, `tray.ts`, `hooks-install.ts`.

**Does NOT:**
- Never bind the HTTP sidecar to `0.0.0.0` — loopback only.
- Never read or write Codex's internal state files.
- Never steal window focus — always use `showInactive()`.

### Shared IPC channels (`src/shared/ipc-channels.ts`) and Preload / contextBridge (`src/preload/preload.ts`)

**Owns:**
- `src/shared/ipc-channels.ts` owns all IPC channel name string constants (`CH_STATE_SET`, `CH_STATE_CHANGE`, `CH_PTR_INTERACTIVE`, `CH_DRAG_START`, `CH_DRAG_MOVE`, `CH_DRAG_END`, `CH_RENDERER_READY`, `CH_RESIZE_START`, `CH_RESIZE_MOVE`, `CH_RESIZE_END`). Main, preload, and tests import constants from this side-effect-free shared module; channel strings are never hardcoded elsewhere.
- `src/preload/preload.ts` owns the `petApi` object exposed to the renderer via `contextBridge.exposeInMainWorld('petApi', ...)`. This is the sole communication surface between the Svelte renderer and the Electron main process.

**petApi methods:**
- `setState(state)` — sends `CH_STATE_SET` to main to request a state transition.
- `onStateChange(cb)` — registers a listener for `CH_STATE_CHANGE` pushed by main.
- `setPointerInteractive(interactive)` — sends `CH_PTR_INTERACTIVE` to toggle click-through.
- `dragStart(offsetX, offsetY)` — sends `CH_DRAG_START` with pointer offset within window.
- `dragMove()` — sends `CH_DRAG_MOVE`; main repositions the window to track the cursor.
- `dragEnd()` — sends `CH_DRAG_END`; main clears drag state.
- `rendererReady()` — sends `CH_RENDERER_READY`; main shows the window via `showInactive()`.
- `resizeStart(initialWidth, initialHeight)` — sends `CH_RESIZE_START`; main records the window origin and starting dimensions.
- `resizeMove(screenX, screenY)` — sends `CH_RESIZE_MOVE`; main computes new width/height from cursor position relative to the window origin and calls `setBounds`.
- `resizeEnd()` — sends `CH_RESIZE_END`; main saves the final bounds to the state store.

**Does NOT:**
- Never expose Node.js APIs directly — `contextIsolation` is always `true`, `nodeIntegration` is always `false`.

---

### Svelte Renderer (`src/renderer/`)

**Owns:**
- Renders the pet character as a CSS `background-position` animation over a spritesheet (8 columns × 9 rows pixel-art grid).
- Drives the sprite animation state machine from a `pet.json` frame-sequence definition.
- Handles drag events and sends `drag-start` / `drag-move` / `drag-end` IPC messages to the main process.
- Detects pointer entry/exit on interactive regions (`[data-avatar-mascot]`, `.resize-handle`) and signals the main process to toggle click-through.
- Responds to `pet:state-change` IPC events to switch the active animation state.
- Provides a visual resize handle for the pet window and sends resize lifecycle events through preload IPC.
- Files: `index.html`, `main.ts`, `App.svelte`, `PetSprite.svelte`, `styles.css`.

**Does NOT:**
- Never perform any file I/O or HTTP calls — all external communication goes through IPC to the main process.
- Never load sprite assets from paths not provided by the main process.

### petdex-bridge (Rust CLI, `petdex-bridge/`)

**Owns:**
- A single-purpose CLI binary cross-compiled for `x86_64-unknown-linux-gnu` (runs in WSL).
- Reads the shared update token from `$HOME/.petdex-win/runtime/update-token`.
- Accepts a state name as a CLI argument (`petdex-bridge state running`) and POSTs `{"state":"<name>","source":"claude-code"}` to `http://127.0.0.1:${BUDDY_PORT}/state` with the `X-Petdex-Update-Token` header.
- Relies on WSL localhost passthrough to reach the Windows-side HTTP sidecar automatically.

**Does NOT:**
- Never reads or writes any Codex internal state files.
- Never opens a GUI or interacts with the Windows desktop directly — all output flows through the HTTP POST.

---

## Data Flow

### (a) WSL hook → petdex-bridge → HTTP sidecar → Electron IPC → Svelte renderer

1. An agent CLI event fires in WSL (e.g., Claude Code `PreToolUse` hook).
2. The shell hook (`.zshrc` / `.bashrc`) calls `petdex-bridge state running`.
3. petdex-bridge reads the token from `~/.petdex-win/runtime/update-token`.
4. petdex-bridge POSTs `{"state":"running","source":"claude-code"}` to `http://127.0.0.1:7777/state` with the `X-Petdex-Update-Token` header. WSL localhost passthrough routes this to the Windows host automatically.
5. The Electron HTTP sidecar validates the token and receives the payload.
6. The sidecar sends `pet:state-change { state: "running" }` to the renderer via Electron IPC.
7. The Svelte renderer switches the animation state machine to the "running" frame sequence.
8. The CSS `background-position` animation plays the running sprite frames at 120 ms/frame.

**Hook event → pet state mapping:**
| Hook event | Pet state |
|---|---|
| `UserPromptSubmit` | `jumping` |
| `PreToolUse` | `running` |
| `PostToolUse` | `idle` |
| `PermissionRequest` | `waiting` |
| `Stop` | `waving` |

### (b) Windows terminal hook (e.g., Codex CLI or Claude Code running natively on Windows)

1. A CLI tool (Codex CLI or Claude Code) fires a `PreToolUse` hook in a Windows terminal.
2. The hook calls `buddy state running` (the buddy CLI, which POSTs to the local sidecar).
3. buddy POSTs `{"state":"running","source":"codex-cli"}` to `http://127.0.0.1:7777/state`.
4. From step 5 onward, the path is identical to flow (a) above.

---

## Auth

buddy has no user-facing authentication. Access to the HTTP sidecar is secured by a shared-secret token:

- **Token location:** `%USERPROFILE%\.petdex-win\runtime\update-token` (Windows) and `$HOME/.petdex-win/runtime/update-token` (WSL symlink or copy).
- **Enforcement:** Every POST to `/state` must carry the `X-Petdex-Update-Token` header. The Electron sidecar rejects requests with a missing or incorrect token with HTTP 401.
- **Scope:** Loopback-only binding (`127.0.0.1`) means the token is a defense-in-depth measure against other local processes — there is no remote attack surface.
- **Rotation:** Delete and regenerate the token file; restart the Electron app to pick up the new value.

---

## External Dependencies

| Dependency | Purpose | Required / Optional |
|---|---|---|
| Electron | BrowserWindow, IPC, system tray, app packaging shell | Required |
| electron-builder | npm package publishing and production build tooling | Required (production build) |
| Svelte + Vite | Renderer framework and dev/build tooling | Required |
| commander (or yargs) | CLI entry point (`buddy` command) argument parsing | Required |
| Codex CLI | Executes `hatch-pet` visual generation jobs with `$imagegen` for `buddy hatch`; command can be overridden with `BUDDY_CODEX_COMMAND` | Required for asset generation only |
| Rust toolchain (`x86_64-unknown-linux-gnu` cross-compile target) | Build petdex-bridge for WSL | Required (for WSL hook support) |

There are no buddy-owned cloud services, managed databases, auth providers, or image API integrations. Codex CLI may use its own configured model/image-generation backend when `buddy hatch` delegates `$imagegen` work to it, but buddy does not read or store those credentials.

---

## Deployment Targets

| Environment | Electron app | petdex-bridge | State file |
|---|---|---|---|
| Local dev | `npm run dev` — Electron + Vite dev server on localhost | `cargo build --release --target x86_64-unknown-linux-gnu`, binary copied to WSL `$PATH` | `%USERPROFILE%\.petdex-win\state.json` (created on first run) |
| Production | `npm install -g buddy` — electron-builder packages the app; the npm package ships the Electron binary and exposes the `buddy` CLI via the `bin` field | `npm install -g buddy-bridge` inside WSL — ships the pre-built `x86_64-unknown-linux-gnu` binary | Same path — persisted across updates |
| WSL-only install | `npm install -g buddy` in WSL — CLI detects WSL, installs shell hooks, and invokes the Windows-side `buddy.exe` via WSL interop to launch the GUI | Same as above | Same path |

See [`ENV_VARS.md`](ENV_VARS.md) for the canonical variable and secret matrix per environment.

---

## Constraints

- **Windows-only.** The Electron app and renderer target `win32` exclusively. No macOS, no Linux native GUI.
- **HTTP sidecar must bind `127.0.0.1` only.** Never change `BUDDY_HOST` to `0.0.0.0` or any non-loopback address.
- **Never read or write any AI assistant CLI's internal config or state files.** buddy must never touch `.codex/`, `.claude/`, or equivalent internal directories of any CLI tool it integrates with.
- **Window must be non-focusable by default.** Always use `showInactive()` to display the window; never call `focus()` or `show()` in a way that steals focus from the user's active application.
- **Bounds must be saved on close, drag-end, and display-change events.** State must not be lost on crash — write `state.json` defensively at each of these points, not only on graceful exit.
- **DPI awareness is required.** The window bounds calculation must account for Windows display scaling. Test at 100%, 125%, and mixed-DPI multi-monitor configurations.
- **WSL agents cannot launch Windows GUI processes directly.** The supported path is WSL interop: invoking `buddy.exe` from a WSL shell hands execution off to the Windows host. Do not attempt `electron .` or direct GUI invocations from within a WSL shell.
- **WSL interop is optional infrastructure, not a hard requirement.** The CLI must detect when `/proc/version` does not contain `Microsoft` or when `cmd.exe` is not reachable, and print a clear fallback message rather than crashing.
- **petdex-bridge must be cross-compiled for `x86_64-unknown-linux-gnu`.** Do not use the host Rust target for this binary — it must run inside WSL, not on the Windows host.
- **electron-builder is the packaging tool.** Configuration lives in `electron-builder.yml`. Do not swap to another packager without updating `electron-builder.yml`, `package.json` scripts, and this doc.
