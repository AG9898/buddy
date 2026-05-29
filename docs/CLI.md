# CLI.md - Command Contract and Terminal UX

This is the canonical reference for buddy's command-line behavior. Read this before
adding, renaming, removing, or changing any command under `src/cli/`.

buddy is a terminal-first desktop pet app. The CLI should be concise, predictable, and
usable from Windows PowerShell, Command Prompt, WSL shells, non-TTY scripts, and CI.
The npm package is named `cli-buddy`, but the installed command remains `buddy`.

---

## Command Catalog

| Command | Purpose |
|---|---|
| `buddy start` | Launch the Electron pet app detached and return control to the terminal. |
| `buddy stop` | Terminate the running Electron pet app. |
| `buddy state <name>` | Send a pet state change to the local sidecar. |
| `buddy hooks install [--rc <path>]` | Install Claude Code and Codex CLI hook entries. |
| `buddy doctor` | Print a health checklist for process, sidecar, token, and hooks. |
| `buddy hatch <prompt> [--output <dir>] [--verbose]` | Generate pet assets by delegating image work to Codex CLI, then package buddy assets. |
| `buddy pets list` | List valid buddy-managed, packaged, and Codex-compatible pets. |
| `buddy pets show` | Print the currently selected pet and its source path. |
| `buddy pets use <id>` | Validate and persist the active pet selection. |

Planned window command:

| Command | Purpose |
|---|---|
| `buddy size <scale-or-width>` | Resize from the terminal after visual resize support exists. Secondary priority. |

---

## Lifecycle Behavior

`buddy start` launches the Windows Electron app in the background and exits promptly. The
Electron process owns the BrowserWindow, local sidecar, tray, state persistence, and all
long-running work. The CLI must not keep a long-running server process alive.

In a published npm install, `buddy start` resolves the `cli-buddy` package root and the
npm-installed Electron runtime, then launches Electron with the package root as the app
path. It must not rely on devDependencies or the current working directory being a source
checkout.

`buddy stop` is the process termination command. The app may still expose hide/show from
the tray or future CLI commands, but `stop` means "quit the Electron app", not merely hide
the pet.

When run from WSL, `buddy start` uses WSL interop to invoke the Windows-side app. If
interop is unavailable, print a clear actionable error and exit non-zero.

Install examples should use `npm install -g cli-buddy`. User-facing command examples
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

Structured command output is not required for MVP. If JSON output is added later, gate it
behind an explicit option such as `--json` and keep normal output human-focused.

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
traces, and detailed paths. Prefer one explicit switch across commands, such as
`--verbose`, before adding command-specific debug flags. If environment-driven debug
output is added, document it in [`ENV_VARS.md`](ENV_VARS.md).

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

Raw Codex/imagegen output is hidden during normal runs. Pass `--verbose` (or set
`BUDDY_LOG_LEVEL=debug` / `BUDDY_VERBOSE=1`) to expose raw subprocess output for
troubleshooting.

```
buddy hatch "a small orange cat"
buddy hatch "a small orange cat" --verbose
buddy hatch "a small orange cat" --output pets/my-cat
```

Codex CLI failures produce a concise actionable error in normal mode. The `--verbose` hint
is included in the failure message when no subprocess output was captured.

---

## Pet Discovery and Selection

buddy supports three pet sources:

| Source | Default path | Notes |
|---|---|---|
| buddy-managed pets | `%USERPROFILE%\.petdex-win\pets` on Windows, `$HOME/.petdex-win/pets` in WSL | Primary location for pets created by `buddy hatch`; rooted under `BUDDY_DATA_DIR` when that override is set. |
| packaged pets | `<buddy package>\pets` | Built-in read-only pets shipped with buddy, including `default`. |
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

Visual resize is the primary resize interaction. The renderer should expose a resize
handle, main should resize the BrowserWindow, and the sprite should scale to fit inside
the current transparent window without clipping. The app should persist bounds at resize
end. CLI resize is secondary and should follow the same ownership rule.

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

---

## Testing Expectations

CLI changes should include focused tests or smoke checks for:

- `--help` output for changed commands.
- Non-TTY/plain output behavior when styling is disabled or unsupported.
- Styled output behavior when styling is supported.
- Expected error output and exit codes.
- `buddy hatch` progress output without raw subprocess dumps in normal mode.
- Pet discovery from buddy-managed, packaged, and Codex-compatible directories.
- Invalid pet folder handling.
- Built CLI smoke tests through `node out/cli/index.js --help` after packaging changes.
- Installed-package smoke tests should install the packed tarball with production
  dependencies only and verify that `require.resolve("electron", { paths: [packageRoot] })`
  succeeds for the installed package.
