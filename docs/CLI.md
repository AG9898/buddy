# CLI.md - Command Contract and Terminal UX

This is the canonical reference for buddy's command-line behavior. Read this before
adding, renaming, removing, or changing any command under `src/cli/`.

buddy is a terminal-first desktop pet app. The CLI should be concise, predictable, and
usable from Windows PowerShell, Command Prompt, WSL shells, non-TTY scripts, and CI.
The npm package is named `@ag9898/buddy`, but the installed command remains `buddy`.

---

## Command Catalog

| Command | Purpose |
|---|---|
| `buddy` | Operational overview: banner (TTY only), current status, and suggested next commands. |
| `buddy --version` | Print the installed version, sourced from `package.json`. |
| `buddy --help` | Workflow-grouped command list and examples. |
| `buddy status` | Print version, app state, active pet, window size, and hook coverage. |
| `buddy start` | Launch the Electron pet app detached and return control to the terminal. |
| `buddy stop` | Terminate the running Electron pet app. |
| `buddy state <name>` | Send a pet state change to the local sidecar. |
| `buddy hooks install [--rc <path>]` | Install Claude Code and Codex CLI hook entries. |
| `buddy doctor` | Print a health checklist for process, sidecar, token, and hooks. |
| `buddy hatch <prompt> [--id <id> | --output <dir> | --package-preset <id>] [--verbose]` | Generate a personal pet by default; bundled presets require explicit maintainer opt-in. |
| `buddy pets list` | List valid buddy-managed, packaged, and Codex-compatible pets. |
| `buddy pets show` | Print the currently selected pet and its source path. |
| `buddy pets use <id>` | Validate and persist the active pet selection. |
| `buddy size <scale-or-width>` | Resize the pet window from the terminal. Accepts a scale factor (e.g., `1.5`, `2x`) or explicit WxH dimensions (e.g., `400x300`). |

---

## Accepted CLI UX Refresh (Planned)

The next CLI iteration improves discoverability, output consistency, automation support,
and lifecycle safety without removing the existing top-level commands. Until the matching
workboard tasks are complete, this section is a forward-looking contract rather than a
description of shipped behavior.

The planned command surface adds:

| Command | Purpose |
|---|---|
| `buddy pets current` | Canonical name for the current-pet view; `buddy pets show` remains a compatibility alias. |
| `buddy hooks status` | Report Claude Code and Codex CLI hook coverage without changing configuration. |
| `buddy hooks uninstall` | Remove only buddy-owned hook entries after explicit command invocation, preserving unrelated configuration. |

Existing commands retain their current names.

---

## Operational Status and the Root Overview

`buddy status` is the single operational summary. It consumes the Electron-owned,
token-authenticated `GET /status` snapshot, which exposes only whether the app is running
and visible, the resolved active pet's id/name/source, and the current window width/height.
Hook coverage is resolved separately by the CLI using the same detection as `buddy doctor`.
`GET /health` remains unauthenticated and is deliberately limited to `{ "status": "ok" }`.

Status is a read-only report, so it never fails the invocation for an inactive app: a
stopped app, a missing runtime token, an unreachable sidecar, and an unparseable response
all degrade to a "buddy is not running" result with exit code `0`, the still-resolvable
version and hook coverage, and an actionable hint. The result carries only the stable
failure *code* (`sidecar.unreachable`, `sidecar.token_missing`, `sidecar.timeout`,
`sidecar.invalid_response`). Token values, token paths, arbitrary filesystem contents, and
assistant configuration contents are never included in human or JSON output; hooks are
summarized as per-assistant installed/total counts only. Use `buddy doctor` when the
detailed pass/fail checklist and non-zero exit are wanted.

Human output is one summary line plus `key: value` rows:

```text
✔ buddy is running.
  → Version: 1.0.2
  → App: running (visible)
  → Pet: Penguin (penguin, packaged)
  → Window: 356x320
  → Hooks: 10/10 installed (claude-code 5/5, codex-cli 5/5)
```

Bare `buddy` is the interactive overview: the banner (interactive terminals only), the
same status body, and suggested next commands (`buddy start` or `buddy pets list` /
`buddy size` / `buddy stop`, `buddy hooks install` when coverage is incomplete, and
`buddy --help`). Suggestions render through the same hint channel, so `--quiet` drops them
and JSON never contains them. Redirected output and `--json` omit the banner, and
`buddy --json` emits exactly the payload `buddy status --json` emits — both use the
`app.status` command id and the identical `data` shape:

