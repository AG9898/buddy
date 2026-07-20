# buddy — Agent Working Guide

<!-- AGENTS.md is the canonical file. CLAUDE.md is a symlink to it.              -->
<!-- To set up after copying this file: ln -sf AGENTS.md CLAUDE.md               -->
<!--                                                                              -->
<!-- This file is a LIVING DOCUMENT — not a static README.                       -->
<!-- Agents update it after every task cycle with new discoveries and constraints.-->
<!-- Engineers seed it at project setup with known pitfalls and architecture.     -->

---

## Overview

buddy is a Windows floating desktop pet app built with Electron + Svelte + TypeScript and a Rust WSL bridge (petdex-bridge). Agents implement workboard tasks: Electron window setup, Svelte renderer, HTTP sidecar, tray, hook integration, and Rust bridge. The canonical task queue is docs/workboard.json. Reference handoff.md for Codex architecture details, Electron window options, and hook model.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start dev app (Electron + Vite)
npm run dev

# Lint / typecheck
npm run lint

# Build petdex-bridge (WSL bridge, requires cross-compile toolchain in WSL)
cd petdex-bridge && cargo build --release --target x86_64-unknown-linux-gnu
```

On PowerShell, prefer `npm.cmd ...` for npm commands. Some Windows machines block
`npm.ps1` through execution policy even though the npm `.cmd` shim works.

---

## Build & Verification Commands

| Command | What it checks | Speed |
|---------|---------------|-------|
| `npm test` | Vitest unit tests (Svelte, TS) | fast |
| `npm run lint` | ESLint + svelte-check + tsc --noEmit | fast |
| `cd petdex-bridge && cargo clippy -- -D warnings` | Rust lint | fast |
| `npm run build` | Electron production build (electron-builder) — requires symlink privilege on Windows | slow |
| `npm run build:win:local` | Local smoke build — skips code signing, works without Developer Mode | slow |
| `npm run test:e2e` | Playwright Electron E2E (Windows only) | slow |

---

## Repository Structure

```
buddy/
  package.json          — Electron app dependencies and npm scripts
  vite.config.ts        — Vite config for Svelte renderer + Electron main bundling
  tsconfig.json         — TypeScript config (strict mode)
  electron-builder.yml  — Windows installer/packager config
  src/
    cli/
      index.ts         — npm bin entry: thin parse/error boundary only
      program.ts       — createProgram(): Commander command tree, grouped help, global output options
      output.ts        — per-invocation OutputContext, mode routing, typed result/failure renderers
      result.ts        — CommandResult, CliError, JSON payload shapes, per-invocation result slot
      commands/        — CLI command implementations; hatch delegates imagegen work to Codex CLI
    main/
      main.ts           — Electron entry: app lifecycle, tray, startup restore
      avatar-window.ts  — BrowserWindow: transparent overlay creation, click-through, drag IPC
      state-store.ts    — read/write %USERPROFILE%\.petdex-win\state.json
      sidecar.ts        — local HTTP server on 127.0.0.1:BUDDY_PORT (/state endpoint)
      tray.ts           — system tray icon and Show/Hide/Quit context menu
      hooks-install.ts  — writes Codex/Claude Code hooks.json entries
    preload/
      preload.ts        — contextBridge: exposes petApi to renderer (setState, onStateChange, drag events, setPointerInteractive)
    shared/
      ipc-channels.ts   — side-effect-free IPC channel constants imported by main/preload/tests
    renderer/
      index.html        — Electron renderer entry
      main.ts           — Svelte bootstrap: mounts App into #app and imports global styles
      App.svelte        — root Svelte component, IPC event listener
      PetSprite.svelte  — sprite animation state machine, pointer/drag handling
      styles.css
  petdex-bridge/
    Cargo.toml
    src/
      main.rs           — CLI (clap): state <name>, POSTs to Electron HTTP sidecar
  pets/
    default/
      pet.json          — sprite state machine (Codex-compatible format)
      spritesheet.webp  — 8×9 pixel-art grid
  docs/
    INDEX.md            — navigation map (this file's pair)
    PRD.md              — product requirements
    CLI.md              — CLI command contract, terminal UX, hatch output, pet selection, and window command behavior
    ARCHITECTURE.md     — system topology and component responsibilities
    CONVENTIONS.md      — coding standards (TS, Svelte, Rust, sprite format)
    DECISIONS.md        — architectural decision log
    ENV_VARS.md         — environment variable matrix
    TESTING.md          — test strategy: Vitest, cargo test, Playwright E2E
    workboard.json      — canonical task queue
    workboard.schema.json
    workboard.md
  .claude/skills/       — project skills (query-workboard, start-task, etc.)
  AGENTS.md             — this file (symlinked as CLAUDE.md)
  handoff.md            — implementation reference (Codex architecture, hook model, Electron options)
```

Docs navigation: [`docs/INDEX.md`](docs/INDEX.md)

---

## Architecture

- Electron main process manages a transparent, frameless, always-on-top, non-focusable `BrowserWindow`. State persists to `%USERPROFILE%\.petdex-win\state.json`.
- Local HTTP sidecar (`sidecar.ts`) listens on `127.0.0.1:BUDDY_PORT`. Hook events arrive here from both Windows CLI and WSL petdex-bridge.
- Svelte renderer (`src/renderer/`) drives sprite animation via CSS `background-position` on an 8×9 spritesheet. State machine defined in `pet.json`.
- `petdex-bridge` (Rust, `petdex-bridge/`) is a Linux binary that runs in WSL. Shell hooks call it; it POSTs events to the Windows HTTP sidecar via localhost passthrough.
- All renderer↔main communication goes through the `petApi` contextBridge defined in `preload.ts`. IPC channel names are constants — never hardcoded strings.

Full topology: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Code Style & Constraints

### Never

- Never commit secrets or credentials.
- Never bulk-rewrite `docs/workboard.json`; use targeted edits only.
- Never write to `%USERPROFILE%\.codex\.codex-global-state.json` — Codex internals are off-limits.
- Never set `nodeIntegration: true` — use contextBridge only.
- Never bind the HTTP sidecar to `0.0.0.0`.
- Never make buddy own image-provider secrets for pet hatching; `buddy hatch` delegates `$imagegen` work to Codex CLI.

### Always

- Always run the fast verification suite before marking a task done.
- Always update relevant `docs/` files when behavior changes.
- Always use `showInactive()` to display the pet — never `show()`.
- Always clamp restored window bounds into the current display work area before showing the pet.
- Always save window bounds on close, drag-end, and display-change events.
- Always validate `X-Petdex-Update-Token` before acting on sidecar requests.

### Patterns

Full guide: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)

---

## Maintaining Docs

Docs must stay current with the code. Update the relevant doc in the **same commit** as
the code change — never defer a doc update to a follow-up task.

| What changed | Doc to update |
|---|---|
| CLI commands, terminal output, hatch progress, pet selection commands, or CLI lifecycle behavior | [`docs/CLI.md`](docs/CLI.md) |
| System topology, services, auth, data flow, deployment | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Coding pattern, naming rule, or never/always constraint | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| Env var added, removed, renamed, or changed | [`docs/ENV_VARS.md`](docs/ENV_VARS.md) |
| New architectural question raised | [`docs/DECISIONS.md`](docs/DECISIONS.md) — add OPEN-XX |
| Architectural decision resolved | [`docs/DECISIONS.md`](docs/DECISIONS.md) — move to Resolved |
| Test file added, removed, or pattern changed | [`docs/TESTING.md`](docs/TESTING.md) |
| Product scope, users, or success criteria changed | [`docs/PRD.md`](docs/PRD.md) |
| Any doc added, removed, renamed, or moved | [`docs/INDEX.md`](docs/INDEX.md) — always |
| Constraint or gotcha discovered during a task | This file (`AGENTS.md`) — append to Discoveries |

**Rule:** If a section in `AGENTS.md` summarizes something, and the full doc changes, update
both the summary here and the full doc in the same commit.

---

## Workboard

The canonical task queue is `docs/workboard.json`.
Schema and usage contract: [`docs/workboard.md`](docs/workboard.md).
Machine validation schema: [`docs/workboard.schema.json`](docs/workboard.schema.json).

Use the `/query-workboard` skill to inspect it. Use the `/start-task` skill to execute
a task end-to-end. Never dump the full board into context — use targeted `jq` queries.

A task is startable when:
- `status == "todo"`
- `blocked_by` is empty or missing
- all `depends_on` tasks have `status == "done"`

Targeted edit rules:
- Never rewrite the full `workboard.json`.
- Only update the status fields of the task currently being worked.
- Roll back `in_progress → todo` if blocked mid-task and unresolved.

---

## Agent Workflow

Standard task cycle for this project:

1. Read this file (`AGENTS.md` / `CLAUDE.md`) at the start of every session.
2. Run `{{CMD_PREFIX}}query-workboard` to find the next startable task.
3. Run `{{CMD_PREFIX}}start-task` to execute it (reads docs, implements, verifies, updates board).
4. Update this file if you discovered a constraint, pattern, or pitfall worth encoding.
5. Commit changes. Summarize: what was done, what was skipped, what is next.

For multi-task runs: `{{CMD_PREFIX}}ralphloop start-task iterations:N`.

<!-- NOTE: {{CMD_PREFIX}} is rendered by sync-skills.sh: → `/` for Claude, `$` for Codex. -->
<!-- Skills are sourced from ag.dev and synced into .claude/skills/ or .agents/skills/.   -->

### Stopping Conditions

Stop and report (do not continue) when:
- No startable task exists (all are blocked or done).
- A verification command fails and the fix is not obvious.
- An irreversible action (migration, destructive write, external publish) is required
  and the task does not explicitly authorize it.
- WSL localhost passthrough not routing (test: `curl http://127.0.0.1:7777/health` from WSL fails).
- Electron transparent window fails to render on the target Windows system (DPI/HDR issue).
- `cargo build --target x86_64-unknown-linux-gnu` fails (missing cross-compile toolchain in WSL).
- An irreversible action (writing hooks.json, modifying Codex config) is required and not explicitly authorized by the task.

---

## Debugging & Gotchas

---

## Environment Variables

See [`docs/ENV_VARS.md`](docs/ENV_VARS.md) for the canonical variable and secret matrix.

---

## Testing

`npm test` (Vitest), `cargo test`, `npm run test:e2e` (Electron E2E, Windows only). Full guide: [`docs/TESTING.md`](docs/TESTING.md).

---

## Deployment

`npm run build` produces a Windows installer via electron-builder. `petdex-bridge` is a standalone Linux binary distributed separately for WSL installation.

---

## Living Document

This file is a running notebook of agent discoveries. After each task cycle, update
this file if you found:

- A constraint that would have saved time if it were written here.
- A debugging tip that resolves a non-obvious failure.
- A pattern that should be followed for consistency.
- A "never do X" rule that emerged from a near-miss.

Append under `## Discoveries` below. Keep each entry to 2–3 sentences with a date.
Do not reorganize or rewrite existing entries — append only.

```
### YYYY-MM-DD — <short title>
<What you found and why future agents working here should know it.>
```

---

## Discoveries

### 2026-05-22 — renderer-ready handshake: remove showInactive() from avatar-window.ts
`createAvatarWindow()` originally called `win.showInactive()` unconditionally at the end, which would flash a blank transparent window before the Svelte renderer mounted. For FEAT-07, the call was moved to main.ts inside an `ipcMain.once(CH_RENDERER_READY)` handler; App.svelte calls `window.petApi.rendererReady()` on mount to trigger it. Always keep window display deferred to main.ts after the renderer-ready signal.

### 2026-05-22 — electron must be in devDependencies for electron-builder
electron-builder rejects builds if `electron` is listed under `dependencies` instead of `devDependencies`. The original package.json had it under `dependencies`, causing a hard build failure. Move it to `devDependencies` to fix this.

### 2026-07-17 — hatch-pet scripts require Pillow
`prepare_pet_run.py` imports `PIL`, so image-generation runs need Pillow installed in the active Python environment. Install it with `python -m pip install --user Pillow` before preparing a hatch-pet run when `ModuleNotFoundError: PIL` occurs.

### 2026-05-22 — npm run build fails on locked-down Windows machines (no Developer Mode)
`electron-builder` downloads `winCodeSign` which contains symlinks; creating symlinks requires Administrator or Developer Mode. Use `npm run build:win:local` (added to package.json) which passes `--config.win.signAndEditExecutable=false --publish never` to skip the code-signing helper. This is safe for smoke builds but must not be used for release packaging.

### 2026-05-22 — pets/default/spritesheet.webp is a placeholder; real art TBD via pet hatch skill
The committed `pets/default/spritesheet.webp` is a generated color-grid placeholder (1136×1386px, 142×154 per frame, 8×9 grid) so the app renders without a missing-asset crash. Real artwork will be generated via the codex pet hatch skill — see OPEN-01 in DECISIONS.md and the ASSET-01 workboard task.

### 2026-05-23 — never import preload.ts from main-process modules
`preload.ts` calls `contextBridge.exposeInMainWorld()` at module top level, so importing it from `main.ts`, `avatar-window.ts`, or `sidecar.ts` pulls preload-only code into the main bundle and can prevent Electron startup. IPC channel constants live in `src/shared/ipc-channels.ts`; import that side-effect-free module from main/preload/tests instead.

### 2026-05-23 — stale persisted bounds can hide a correctly rendered pet
`%USERPROFILE%\.petdex-win\state.json` can contain coordinates outside the current display work area, especially after resolution or monitor changes. Startup clamps restored bounds before creating the BrowserWindow and persists the corrected bounds, so a rendered window is not shown off-screen.

### 2026-05-24 — buddy hatch should delegate imagegen to Codex CLI
The hatch-pet workflow should be runnable from `buddy hatch`, but buddy should not implement an Anthropic image adapter or hold image-provider API keys. Keep `$imagegen` centralized in Codex by having the CLI invoke a Codex run for visual generation, then use the deterministic hatch-pet scripts to package buddy assets.

### 2026-05-24 - hatch-pet manifests must stay UTF-8 without BOM
PowerShell `Set-Content -Encoding UTF8` can write a UTF-8 BOM that makes hatch-pet Python scripts fail with `JSONDecodeError: Unexpected UTF-8 BOM`. When updating `imagegen-jobs.json` or run summaries from PowerShell, use `[System.Text.UTF8Encoding]::new($false)` with `[System.IO.File]::WriteAllText(...)`.

### 2026-05-24 - hatch-pet cleanup and npm on Windows
Use `npm.cmd test` and `npm.cmd run lint` from PowerShell so execution policy does not block `npm.ps1`. For hatch-pet cleanup, use `.codex/skills/hatch-pet/scripts/cleanup_run.py` instead of ad hoc recursive shell deletion; it keeps QA/final artifacts and removes only known disposable run paths.

### 2026-05-24 - packaged pets must be discoverable and default id must resolve
`buddy pets list` scans `%USERPROFILE%\.petdex-win\pets`, the package `pets/` directory, and `%USERPROFILE%\.codex\pets`. Keep `pets/default/pet.json` id set to `default`; otherwise the default state store selection reports as unresolved even though the bundled sprite files exist.

### 2026-05-29 - active pet spritesheets must stay inside the pet folder
Electron main resolves the selected pet and sends only one manifest plus one spritesheet `file://` URL to the renderer. Reject `pet.json` spritesheet values that escape the validated pet directory with `..` or absolute paths; otherwise a selected pet could grant renderer access to an arbitrary local file.

### 2026-05-29 - global npm start needs a production Electron runtime
`buddy start` in a clean `npm install -g cli-buddy` cannot rely on `devDependencies`, so Electron must remain available to installed packages as an optional production dependency. Keep CLI launch path logic in `src/cli/runtime.ts`; it resolves the package root and Electron executable without importing Electron APIs.

### 2026-05-29 - WSL shares the Windows-owned .petdex-win directory
Windows remains the owner of rendering, active pet selection, and token creation, while WSL tools read the same data through `$HOME/.petdex-win`. Prefer symlinking `$HOME/.petdex-win` to `/mnt/c/Users/<you>/.petdex-win`; use `BUDDY_DATA_DIR` only when a symlink or token copy is not practical.

### 2026-05-29 - Codex hooks use hooks.json, not shell rc exports
Current Codex CLI hook configuration uses `~/.codex/hooks.json`; the old shell rc `CODEX_HOOK_*` export approach is not the supported installer target. After `buddy hooks install`, users may still need to review/trust the new Codex command hooks from `/hooks` before Codex executes them.

### 2026-05-29 - Windows path separators break cross-platform unit tests
Unit tests that compare file paths using template literal strings (e.g. `${MOCK_HOME}/.codex/hooks.json`) fail on Windows because `path.join` produces backslash separators while the string literal uses forward slashes. Always use `path.join(MOCK_HOME, '.codex', 'hooks.json')` for path assertions in tests. Additionally, `USERPROFILE` env var on Windows overrides the mocked `os.homedir()` when `buddyDataDir` resolves paths; tests must clear `process.env.USERPROFILE` in `beforeEach` and restore it in `afterEach` so the mocked home is used.

### 2026-07-17 - WSL-to-Windows loopback requires mirrored networking
On this host, default WSL2 NAT mode cannot reach buddy's Windows-only `127.0.0.1:7777` sidecar from Linux, even though the Windows health endpoint works. Add `[wsl2]` / `networkingMode=mirrored` to `%USERPROFILE%\.wslconfig`, run `wsl --shutdown`, then verify with `curl http://127.0.0.1:7777/health` and `petdex-bridge state running` from WSL.

### 2026-07-17 - Hatch-pet chroma fringe needs post-processing QA
Frame extraction can pass deterministic validation while leaving a visible chroma-key color fringe. When final visual QA catches this, use the imagegen `remove_chroma_key.py` helper with soft matte, despill, and a small edge contract before re-extracting frames; regenerate only rows whose motion semantics genuinely fail visual review.

### 2026-07-20 - Generated row poses must be disconnected components
For component-based frame extraction, a strip needs one fully separated connected silhouette per required frame. A row can look visually spaced yet have tail or whisker pixels touching a neighboring pose; regenerate that row with a wide uninterrupted chroma-key gap rather than accepting slot-slicing fallback.

### 2026-07-20 - Hatch-pet must honor the run-selected chroma key and preserve source motion
`prepare_pet_run.py` can select green rather than magenta based on the reference, so workers and repair prompts must use the chroma key written in `pet_request.json`, never a hardcoded color. When component extraction re-centers an intentionally vertical animation such as jumping, use the QA-driven `stable-slots` mode before regenerating an otherwise valid row.

### 2026-07-20 - Hardcoded drive-letter paths in tests fail on Linux agents
`hatch.test.ts` stubbed `BUDDY_DATA_DIR=C:\buddy-data` and asserted a fully backslashed result, which passed on Windows but failed on Linux because `path.join` only normalizes the separators it adds. Build both the stubbed input and the expected value from `path.join`/`path.sep` so a single expectation holds on every platform; this complements the 2026-05-29 separator entry, which covered assertions but not drive-letter roots.

### 2026-07-20 - A root Commander action disables built-in unknown-command errors
Giving the root program an action handler (so bare `buddy` can print a landing surface) makes Commander pass unmatched arguments to that handler instead of raising `commander.unknownCommand`. `src/cli/program.ts` re-reports them through Commander's own `unknownCommand()` reporter so "did you mean" suggestions and exit codes survive; keep that guard if the root action changes.

### 2026-07-20 - Commander has no real global options; optsWithGlobals inverts precedence
Ancestor options are not parsed on subcommands, so `--json`/`--quiet`/`--verbose`/`--no-color` are registered on every command in the tree by `addGlobalOutputOptionsDeep()`. Do not read them with `optsWithGlobals()`: it merges ancestors *last*, so a root default silently overwrites a flag passed on the subcommand. Resolve instead by walking the command chain and taking only values where `getOptionValueSource(key) === 'cli'`.

### 2026-07-20 - Adding options to every command changes help subcommand terms
Registering the global output flags on all commands makes Commander render subcommand terms as `use [options] <id>` instead of `use <id>`, which broke a help assertion in `program.test.ts`. Expect that string change when adding options to leaf commands, and assert on the `[options]` form.

### 2026-07-20 - User hatches must not mutate bundled assets
`buddy hatch` defaults to a validated pet-id folder under the buddy-managed data directory, not `pets/default`. The shared `build/icon.ico` is application branding and must remain untouched by any pet hatch; replacing a bundled preset is an explicit maintainer-only workflow.
