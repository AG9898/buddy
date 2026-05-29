# PRD — buddy

> **Status** (2026-05-22)
>
> | Track | State |
> |---|---|
> | Shipped | Nothing shipped yet. |
> | In Progress | See docs/workboard.json. |
> | Planned | Phase 1 MVP — see Scope below. |

---

## Objective

buddy is an npm-distributed developer tool that renders a floating, always-on-top, transparent pixel-art pet character on the Windows desktop that reacts to AI coding assistant activity in real time. It is for developers running the Codex CLI or Claude Code CLI on Windows or Windows+WSL who want ambient visual feedback about what their AI agent is doing. It solves the gap left by Petdex — which only ships macOS binaries — giving Windows developers the same live pet overlay experience. Because its audience lives in terminals and agentic coding environments, buddy is distributed as the `cli-buddy` npm package and configured entirely from the command line, with no separate GUI installer. Supported AI assistants are CLI tools only — no desktop application versions.

---

## Users

- **Developer** — single local user; no login, no account, no server. Runs AI coding assistant CLIs (Codex CLI, Claude Code) on Windows or Windows+WSL. Installs buddy once per machine via `npm install -g cli-buddy` from either a Windows terminal or a WSL terminal, then interacts with it via the `buddy` CLI and shell hooks. Has full control over the pet window (show/hide/move/quit).

---

## Scope

### Phase 1 — MVP

- Distributed as the `cli-buddy` npm package (`npm install -g cli-buddy`); primary install path is from either a Windows terminal or a WSL terminal
- npm release metadata and tarball contents are curated: the package keeps the installed `buddy` command, includes MIT license and repository metadata, builds with `prepack`, and excludes agent skill folders, workboard files, local caches, source-only planning files, and tests from `npm pack`
- CLI entry point (`buddy`) with subcommands: `start`, `stop`, `hooks install`, `state <name>`, `doctor`
- CLI behavior is terminal-first: concise styled output when supported, plain fallback in non-TTY contexts, actionable errors, and command details documented in [`CLI.md`](CLI.md)
- When installed in WSL: `buddy hooks install` sets up `.zshrc`/`.bashrc` shell hooks and uses WSL interop to launch the Windows-side Electron app; falls back with a clear message if WSL interop is unavailable
- When installed on Windows: `buddy start` launches the Electron app directly, detached, and returns control to the terminal
- `buddy stop` terminates the running Electron app
- Electron transparent always-on-top frameless window on Windows desktop (packaged via electron-builder for npm distribution)
- Render one sprite sheet with CSS background-position animation (buddy-defined pet.json sprite format)
- Pet state machine: idle, running, waiting, jumping, waving, failed, review
- Persist open state and window bounds across app restarts (`%USERPROFILE%\.petdex-win\state.json`)
- Visual mouse resize for the pet window, with the sprite scaling inside the window and resized bounds persisted across restarts
- System tray icon with Show / Hide / Quit menu items
- Local HTTP endpoint `POST /state` listening on `127.0.0.1:7777` (configurable via `BUDDY_PORT`)
- CLI hook event → pet state mapping: UserPromptSubmit → jumping, PreToolUse → running, PostToolUse → idle, PermissionRequest → waiting, Stop → waving (applies to both Codex CLI and Claude Code)

### Phase 2 — WSL Bridge and Extended Integration

- `petdex-bridge` Rust CLI cross-compiled for Linux/WSL (`x86_64-unknown-linux-gnu`), distributed as a companion WSL install artifact or npm package for installation inside WSL
- WSL shell hook integration: `.zshrc`/`.bashrc` hooks call `petdex-bridge`, which POSTs events to the Windows HTTP sidecar via WSL localhost passthrough
- Windows and WSL share the same buddy-owned token/state/pet model. Windows owns rendering and selected-pet resolution; WSL sends state events and should use a documented shared path, symlink, or copy flow rather than maintaining a divergent pet registry.
- Claude Code hook detection and shell hook installation
- Sprite creation tooling supporting buddy's pet.json sprite sheet format
- Multi-monitor and per-resolution DPI support (separate bounds per display config)
- Custom pet loading and selection from `%USERPROFILE%\.petdex-win\pets`, packaged buddy pets, and common Codex-compatible pet folders such as `%USERPROFILE%\.codex\pets`