```json
{
  "ok": true,
  "command": "app.status",
  "data": {
    "version": "1.0.2",
    "environment": "windows",
    "app": { "running": true, "visible": true },
    "pet": { "id": "penguin", "name": "Penguin", "source": "packaged" },
    "window": { "width": 356, "height": 320 },
    "hooks": {
      "installed": 10,
      "total": 10,
      "coverage": "complete",
      "targets": { "claude-code": { "installed": 5, "total": 5 } }
    },
    "sidecar": { "reachable": true, "error": null }
  }
}
```

`pet` and `window` are `null` whenever the snapshot is unavailable. The full workflow-grouped
command list moved to `buddy --help`.

---

## Command Structure and Help Surfaces

Command construction lives in `src/cli/program.ts` and is exported as `createProgram()`.
`src/cli/index.ts` is a thin executable boundary: it builds the program, parses
`process.argv`, and converts a thrown expected error into one concise message plus a
non-zero exit code. Command modules throw instead of calling `process.exit()`, and no
module parses `process.argv` at import time, so tests can construct the program and parse
explicit argument arrays.

Root help groups commands by workflow — app lifecycle, pet management, integrations, and
diagnostics — using short summaries plus concrete examples instead of embedding
implementation detail in the command list. Subcommands keep Commander's default help
layout and add their own examples section.

Bare `buddy` prints the operational overview described above and exits `0`; `buddy --help`
prints the grouped command list. The banner renders only on those two root surfaces and only
when stdout is a TTY, so redirected output and CI stay deterministic and the banner is never
printed twice on one surface.

The version displayed by `buddy --version` is read from `package.json` at runtime through
`resolveCliVersion()`, which resolves the package root from both a source checkout and the
built `out/cli/` bundle. There is no duplicated version literal in the CLI source.

Unknown commands report `unknown command '<name>'` with a "did you mean" suggestion, and
missing arguments or unknown options exit non-zero with Commander's standard messages.

---

## Lifecycle Behavior

`buddy start` launches the Windows Electron app in the background and exits promptly. The
Electron process owns the BrowserWindow, local sidecar, tray, state persistence, and all
long-running work. The CLI must not keep a long-running server process alive.

In a published npm install, `buddy start` resolves the `@ag9898/buddy` package root and the
npm-installed Electron runtime, then launches Electron with the package root as the app
path. It must not rely on devDependencies or the current working directory being a source
checkout.

`buddy stop` is the process termination command. The app may still expose hide/show from
the tray or future CLI commands, but `stop` means "quit the Electron app", not merely hide
the pet. It sends an empty, token-authenticated `POST /shutdown` request to the running
sidecar. Electron persists the final state before quitting, and the sidecar accepts one valid
shutdown request only. If the sidecar is unreachable, `stop` may force-terminate only the pid
in Electron's runtime process record after Windows verifies that its executable and command
line still match the buddy app. It never kills by `buddy.exe` or `electron.exe` image name,
and an already-stopped app is a successful, idempotent result. The same `.exe` interop calls
support that narrowly verified fallback from WSL.

`buddy start` reports success only after launch has been confirmed. On Windows it waits for
the detached Electron child to emit `spawn`, then releases that child so the terminal returns
promptly. A missing or unlaunchable runtime produces a concise typed error and non-zero exit
instead of a premature success message. Its typed `app.start` result uses the shared human,
quiet, verbose, JSON, and no-color rendering modes.

When run from WSL, `buddy start` uses WSL interop to invoke the Windows-side app. It waits for
the interop child to spawn and exit zero before reporting success. Missing `cmd.exe`, spawn
failures, and a non-zero interop exit produce clear actionable typed errors.

Install examples should use `npm install -g @ag9898/buddy`. User-facing command examples
should continue to use `buddy ...`.

---

## Output Standards

Default output should be high signal:

- Use concise status lines with consistent wording.
- Use the Buddy CLI banner for primary command entry/help surfaces, styled with the
  default warm orange accent theme when color is supported.
- Use styled/color output when the terminal supports it.
- Degrade to plain ASCII in non-TTY contexts, CI, or terminals without color support.
- Keep errors actionable and human-readable.
- Do not print raw stack traces for expected user errors such as "app not running",
  "token missing", "Codex CLI not found", or "invalid pet folder".
