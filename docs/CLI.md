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
| `buddy` | Show a compact interactive overview with version, app state, active pet, window size, hook summary, and suggested next commands. |
| `buddy status` | Print the same operational summary without the large banner. |
| `buddy pets current` | Canonical name for the current-pet view; `buddy pets show` remains a compatibility alias. |
| `buddy hooks status` | Report Claude Code and Codex CLI hook coverage without changing configuration. |
| `buddy hooks uninstall` | Remove only buddy-owned hook entries after explicit command invocation, preserving unrelated configuration. |

Existing commands retain their current names. Help output groups them by workflow: app
lifecycle, pet management, integrations, and diagnostics. Root and subcommand help use
short summaries plus concrete examples instead of embedding implementation detail in the
command list. The version displayed by `buddy --version` must come from package metadata so
it cannot drift from `package.json`.

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
the pet. The planned implementation requests a graceful, token-authenticated shutdown from
the running sidecar. A fallback may target a verified buddy process id, but must never kill
every process named `electron.exe`.

`buddy start` reports success only after the child process has spawned successfully. A
missing or unlaunchable runtime produces a concise error and non-zero exit instead of a
premature success message.

When run from WSL, `buddy start` uses WSL interop to invoke the Windows-side app. If
interop is unavailable, print a clear actionable error and exit non-zero.

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

The planned global output options are:

| Option | Behavior |
|---|---|
| `--verbose` | Include subprocess, path, and diagnostic detail where available. |
| `--quiet` | Suppress non-essential progress and hints while preserving requested data and errors. |
| `--json` | Emit one stable JSON result to stdout and send diagnostics to stderr. |
| `--no-color` | Disable ANSI styling explicitly, equivalent to the established `NO_COLOR` behavior. |

Normal output remains human-focused. Commands must not mix banners, progress lines, or
human prose into JSON stdout. Machine-readable result shapes and exit codes are part of the
public CLI contract once introduced and require compatibility tests.

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
command-specific debug flags should not be added. `--quiet` and `--verbose` are mutually
exclusive. If environment-driven debug output changes, document it in
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

The planned live-selection flow sends a token-authenticated request to Electron main after
persisting a valid selection. When the app is running, the renderer reloads the manifest and
spritesheet immediately without stealing focus. When the app is stopped or live reload
fails, the success message must state that the selection is saved for the next start rather
than implying that it is already visible. `buddy pets current` becomes the canonical name
for the current selection and `buddy pets show` remains an alias.

`buddy state <name>` validates state names before sending them. Invalid names return valid
choices and a close-match suggestion when available. State validation must use the active
pet manifest when it is resolvable and the packaged default state set as the fallback.

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

Command implementations should return typed results or throw typed expected errors; only
the CLI entry layer converts those outcomes to terminal output and `process.exitCode`. This
keeps command logic testable without mocking or terminating the test process.

---

## Testing Expectations

CLI changes should include focused tests or smoke checks for:

- `--help` output for changed commands.
- Bare `buddy`, `buddy --version`, root help, and subcommand help behavior.
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
  terminate an unrelated Electron process.
- Installed-package smoke tests should install the packed tarball with production
  dependencies only and verify that `require.resolve("electron", { paths: [packageRoot] })`
  succeeds for the installed package.
