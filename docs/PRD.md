# PRD — buddy

> **Status** (2026-05-21)
>
> | Track | State |
> |---|---|
> | Shipped | Nothing shipped yet. |
> | In Progress | See docs/workboard.json. |
> | Planned | Phase 1 MVP — see Scope below. |

---

## Objective

buddy is a standalone Windows desktop app that renders a floating, always-on-top, transparent pixel-art pet character that reacts to AI coding assistant activity in real time. It is for developers running Codex or Claude Code on Windows or Windows+WSL who want ambient visual feedback about what their AI agent is doing. It solves the gap left by Petdex — which only ships macOS binaries — giving Windows developers the same live pet overlay experience without requiring macOS or a second machine.

---

## Users

- **Developer** — single local user; no login, no account, no server. Runs AI coding assistants (Codex, Claude Code) on Windows or Windows+WSL. Installs buddy once per machine and interacts with it via system tray, a CLI command, and shell hooks. Has full control over the pet window (show/hide/move/quit).

---

## Scope

### Phase 1 — MVP

- Electron transparent always-on-top frameless window on Windows desktop
- Render one sprite sheet with CSS background-position animation (Codex-compatible format)
- Pet state machine: idle, running, waiting, jumping, waving, failed, review
- Persist open state and window bounds across app restarts (`%USERPROFILE%\.petdex-win\state.json`)
- System tray icon with Show / Hide / Quit menu items
- Local HTTP endpoint `POST /state` listening on `127.0.0.1:7777` (configurable via `BUDDY_PORT`)
- CLI command (`petdex-win state <state>`) to manually send a state update
- `petdex-win hooks install` command that writes valid Codex `hooks.json` entries
- Codex hook event → pet state mapping: UserPromptSubmit → jumping, PreToolUse → running, PostToolUse → idle, PermissionRequest → waiting, Stop → waving

### Phase 2 — WSL Bridge and Claude Code Integration

- `petdex-bridge` Rust CLI cross-compiled for Linux/WSL (`x86_64-unknown-linux-gnu`)
- WSL shell hook integration: `.zshrc`/`.bashrc` hooks call `petdex-bridge`, which POSTs events to the Windows HTTP sidecar via WSL localhost passthrough
- Claude Code hook detection and shell hook installation
- Sprite creation tooling supporting Codex-compatible sprite sheet format
- Multi-monitor and per-resolution DPI support (separate bounds per display config)
- Custom pet loading from `~/.codex/pets` or `%USERPROFILE%\.petdex-win\pets`

### Out of Scope

- No OAuth, accounts, login, or cloud sync of any kind.
- No marketplace or gallery for sharing pets.
- No auto-updater or telemetry.
- No multi-agent or multi-user server.
- No mobile app.
- No public analytics dashboard.
- No macOS or Linux native app target — Windows-only.
- No reading from or writing to Codex's internal state files (`.codex-global-state.json`).

---

## Success Criteria

### Phase 1

- Pet window appears on the Windows desktop after `npm run dev` or packaged app launch.
- Pet animates through idle, running, and waiting states in response to Codex hook events.
- Window survives minimize and close of the main Codex window (always-on-top, independent process).
- State (open boolean, window bounds) persists correctly across full app restart.
- `petdex-win hooks install` writes syntactically valid Codex `hooks.json` entries that Codex loads without error.

### Phase 2

- `petdex-bridge` binary builds cleanly with `cargo build --target x86_64-unknown-linux-gnu` and runs in WSL without additional runtime dependencies.
- Claude Code shell hooks installed via `petdex-bridge hooks install --shell zsh` (or bash) trigger visible pet state changes on the Windows display.
- Per-resolution window bounds are stored and restored correctly when switching between monitor configurations.

---

## Constraints

- Windows-only (win32). No macOS or Linux native app target is planned or supported.
- Electron transparent windows on Windows require `thickFrame: false` and `roundedCorners: false` — do not remove these flags.
- The local HTTP server must bind to `127.0.0.1` only. Binding to `0.0.0.0` is a security violation.
- All incoming HTTP requests to `/state` must be validated against the `X-Petdex-Update-Token` header (token stored at `%USERPROFILE%\.petdex-win\runtime\update-token`). Requests without a valid token must be rejected.
- Must not read from or write to Codex's internal state files (`.codex-global-state.json` or similar).
- WSL agents cannot launch or inspect Windows GUI processes directly — all test instructions must be explicit and manual or use the CLI/HTTP interface.
- Custom pet directories must follow the Codex format: a named directory containing `pet.json` and `spritesheet.webp`.
- No hardcoded credentials, tokens, or paths — all configuration via environment variables or well-known state file locations.

---

## Non-Goals

- Not a general-purpose desktop widget platform — purpose-built for AI coding assistant feedback.
- Not a real-time remote monitoring system — events are local, fire-and-forget HTTP POSTs.
- Not a multi-user or networked application — single developer, single machine only.
- Not a sprite editor or full art tool — sprite creation support is limited to format compatibility helpers.
- Not an auto-updater — distribution and updates are manual or handled externally.
- Not a replacement for Codex or Claude Code — buddy only listens to their events and displays a pet; it does not control or inspect the AI agents.