- Include the next command when there is an obvious recovery step.
- Reserve orange for Buddy branding, headings, and active selections; use green for
  success, yellow for degraded states, red for failures, and dim text for secondary detail.
- Keep normal success output to one concise result plus an optional next-command hint.
- Do not render the large banner, animated progress, or decorative separators when stdout
  is redirected or the command is running in a non-TTY environment.

The global output options are:

| Option | Behavior |
|---|---|
| `--verbose` | Include subprocess, path, and diagnostic detail where available. |
| `--quiet` | Suppress non-essential progress and hints while preserving requested data and errors. |
| `--json` | Emit one stable JSON result to stdout and send diagnostics to stderr. |
| `--no-color` | Disable ANSI styling explicitly, equivalent to the established `NO_COLOR` behavior. |

All four are inherited by nested commands and accepted in either position, so
`buddy --json pets list` and `buddy pets list --json` are equivalent. `--quiet` with
`--verbose` is rejected as a conflicting option, in both the same-command and split
(`buddy --verbose pets list --quiet`) forms.

Output routes by channel: errors always go to stderr; progress lines and hints are dropped
by `--quiet`; verbose-only detail appears solely under `--verbose`. Under `--json`, human
output never touches stdout — warnings and verbose detail are diverted to stderr, color is
forced off so stdout stays byte-stable, and exactly one payload is written:

```json
{ "ok": true, "command": "pets.list", "data": { "pets": ["default"] } }
{ "ok": false, "command": "state.set", "error": { "code": "sidecar.unreachable", "message": "…", "hint": "…" } }
```

A failure is still the single stdout result so scripts can branch on `ok`, while the human
error message stays on stderr.

Normal output remains human-focused. Commands must not mix banners, progress lines, or
human prose into JSON stdout. Machine-readable result shapes and exit codes are part of the
public CLI contract and require compatibility tests.

The canonical Buddy text logo is:

```text
    ____            __    __
   / __ )__  ______/ /___/ /_  __
  / __  / / / / __  / __  / / / /
 / /_/ / /_/ / /_/ / /_/ / /_/ /
/_____/\__,_/\__,_/\__,_/\__, /
                        /____/
```

Render the logo as a CLI banner with tasteful framing, spacing, and the warm accent
theme. The text shape above is fixed; styling around it can evolve as long as plain
fallback output remains readable.

---

## Verbosity Model

Normal mode is concise. Commands should show enough progress for the user to understand
what is happening without dumping implementation details.

Verbose/debug output may include subprocess commands, raw child-process output, stack
traces, and detailed paths. `--verbose` is a global option inherited by subcommands;
command-specific debug flags should not be added. `buddy hatch` therefore has no local
`--verbose` flag of its own — it reads the resolved global mode. `--quiet` and `--verbose`
are mutually exclusive. If environment-driven debug output changes, document it in
[`ENV_VARS.md`](ENV_VARS.md).

---

## Hook Installation

`buddy hooks install` configures both supported assistant CLIs in the current host
environment:

- Claude Code hooks are written to `~/.claude/settings.json`.
- Codex CLI hooks are written to `~/.codex/hooks.json`.
- Windows-hosted hooks run `buddy state <name>`.
- WSL-hosted hooks run `petdex-bridge state <name>` so hook events cross into the
  Windows Electron sidecar through the WSL bridge.

The command is idempotent and preserves unrelated hook entries in existing JSON files.
The legacy `--rc <path>` flag is accepted for older scripts but is ignored; Codex CLI
hooks no longer use shell rc environment-variable exports.

After installing Codex hooks, users may need to open `/hooks` inside Codex CLI to review
and trust the new command hooks before Codex will execute them.

The planned `buddy hooks status` command reuses the same detection logic as `buddy doctor`.
The planned `buddy hooks uninstall` command removes only entries owned by buddy, is
idempotent, preserves unrelated JSON content, and reports exactly which entries were
removed or already absent. Invoking `uninstall` is the explicit authorization to modify
the hook configuration; it must not be performed automatically by `doctor`.

## Hatch Workflow Output

`buddy hatch` is a user command, not a transcript dump. It delegates the visual generation
phase to Codex CLI so Codex owns `$imagegen` routing and image-provider credentials, but
the user's terminal should see a streamlined progress flow:

1. Validate Codex CLI availability and readiness.
2. Confirm the requested concept and destination directory.
3. Show compact progress for visual generation.
4. Show compact progress for deterministic sprite packaging and validation.
5. Print the generated pet id/path and the command to select it when selection commands
   exist.

The planned interactive presentation renders these as stable numbered stages, includes
elapsed time for long-running work, and uses an in-place spinner only when stdout is a TTY.
Plain, quiet, and JSON modes must remain deterministic. Ctrl+C should terminate the child
Codex process and clean only known disposable run artifacts. Existing destination content
must not be overwritten without explicit confirmation in a TTY or `--yes` in an automated
run.

Raw Codex/imagegen output is hidden during normal runs. Pass `--verbose` (or set
`BUDDY_LOG_LEVEL=debug` / `BUDDY_VERBOSE=1`) to expose raw subprocess output for
troubleshooting.

```
buddy hatch "a small orange cat"
buddy hatch "a small orange cat" --id marmalade
buddy hatch "a small orange cat" --verbose
buddy hatch "a small orange cat" --output C:\\art\\my-cat
buddy hatch "a small orange cat" --package-preset penguin
```

Codex CLI failures produce a concise actionable error in normal mode. The `--verbose` hint
is included in the failure message when no subprocess output was captured.

Without a destination option, `buddy hatch` derives a short lowercase id from the prompt
and writes to `<buddy data dir>\\pets\\<id>` (normally
`%USERPROFILE%\\.petdex-win\\pets\\<id>`). This keeps generated pets personal to the current
user and makes them immediately discoverable by `buddy pets`. Use `--id <id>` to choose the
folder name. `--output <dir>` is an explicit custom destination. `--package-preset <id>` is
for maintainers working in a source checkout who intentionally want to replace a bundled
`pets/<id>` asset; packaged pets are otherwise read-only for end users.

---

## Pet Discovery and Selection

buddy supports three pet sources:

| Source | Default path | Notes |
|---|---|---|
| buddy-managed pets | `%USERPROFILE%\.petdex-win\pets` on Windows, `$HOME/.petdex-win/pets` in WSL | Primary location for pets created by `buddy hatch`; rooted under `BUDDY_DATA_DIR` when that override is set. |
| packaged pets | `<buddy package>\pets` | Built-in read-only pets shipped with buddy: `default` and `penguin`. |
| Codex-compatible pets | `%USERPROFILE%\.codex\pets` | Read as asset folders only. buddy must not read or write Codex internal state. |

A valid pet folder contains:

- `pet.json`
- the spritesheet named by `pet.json`, usually `spritesheet.webp`
- a valid state machine in buddy's pet format

Selection commands should validate every candidate before listing or selecting it. Invalid
folders should be skipped or reported with a concise reason, not treated as active pets.

The active pet selection is buddy-owned state. Persist it through the normal state store
owned by the Electron main process, not by writing to Codex configuration files.
`buddy pets use <id>` affects the next Electron startup or renderer reload: the main
process resolves the selected id, validates the matching `pet.json` and spritesheet, and
falls back to the packaged `default` pet if the stored selection no longer resolves.

Electron now exposes a token-authenticated `POST /pets/use` control for a later CLI
integration. It revalidates the requested id inside the Electron process, persists it
through the canonical state store, sends the bounded active-pet payload to the running
renderer, and returns only the selected manifest, source label, and renderer-safe
spritesheet URL. It rejects missing, invalid, and path-escaping ids; the id is never used
as a filesystem path. The renderer swaps the pet in place without recreating, moving,
showing, or focusing the window. The `buddy pets use` request wiring remains follow-up
work, so current command success continues to describe a selection that will apply on the
next start. `buddy pets current` becomes the canonical name for the current selection and
`buddy pets show` remains an alias.

`buddy state <name>` validates state names before sending them. Invalid names return valid
choices and a close-match suggestion when available. State validation must use the active
pet manifest when it is resolvable and the packaged default state set as the fallback.

State and size requests use the same token-authenticated local sidecar client. It loads the
runtime token, sends the request, parses JSON responses, applies a bounded timeout, and
presents missing-token, connection, timeout, and HTTP failures as typed CLI errors. The
client exposes both a POST helper for state-changing commands and a GET helper used by the
read-only `buddy status` snapshot (bounded to a shorter interactive timeout). Their results
therefore honor the shared human, quiet, verbose, JSON, and no-color output modes; only the
CLI entry boundary renders those results and assigns a non-zero exit code for a failure.

