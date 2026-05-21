# Architecture

> Canonical source for system topology, runtime boundaries, and component responsibilities.
> Other docs should link here rather than restating architecture details.

---

## Overview

buddy is a standalone Windows desktop application that renders a floating, always-on-top, transparent pet character directly on the Windows desktop. It is built on a three-component architecture: an Electron main process managing the window and HTTP sidecar, a Svelte renderer driving pet animation, and a Rust CLI binary (petdex-bridge) that runs in WSL and bridges shell hook events from WSL agents into the Windows-side Electron process. The system is entirely local — there are no cloud services, no accounts, and no network traffic leaving the machine.

---

## System Topology

All components run on a single developer workstation. There is no server, no cloud service, and no external network dependency.

- **Electron main process** (Windows, `src/main/`): Manages the transparent frameless BrowserWindow, runs the local HTTP sidecar on `127.0.0.1:7777`, persists state to disk, and owns the system tray.
- **Svelte renderer** (Windows, Electron webview, `src/renderer/`): Renders the pet character, drives the sprite animation state machine, and handles pointer interactivity and dragging.
- **petdex-bridge** (WSL, Rust CLI binary, `petdex-bridge/`): A tiny cross-compiled Linux binary invoked by WSL shell hooks. It reads the shared update token and POSTs agent lifecycle events to the Electron HTTP sidecar via WSL localhost passthrough.

---

## Component Responsibilities

### Electron Main Process (`src/main/`)

**Owns:**
- BrowserWindow lifecycle: creates a transparent, frameless, always-on-top, non-focusable, skip-taskbar window (`frame:false, transparent:true, hasShadow:false, skipTaskbar:true, alwaysOnTop:true, focusable:false, thickFrame:false, roundedCorners:false, backgroundColor:"#00000000"`).
- After window creation: calls `setVisibleOnAllWorkspaces(true)`, `setAlwaysOnTop(true, "floating")`, and `showInactive()`.
- Click-through toggle via `setIgnoreMouseEvents(true, { forward: true })` — disabled when renderer signals pointer is over an interactive region.
- Local HTTP sidecar on `127.0.0.1:7777` (configurable via `BUDDY_PORT`): receives hook events, validates the `X-Petdex-Update-Token` header, and forwards events to the renderer via Electron IPC.
- State persistence: reads and writes `%USERPROFILE%\.petdex-win\state.json` (window open/hidden, bounds, pet id, current animation state).
- System tray (Show / Hide / Quit) to keep the process alive when the window is hidden.
- Files: `main.ts`, `avatar-window.ts`, `state-store.ts`, `sidecar.ts`, `tray.ts`, `hooks-install.ts`.

**Does NOT:**
- Never bind the HTTP sidecar to `0.0.0.0` — loopback only.
- Never read or write Codex's internal state files.
- Never steal window focus — always use `showInactive()`.

### Svelte Renderer (`src/renderer/`)

**Owns:**
- Renders the pet character as a CSS `background-position` animation over a spritesheet (8 columns × 9 rows pixel-art grid).
- Drives the sprite animation state machine from a `pet.json` frame-sequence definition.
- Handles drag events and sends `drag-start` / `drag-move` / `drag-end` IPC messages to the main process.
- Detects pointer entry/exit on interactive regions (`[data-avatar-mascot]`, `.resize-handle`) and signals the main process to toggle click-through.
- Responds to `pet:state-change` IPC events to switch the active animation state.
- Files: `index.html`, `App.svelte`, `PetSprite.svelte`, `styles.css`.

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

### (b) Windows-only hook (e.g., Codex `hooks.json`)

1. Codex fires a `PreToolUse` hook on Windows.
2. The hook calls `petdex-win state running` (Windows CLI or PowerShell invocation).
3. petdex-win POSTs directly to the Electron HTTP sidecar on `127.0.0.1:7777`.
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
| electron-builder | Windows installer (.exe / NSIS) packaging | Required (production build) |
| Svelte + Vite | Renderer framework and dev/build tooling | Required |
| Rust toolchain (`x86_64-unknown-linux-gnu` cross-compile target) | Build petdex-bridge for WSL | Required (for WSL hook support) |

There are no cloud services, no managed databases, no auth providers, and no external APIs.

---

## Deployment Targets

| Environment | Electron app | petdex-bridge | State file |
|---|---|---|---|
| Local dev | `npm run dev` — Electron + Vite dev server on localhost | `cargo build --release --target x86_64-unknown-linux-gnu`, binary copied to WSL `$PATH` | `%USERPROFILE%\.petdex-win\state.json` (created on first run) |
| Production (packaged) | `electron-builder` output — Windows `.exe` / NSIS installer, installed to `%LOCALAPPDATA%\buddy` | Pre-built Linux binary distributed alongside installer, placed in WSL home by install script | Same path — persisted across updates |

See [`ENV_VARS.md`](ENV_VARS.md) for the canonical variable and secret matrix per environment.

---

## Constraints

- **Windows-only.** The Electron app and renderer target `win32` exclusively. No macOS, no Linux native GUI.
- **HTTP sidecar must bind `127.0.0.1` only.** Never change `BUDDY_HOST` to `0.0.0.0` or any non-loopback address.
- **Never read or write Codex internal state files.** buddy may read pet assets from `%USERPROFILE%\.codex\pets` (read-only), but must never touch Codex's own session or config files.
- **Window must be non-focusable by default.** Always use `showInactive()` to display the window; never call `focus()` or `show()` in a way that steals focus from the user's active application.
- **Bounds must be saved on close, drag-end, and display-change events.** State must not be lost on crash — write `state.json` defensively at each of these points, not only on graceful exit.
- **DPI awareness is required.** The window bounds calculation must account for Windows display scaling. Test at 100%, 125%, and mixed-DPI multi-monitor configurations.
- **WSL agents cannot launch Windows GUI processes.** All UI integration testing must be performed natively on Windows. Do not attempt `electron .` or GUI invocations from within a WSL shell.
- **petdex-bridge must be cross-compiled for `x86_64-unknown-linux-gnu`.** Do not use the host Rust target for this binary — it must run inside WSL, not on the Windows host.