### Out of Scope

- No OAuth, accounts, login, or cloud sync of any kind.
- No marketplace or gallery for sharing pets.
- No auto-updater or telemetry.
- No multi-agent or multi-user server.
- No mobile app.
- No public analytics dashboard.
- No macOS or Linux native app target — Windows-only.
- No reading from or writing to any AI assistant CLI's internal config or state files.

---

## Success Criteria

### Phase 1

- `npm install -g cli-buddy` succeeds from both a Windows terminal and a WSL terminal and installs the `buddy` command.
- `npm pack --dry-run` for `cli-buddy` contains only intended runtime assets, bundled pets, README/LICENSE, build metadata, and public docs.
- `buddy start` from a Windows terminal launches the pet window on the Windows desktop.
- `buddy start` exits after launching the detached app, and `buddy stop` terminates it cleanly.
- CLI output is readable in normal terminals, degrades cleanly in plain/non-TTY contexts, and avoids raw stack traces for expected user errors.
- `buddy hooks install` from a WSL terminal writes valid Claude Code CLI and Codex CLI hook entries and the pet reacts to tool events.
- When run from WSL, `buddy start` uses WSL interop to launch the Windows Electron app; if interop is unavailable a clear actionable error is printed.
- Pet animates through idle, running, and waiting states in response to CLI hook events (Claude Code and Codex CLI).
- State (open boolean, window bounds) persists correctly across full app restart.

### Phase 2

- The WSL bridge install path inside WSL installs the `petdex-bridge` binary and registers shell hooks.
- `petdex-bridge` binary builds cleanly with `cargo build --target x86_64-unknown-linux-gnu` and runs in WSL without additional runtime dependencies.
- Claude Code shell hooks installed through the WSL bridge setup trigger visible pet state changes on the Windows display.
- Per-resolution window bounds are stored and restored correctly when switching between monitor configurations.
- Users can visually resize the pet window, the sprite scales without clipping, and the resized bounds persist across restart.
- Users can list and select valid buddy-managed, packaged, and Codex-compatible pets without buddy modifying Codex internal state.

---

## Constraints

- Windows-only (win32). No macOS or Linux native app target is planned or supported.
- Electron transparent windows on Windows require `thickFrame: false` and `roundedCorners: false` — do not remove these flags.
- The local HTTP server must bind to `127.0.0.1` only. Binding to `0.0.0.0` is a security violation.
- All incoming HTTP requests to `/state` must be validated against the `X-Petdex-Update-Token` header (token stored at `%USERPROFILE%\.petdex-win\runtime\update-token`). Requests without a valid token must be rejected.
- Must not read from or write to any AI assistant CLI's internal config or state files (e.g. `.codex/`, `.claude/` internals).
- WSL agents cannot launch or inspect Windows GUI processes directly — all UI integration testing must be explicit and manual or use the CLI/HTTP interface.
- WSL interop (`buddy.exe` invoked from WSL shell) is the supported path for WSL-only installs. The CLI must detect when interop is unavailable and print a clear fallback message rather than silently failing.
- Custom pet directories use buddy's own format: a named directory containing `pet.json` and `spritesheet.webp`.
- Codex-compatible pet directories may be read as asset folders only. buddy must not read or write Codex internal state or selection files.
- No hardcoded credentials, tokens, or paths — all configuration via environment variables or well-known state file locations.
- electron-builder is the packaging and publishing tool. Configuration lives in `electron-builder.yml`.

---

## Non-Goals

- Not a general-purpose desktop widget platform — purpose-built for AI coding assistant feedback.
- Not a real-time remote monitoring system — events are local, fire-and-forget HTTP POSTs.
- Not a multi-user or networked application — single developer, single machine only.
- Not a sprite editor or full art tool — sprite creation support is limited to format compatibility helpers.
- Not an auto-updater — distribution and updates are via npm (`npm install -g cli-buddy@latest`).
- Not a replacement for the Codex CLI or Claude Code — buddy only listens to their hook events and displays a pet; it does not control or inspect the AI agents.