Windows owns selected-pet rendering. WSL hook commands may send state events and may share
the buddy token and pet assets, but WSL must not maintain a second independent active-pet
registry. The preferred WSL setup is:

```sh
ln -s /mnt/c/Users/<you>/.petdex-win ~/.petdex-win
```

If symlinks are not practical, copy `%USERPROFILE%\.petdex-win\runtime\update-token` to
`$HOME/.petdex-win/runtime/update-token`, or set
`BUDDY_DATA_DIR=/mnt/c/Users/<you>/.petdex-win` for WSL commands. `BUDDY_TOKEN` remains a
temporary debugging override, not the normal hook setup.

---

## Window Controls

Electron main owns all window operations. CLI commands may request state changes through
the sidecar or future IPC-backed command surfaces, but they must not directly mutate
window files or bypass the Electron process.

Visual resize is the primary resize interaction. The renderer exposes a resize handle,
main resizes the BrowserWindow, and the sprite scales to fit inside the current
transparent window without clipping. The app persists bounds at resize end.

`buddy size` is the secondary CLI resize command. It accepts:
- A scale factor relative to the default 356×320 window: `buddy size 1.5` or `buddy size 2x`
- Explicit pixel dimensions: `buddy size 400x300`

`buddy size` POSTs the computed dimensions to `POST /resize` on the local HTTP sidecar
(same token-authenticated flow as `buddy state`). The sidecar forwards a `CH_CLI_RESIZE`
IPC message to Electron main, which calls `setBounds` and persists the final bounds via
`saveBounds`. The accepted size range is 80–1200 pixels per dimension. Sizes outside
this range produce a non-zero exit with an actionable error message.

Resize behavior must preserve transparent-window constraints, click-through behavior, and
the existing renderer-ready `showInactive()` lifecycle.

---

## Environment Variables

The canonical environment variable matrix is [`ENV_VARS.md`](ENV_VARS.md). CLI-related
variables currently include:

- `BUDDY_PORT`
- `BUDDY_DATA_DIR`
- `BUDDY_SPRITES_DIR`
- `BUDDY_LOG_LEVEL`
- `BUDDY_CODEX_COMMAND`

If color, verbosity, or pet lookup behavior becomes environment-configurable, update
[`ENV_VARS.md`](ENV_VARS.md) in the same change.

---

## Exit Codes

Use exit code `0` for success. Use non-zero exit codes for user-actionable failures,
invalid input, missing dependencies, sidecar connection failures, or failed subprocesses.

Expected failure states should be clean terminal errors, not crashes.

Command implementations return typed results (`CommandResult` in `src/cli/result.ts`) or
throw typed expected errors (`CliError`, which carries a stable `code`, an optional `hint`,
and its own `exitCode`); only the CLI entry layer (`src/cli/index.ts`) converts those
outcomes to terminal output and `process.exitCode`. This keeps command logic testable
without mocking streams or terminating the test process.

Because a Commander action handler cannot return a value, commands publish their outcome
with `recordResult()` and the entry boundary drains it after parsing. Migrating each
command family onto typed results is tracked as follow-up work; commands not yet migrated
still print through the shared output helpers.

---

## Testing Expectations

CLI changes should include focused tests or smoke checks for:

- `--help` output for changed commands.
- Bare `buddy`, `buddy --version`, root help, and subcommand help behavior.
- `buddy status` running, stopped, missing-token, and partial-hook paths, plus the
  banner-on-TTY-only rule and the shared JSON payload for bare `buddy`.
- Non-TTY/plain output behavior when styling is disabled or unsupported.
- Styled output behavior when styling is supported.
- Global `--verbose`, `--quiet`, `--json`, and `--no-color` behavior, including stdout and
  stderr separation.
- Expected error output and exit codes.
- `buddy hatch` progress output without raw subprocess dumps in normal mode.
- Pet discovery from buddy-managed, packaged, and Codex-compatible directories.
- Invalid pet folder handling.
- Built CLI smoke tests through `node out/cli/index.js --help` after packaging changes.
- Safe lifecycle behavior: start must not report success before spawn, and stop must never
  terminate an unrelated Electron process; graceful shutdown, authorization rejection,
  already-stopped results, and the verified PID fallback must be covered.
- Installed-package smoke tests should install the packed tarball with production
  dependencies only and verify that `require.resolve("electron", { paths: [packageRoot] })`
  succeeds for the installed package.
