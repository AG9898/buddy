<div align="center">

```
    ____            __    __
   / __ )__  ______/ /___/ /_  __
  / __  / / / / __  / __  / / / /
 / /_/ / /_/ / /_/ / /_/ / /_/ /
/_____/\__,_/\__,_/\__,_/\__, /
                        /____/
```

**A floating desktop pet for Windows that reacts to your AI coding assistant in real time.**

[![npm version](https://img.shields.io/npm/v/cli-buddy?color=f97316&labelColor=1a1a1a)](https://www.npmjs.com/package/cli-buddy)
[![license](https://img.shields.io/npm/l/cli-buddy?color=f97316&labelColor=1a1a1a)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-f97316?labelColor=1a1a1a)](https://www.npmjs.com/package/cli-buddy)
[![node](https://img.shields.io/node/v/cli-buddy?color=f97316&labelColor=1a1a1a)](https://nodejs.org)

</div>

---

buddy renders a transparent, always-on-top pixel-art character directly on your Windows desktop. It listens to hook events from **Claude Code** and **Codex CLI** and animates the pet as your agent works — running when tools fire, jumping when you send a prompt, waiting for permissions, and waving when the session ends.

No login. No cloud. No installer GUI. Just `npm install -g cli-buddy` and the `buddy` CLI.
The npm package includes the built app and installs the Electron runtime dependency that
`buddy start` uses, so a global install does not need a source checkout.

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Pet States](#pet-states)
- [Pet Management](#pet-management)
- [Hook Integration](#hook-integration)
- [Configuration](#configuration)
- [Development](#development)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)

---

## Requirements

| Requirement | Notes |
|---|---|
| **Windows 10 or 11** | The Electron overlay is Windows-only |
| **Node.js 18+** | Required for `npm install -g cli-buddy` |
| **Claude Code** or **Codex CLI** | At least one required for hook integration |
| **WSL** _(optional)_ | Only needed for WSL-side hook events via `petdex-bridge` |
| **Codex CLI** _(optional)_ | Only needed for `buddy hatch` pet generation |

---

## Installation

### Windows (PowerShell / Command Prompt)

```sh
npm install -g cli-buddy
buddy start
```

The pet window appears on your desktop. `buddy start` launches the app detached and returns your prompt immediately.

### WSL

```sh
npm install -g cli-buddy
buddy start          # uses WSL interop to launch the Windows Electron app
buddy hooks install  # wires Claude Code and Codex CLI hooks for WSL
```

WSL interop must be enabled. If `buddy.exe` is not reachable, buddy prints a clear actionable error.

### WSL bridge

Install or build `petdex-bridge` inside WSL to route WSL shell hook events to the Windows pet:

```sh
cd petdex-bridge
cargo build --release --target x86_64-unknown-linux-gnu
target/x86_64-unknown-linux-gnu/release/petdex-bridge state running
```

The bridge reads `BUDDY_PORT` (default `7777`) and sends authenticated JSON to
`http://127.0.0.1:${BUDDY_PORT}/state`. It reads the update token from
`$HOME/.petdex-win/runtime/update-token`; set `BUDDY_TOKEN` only as a temporary override.
After starting buddy on Windows once, make WSL share that Windows-owned data directory:

```sh
ln -s /mnt/c/Users/<you>/.petdex-win ~/.petdex-win
```

If a symlink is not practical, copy the Windows `runtime/update-token` file into
`$HOME/.petdex-win/runtime/update-token`, or set
`BUDDY_DATA_DIR=/mnt/c/Users/<you>/.petdex-win` for WSL commands.

---

## Quick Start

```sh
# 1 — install
npm install -g cli-buddy

# 2 — launch the pet window
buddy start

# 3 — wire up Claude Code + Codex CLI hooks
buddy hooks install

# 4 — confirm everything is connected
buddy doctor
```

Within seconds of your next `claude` or `codex` command the pet will start reacting.

---

## CLI Reference

```
buddy <command> [options]
```

| Command | Description |
|---|---|
| `buddy start` | Launch the Electron pet window, return control to the terminal. |
| `buddy stop` | Quit the running pet app. |
| `buddy state <name>` | Manually push a state (`idle`, `running`, `waiting`, …). |
| `buddy hooks install` | Write Claude Code + Codex CLI hook entries. |
| `buddy doctor` | Health check: process, sidecar, token, and hook status. |
| `buddy hatch <prompt>` | Generate a new pet via Codex CLI image generation. |
| `buddy pets list` | List all valid buddy-managed and Codex-compatible pets. |
| `buddy pets show` | Print the currently active pet and its path. |
| `buddy pets use <id>` | Select and persist an active pet by ID. |

### Options

| Flag | Command | Description |
|---|---|---|
| `--output <dir>` | `hatch` | Custom output directory for the generated pet. |
| `--verbose` | `hatch` | Show raw Codex subprocess output. |
| `--rc <path>` | `hooks install` | Deprecated compatibility flag; ignored. |

---

## Pet States

The pet animates in response to your AI assistant's lifecycle events:

```
UserPromptSubmit  →  jumping
PreToolUse        →  running
PostToolUse       →  idle
PermissionRequest →  waiting
Stop              →  waving
```

Trigger a state manually at any time:

```sh
buddy state running
buddy state idle
```

---

## Pet Management

buddy discovers pets from three locations:

| Source | Path | Notes |
|---|---|---|
| buddy-managed | `%USERPROFILE%\.petdex-win\pets` on Windows, `$HOME/.petdex-win/pets` in WSL | Created by `buddy hatch`. Override with `BUDDY_SPRITES_DIR`; use a WSL symlink/copy or `BUDDY_DATA_DIR` so WSL sees the Windows-owned directory. |
| packaged | `<cli-buddy package>\pets` | Built-in read-only pets shipped with buddy: `default` and `penguin`. |
| Codex-compatible | `%USERPROFILE%\.codex\pets` | Read-only asset folders — buddy never writes Codex state. |

A valid pet folder contains a `pet.json` state machine and a `spritesheet.webp` (8 × 9 grid).

### Included pets

The npm package ships with two ready-to-use pets:

- `default` — the original bundled companion.
- `penguin` — an animated penguin with idle, running, waiting, jumping, waving, failed, and review states.

Select either at any time:

```sh
buddy pets use penguin
```

### Generating a pet

`buddy hatch` delegates image generation to Codex CLI — buddy never holds image-provider credentials:

```sh
buddy hatch "a small orange cat"
buddy hatch "a small orange cat" --output pets/my-cat
buddy hatch "a small orange cat" --verbose
```

Codex CLI must be installed and signed in (`codex login`) before hatching. Use `BUDDY_CODEX_COMMAND` if Codex lives at a non-standard path.

### Browsing and selecting pets

```sh
buddy pets list          # enumerate valid pets from all sources
buddy pets show          # print the active selection
buddy pets use orange-cat
```

---

## Hook Integration

`buddy hooks install` writes hook entries for Claude Code and Codex CLI in the current
host environment:

- Claude Code: `~/.claude/settings.json`
- Codex CLI: `~/.codex/hooks.json`
- Windows hooks call `buddy state <name>`
- WSL hooks call `petdex-bridge state <name>`

After installing Codex hooks, open `/hooks` in Codex CLI if prompted and trust the new
buddy command hooks. The event pipeline from there:

```
[ Claude Code / Codex CLI hook fires ]
          │
          ▼  (Windows)                       (WSL)
  buddy state <name>              petdex-bridge state <name>
          │                                  │
          └──────────────┬───────────────────┘
                         ▼
              POST 127.0.0.1:7777/state
                         │
                         ▼
              Electron HTTP sidecar
              (validates X-Petdex-Update-Token)
                         │
                         ▼
              Electron IPC → Svelte renderer
                         │
                         ▼
                pet animates ✓
```

All traffic is loopback-only. No event data leaves your machine.

---

## Configuration

All variables are optional — buddy runs with safe built-in defaults, no `.env` required.

| Variable | Default | Description |
|---|---|---|
| `BUDDY_PORT` | `7777` | Port for the local HTTP hook sidecar. |
| `BUDDY_DATA_DIR` | `%USERPROFILE%\.petdex-win` | Override the buddy-owned data root for state, token, and buddy-managed pets. In WSL, prefer symlinking `$HOME/.petdex-win` to the Windows directory. |
| `BUDDY_TOKEN` | _(unset)_ | Temporary token override for `petdex-bridge`; normally read from `$HOME/.petdex-win/runtime/update-token`. |
| `BUDDY_SPRITES_DIR` | `<BUDDY_DATA_DIR>\pets` | Override only the buddy-managed pets directory. |
| `BUDDY_LOG_LEVEL` | `info` | Main process log level: `debug` `info` `warn` `error`. |
| `BUDDY_CODEX_COMMAND` | `codex` | Codex CLI command used by `buddy hatch`. |
| `BUDDY_VERBOSE` | _(unset)_ | Set to `1` to enable verbose output in `buddy hatch`. |

To override during development, create a `.env` at the project root:

```sh
BUDDY_PORT=7778
BUDDY_LOG_LEVEL=debug
```

---

## Development

```sh
git clone <repo-url>
cd buddy
npm install

npm run dev          # Electron + Vite dev server with hot reload
npm test             # Vitest unit tests
npm run lint         # ESLint + svelte-check + tsc --noEmit
npm run build:app    # build Electron bundles and out/cli/index.js
npm pack --dry-run   # inspect the npm release tarball
npm run build:win:local  # local smoke build, skips code signing
```

### Package contents

The public npm package is named `cli-buddy`, but it installs the `buddy` command.
`npm pack` runs `npm run build:app` through `prepack` and publishes only the built
runtime output, bundled pets, icon/build metadata, README/LICENSE/CHANGELOG, and selected
release docs. Agent skill folders, source-only planning files, tests, local caches,
and workboard files are excluded by the package allowlist and `.npmignore` guardrail.
Electron is installed as an optional production dependency of the package, which gives
`buddy start` a runtime executable after `npm install -g cli-buddy` without shipping
source-only dev dependencies.

### WSL bridge (optional)

Requires Rust with the `x86_64-unknown-linux-gnu` cross-compile target inside WSL:

```sh
cd petdex-bridge
cargo build --release --target x86_64-unknown-linux-gnu
```

### Project layout

```
src/
  cli/            npm bin entry and subcommands
  main/           Electron main: window, sidecar, tray, state persistence
  preload/        contextBridge — petApi exposed to the Svelte renderer
  renderer/       Svelte pet renderer and sprite animation state machine
  shared/         IPC channel constants (imported by main / preload / tests)
petdex-bridge/    Rust WSL bridge for shell hook events
pets/default/     Bundled default pet (pet.json + spritesheet.webp)
pets/penguin/     Bundled penguin pet (pet.json + spritesheet.webp)
docs/             Architecture, CLI contract, env vars, decisions, workboard
```

---

## Architecture

buddy is four components talking locally — no network, no accounts, no cloud:

```
┌─────────────────────────────────────────────────────┐
│                  Windows desktop                     │
│                                                      │
│  ┌─────────────┐    IPC     ┌──────────────────┐    │
│  │  buddy CLI  │◄──────────►│  Electron main   │    │
│  │  (node bin) │            │  BrowserWindow   │    │
│  └─────────────┘            │  HTTP sidecar    │    │
│                             │  System tray     │    │
│                             └────────┬─────────┘    │
│                                      │ IPC           │
│                             ┌────────▼─────────┐    │
│                             │  Svelte renderer │    │
│                             │  sprite animate  │    │
│                             └──────────────────┘    │
└──────────────────────────────────▲──────────────────┘
                                   │ HTTP POST
                            ┌──────┴──────┐
                            │   WSL env   │
                            │ petdex-     │
                            │ bridge      │
                            │ (Rust CLI)  │
                            └─────────────┘
```

| Component | Responsibility |
|---|---|
| **buddy CLI** | Detects Windows vs WSL, launches/stops the app, installs hooks, sends state. |
| **Electron main** | Transparent always-on-top `BrowserWindow`, HTTP sidecar, state persistence, tray. |
| **Svelte renderer** | CSS sprite animation, drag and resize interactions via `contextBridge`. |
| **petdex-bridge** | WSL Rust binary — called by shell hooks, POSTs to sidecar via localhost passthrough. |

Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Troubleshooting

**Pet window doesn't appear**
```sh
buddy doctor   # checks process, sidecar, token, and hook status in one pass
```
`buddy doctor` also verifies that the Electron runtime dependency is present. If that
check fails, reinstall with `npm install -g cli-buddy`.

**Hooks aren't triggering animations**
Re-run `buddy hooks install`, restart your shell, and confirm your AI CLI fires hooks.

**`buddy start` from WSL fails (interop error)**
WSL interop must be enabled. Verify `cmd.exe` is reachable from within your WSL session.

**`buddy hatch` fails immediately**
```sh
codex doctor   # verify Codex CLI is installed and authenticated
```
Set `BUDDY_CODEX_COMMAND` if Codex is at a non-standard path.

**Pet is off-screen after a monitor change**
```sh
buddy stop && buddy start   # startup clamps bounds into the current display work area
```

---

<div align="center">

MIT License · Windows only · No telemetry · No accounts · Local-only

</div>
