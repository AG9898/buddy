# TESTING.md — Test Suite Reference

> Canonical source for how to run tests, what is covered, and how to write new tests.
> Read before adding any new test file or modifying an existing one.
> Code conventions that affect test structure live in [`CONVENTIONS.md`](CONVENTIONS.md).
> CLI behavior and terminal UX expectations live in [`CLI.md`](CLI.md).

---

## Quick Start

```bash
# Run all Svelte/TS unit tests
npm test

# Build Electron bundles and the package CLI target
npm run build:app

# Build and inspect the npm release tarball contents
npm pack --dry-run

# Smoke-test the packed package as an installed dependency
npm pack
npm install --omit=dev --prefix <temp-dir> ./ag9898-buddy-<version>.tgz

# Run a single test file
npm test -- src/renderer/PetSprite.test.ts

# Run with coverage
npm run test:coverage

# Run Rust unit tests
cd petdex-bridge && cargo test

# Lint the WSL bridge
cd petdex-bridge && cargo clippy -- -D warnings

# Run Electron E2E tests (requires Windows, launches Electron)
npm run test:e2e
```

PowerShell on locked-down Windows machines may block `npm.ps1` through execution
policy. In PowerShell, use the `.cmd` shim for npm commands:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build:app
```

---

## Test Stacks

| Stack | Tool | Version | Location | Run Command |
|---|---|---|---|---|
| Svelte/TS unit | Vitest | latest | `src/**/*.test.ts` | `npm test` |
| Rust unit | cargo test | (project Rust version) | `petdex-bridge/src/**` | `cd petdex-bridge && cargo test` |
| Electron E2E | Playwright + electron-playwright-helpers | latest | `tests/e2e/` | `npm run test:e2e` |

---

## Windows Build Notes

### Locked-down machines (no Administrator rights / no Developer Mode)

`npm run build` will fail with a symlink-privilege error during the `electron-builder` step because `winCodeSign` extracts archives that contain symlinks, which require either Administrator rights or Windows Developer Mode to create.

Use the local build script instead:

```powershell
npm run build:win:local
```

This runs `electron-vite build && electron-builder --win --config.win.signAndEditExecutable=false --publish never`, bypassing the code-signing helper. It produces a working `dist\buddy Setup 0.1.0.exe` but without signed executables or customized executable metadata. **Do not use this for release builds** — those must run on CI or a machine with symlink privileges.

Full local smoke-test sequence for a locked-down machine:

```powershell
npm install
npm.cmd test
npm.cmd run lint
npm.cmd run build:app
npm.cmd run build:win:local
```

`npm run build:app` must emit `out/cli/index.js` as well as the Electron main,
preload, and renderer bundles. For CLI packaging changes, smoke-test the generated
entry point with `node out/cli/index.js --help` and command-specific help such as
`node out/cli/index.js hatch --help`.

## Release Smoke Matrix

Before publishing `@ag9898/buddy`, verify the release candidate on a clean Windows machine and
one WSL distribution:

| Area | Check |
|---|---|
| npm package | `npm pack --dry-run` contains only intended runtime/docs assets and excludes agent skill folders and source-only working files. |
| install | `npm install -g @ag9898/buddy` installs the `buddy` command and the npm-managed Electron runtime dependency used by `buddy start`. |
| launch | `buddy start` launches the Windows Electron app and returns control to the terminal. |
| rendering | The default packaged pet renders, animates, drags, resizes visually, and survives restart. |
| selected pets | `buddy pets list`, `buddy pets use <id>`, restart, main-process active-pet fallback diagnostics, and selected-pet render are verified from Windows; WSL path-sharing behavior is verified separately. |
| state endpoint | `buddy state running` and authenticated `POST /state` visibly change pet state. |
| hooks | Claude Code and Codex CLI hooks are installed and trigger visible state changes from Windows and WSL. |
| WSL bridge | `petdex-bridge state running` in WSL reads the token through `$HOME/.petdex-win` symlink/copy or `BUDDY_DATA_DIR`, reaches `127.0.0.1:${BUDDY_PORT}`, and returns useful errors when the app is stopped. |
| packaging | `npm run build` passes on a release-capable Windows/CI environment; `npm run build:win:local` remains a smoke-only fallback. |

### Dev-Machine Smoke Results (2026-05-29)

Automated checks run on dev machine (Windows 11, no Developer Mode):

| Command | Result |
|---|---|
| `npm run lint` | PASS |
| `npm test` (128 tests) | PASS (5 pre-existing Windows path failures fixed) |
| `npm run build:app` | PASS — all four bundles emitted |
| `npm pack --dry-run` | PASS — 20 files, no agent skill folders or source-only files |
| `npm run build:win:local` | PASS — produces `dist\buddy Setup 0.1.0.exe` |
| `npm run build` | FAIL (expected) — symlink privilege error (no Developer Mode); use CI or Administrator for release builds |

Visual install/render/hooks/WSL-bridge checks require a separate clean Windows machine; not yet verified.

---

## What Is Covered

**Svelte unit tests:** PetSprite animation state machine (frame sequencing, state
transitions, `once` + `fallback` logic), active-manifest fallback on live reload, pointer
interactivity detection logic (including `.resize-handle` region), resize lifecycle IPC
calls (`resizeStart`/`resizeMove`/`resizeEnd`), and App startup/live-selection IPC handling
with listener cleanup. Svelte component tests run in jsdom through the Svelte Testing
Library Vite plugin; they do not launch Electron.

**Rust unit tests:** petdex-bridge CLI arg parsing, HTTP payload construction, loopback
URL construction, invalid state handling, and invalid port handling. Manual bridge smoke
checks cover missing token and stopped-sidecar error output.

**Electron E2E:** Window appears at startup, pet state changes via HTTP POST animate
correctly, state persists across restart, tray Show/Hide/Quit work.

**Main-process unit tests:** State persistence, active-pet asset resolution and live-selection
persistence, token-authenticated sidecar validation, bounded operational status snapshots, and hook installation/status. Hook tests
cover Claude Code `settings.json`, Codex CLI `hooks.json`, Windows `buddy state` commands,
WSL `petdex-bridge state` commands, idempotency, and missing-hook status.

**CLI tests:** Command help and changed command behavior, non-TTY/plain output, styled
output when supported, expected error messages and exit codes, hatch progress output that
does not dump raw subprocess logs, pet discovery/selection behavior, and runtime path
resolution for installed npm package layouts.

**CLI UX contract coverage:** A testable command factory covers bare `buddy`,
root and nested help, package-derived version output, global output modes, stdout/stderr
separation, stable JSON results, typo/argument errors, and command exit codes. Lifecycle
coverage proves Windows and WSL startup results are not reported before successful launch,
including missing runtime, child errors, and non-zero WSL interop exits. Stop coverage proves
the authenticated graceful route, authorization rejection, already-stopped outcome, Windows and
WSL verified-PID fallback, and output-mode rendering; it must never target an image name.
Status coverage proves the running, stopped, missing-token, and partial-hook paths degrade
without a non-zero exit, that bare `buddy` prints the banner only on an interactive terminal
and shares the `app.status` JSON payload with `buddy status`, and that no token value, token
path, or assistant configuration content reaches human or JSON output. Program tests mock the
status collector so the root surface performs no real sidecar or hook-file I/O.

**Not covered (yet):** Visual regression, multi-monitor DPI scaling, packaged installer
smoke test, Windows-native hook execution, WSL bridge execution, resize pointer-event
integration (requires Electron E2E).

---

## Test File Inventory

| File | Domain | What It Covers |
|---|---|---|
| `src/main/state-store.test.ts` | State persistence | loadState defaults, saveState directory creation, round-trip fidelity, saveBounds byResolution key |
| `src/main/pet-assets.test.ts` | Active pet assets | Selected pet resolution, packaged default fallback diagnostics, persisted startup state, manifest validation, and safe live-selection persistence |
| `src/main/sidecar.test.ts` | Sidecar controls and status | One-time authenticated `POST /shutdown`, authenticated `POST /pets/use` success payload, state persistence, invalid-selection rejection, and authenticated bounded `/status` snapshots for visible/hidden windows, active-pet fallback, and current bounds |
| `src/preload/preload.test.ts` | Preload live-selection IPC | Active-pet and state listener forwarding plus exact listener cleanup |
| `src/renderer/App.test.ts` | Renderer active-pet reload | In-place manifest/spritesheet replacement, renderer-ready sequencing, stale-startup protection, and listener cleanup |
| `src/renderer/PetSprite.test.ts` | Renderer sprite fallback | New-manifest spritesheet replacement and missing-state idle fallback |
| `src/cli/env.test.ts` | CLI environment | isWSL() detection, buddyPort() defaults and overrides, sidecarBaseUrl() |
| `src/shared/buddy-paths.test.ts` | Shared paths | buddy data root defaults, `BUDDY_DATA_DIR` override, and derived state/token/pet paths |
| `src/main/hooks-install.test.ts` | Hook installation | installHooks idempotency, getHooksStatus, Claude Code settings, Codex hooks.json, Windows and WSL command targets |
| `src/cli/output.test.ts` | CLI output layer | status/success/warn/error helpers, NO_COLOR plain mode, check/checkRow pass-warn-fail rows with sub-items/subCheck/bullet/label, banner text, separator, output modes (normal/quiet/verbose/JSON) with stdout+stderr separation, single-payload JSON success and failure rendering, color resolution for TTY/redirected/FORCE_COLOR/`--no-color` |
| `src/cli/commands/hatch.test.ts` | Hatch command | Normal mode suppresses raw subprocess output, verbose flag/env shows subprocess detail, skill-missing error, incomplete packaging error, success summary with pet id and next-step hint |
| `src/cli/pets.test.ts` | Pet discovery | isValidPetJson schema validation, validatePetFolder for valid/missing/invalid entries, discoverPets buddy+codex sources, invalid folder reasons, buddyPetsDir/codexPetsDir path resolution and overrides |
| `src/cli/commands/pets.test.ts` | Pets commands | pets list with source labels and active-pet marker, pets show active pet and unresolved-id warning, pets use validation and state.json persistence, no-writes-to-Codex paths, error messages and exit codes |
| `src/cli/commands/state.test.ts` | State command | Typed state result, POST `/state` payload/token, shared missing-token and HTTP errors, plus normal/verbose/no-color/JSON rendering |
| `src/cli/commands/size.test.ts` | Size command | parseSizeInput scale factor/explicit WxH/invalid input, validateBounds min/max enforcement, typed validation/sidecar errors, POST `/resize` payload/token, bounded shared-client timeout, and quiet/no-color/JSON rendering |
| `src/cli/commands/start.test.ts` | Start command | Typed Windows and WSL startup results, missing Electron runtime, child spawn errors, non-zero WSL interop exits, and shared output-mode rendering |
| `src/cli/commands/stop.test.ts` | Stop command | Authenticated graceful shutdown, authorization rejection, idempotent already-stopped handling, Windows/WSL verified-PID fallback, and normal/quiet/verbose/JSON output |
| `src/cli/commands/doctor.test.ts` | Doctor command | Healthy checklist result, partial hook coverage as a warning row, typed `doctor.checks_failed` failure with the first recovery hint, missing Electron runtime, WSL probe/runtime detection, and normal/quiet/JSON rendering including checks shown before a failure message |
| `src/cli/commands/hooks.test.ts` | Hooks install command | Complete install for both assistants, idempotent re-run, partial per-target coverage as a warning, typed `hooks.install_failed` failure with one JSON payload, WSL runtime and deprecated `--rc` pass-through, and normal/quiet/JSON rendering |
| `src/cli/commands/status.test.ts` | Status command and root overview | Running snapshot with pet/window/hook coverage, stopped and missing-token degradation without leaking the token path, partial-hook per-assistant counts, WSL environment, snapshot validation, normal/quiet/verbose/JSON rendering, and overview suggestions sharing the `app.status` payload |
| `src/cli/program.test.ts` | CLI program structure | Bare invocation recording the `app.status` overview with the banner limited to interactive terminals, `status` registered under diagnostics, `--version` matching package.json, grouped root help with examples, nested `pets`/`hooks install` help, banner suppressed for non-TTY, unknown-command suggestion, missing-argument and unknown-option exit codes, global output options inherited by nested commands in either position, `--quiet`/`--verbose` conflict rejected same-command and split across the chain |
| `src/cli/runtime.test.ts` | CLI runtime launch | package-root walking from built CLI output and missing-Electron detection for installed package layouts |
| `petdex-bridge/src/main.rs` | WSL bridge | CLI parsing, state payload construction, loopback URL construction, token path override, and empty-state validation |

---

## Writing New Tests

### Rules

- Svelte unit tests must not launch Electron — use `vi.mock` for any `petApi` /
  `contextBridge` calls.
- State machine tests are pure input/output — no mocks needed.
- E2E tests run only on Windows — guard with
  `if (process.platform !== 'win32') test.skip(...)` at the top of every E2E file.
- Any change to an IPC channel name must include an updated assertion in the E2E test for
  that channel.
- CLI output changes should assert both human-readable content and expected exit codes.
- CLI entry-point changes should exercise a constructed Commander program directly and the
  built `out/cli/index.js` smoke path; tests must not import an entry module that parses
  `process.argv` at module load.
- Global output-mode tests should cover TTY/plain, `--no-color`, quiet, verbose, and JSON
  behavior. JSON tests must parse stdout and assert that diagnostics did not contaminate it.
- Sidecar command tests should assert returned `CommandResult` values and `CliError` failures;
  do not mock `process.exit`, because only `src/cli/index.ts` owns the exit status.
- Prefer setting `process.exitCode` at the entry boundary over calling `process.exit()` in
  command implementations so expected failures can be tested as returned results.
- Hatch workflow tests should verify normal output is summarized and verbose/debug output
  is opt-in.
- Pet discovery tests should cover buddy-managed pets, packaged pets, Codex-compatible pets,
  invalid folders, and selected pet persistence.
- New public functions in `sidecar.ts` or `state-store.ts` require a Vitest unit test
  before the task is marked done.
- Filesystem path assertions must be built with `path.join`/`path.sep` rather than hardcoded
  separators or drive-letter literals. Production helpers use `path.join`, so an expectation
  such as `'C:\\buddy-data\\pets\\jade-wisp'` passes on Windows but fails on Linux/macOS.
  Derive both the stubbed input and the expected value from the same `path` calls.

### Patterns

**Svelte unit tests:**

```typescript
// Import component with @testing-library/svelte; assert DOM state after dispatching events.
import { render, fireEvent } from '@testing-library/svelte';
import PetSprite from './PetSprite.svelte';

test('transitions to fallback after once animation completes', async () => {
  const { component } = render(PetSprite, { props: { state: 'jumping' } });
  // assert frame sequence and eventual fallback to 'idle'
});
```

**petApi mock:**

```typescript
vi.mock('../preload/preload', () => ({
  petApi: {
    onStateChange: vi.fn(),
    setPointerInteractive: vi.fn(),
    setState: vi.fn(),
    dragStart: vi.fn(),
    dragMove: vi.fn(),
    dragEnd: vi.fn(),
  },
}));
```

**Rust unit tests:**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_state_subcommand() {
        let args = Args::parse_from(["bridge", "state", "running"]);
        assert_eq!(args.subcommand, Subcommand::State { name: "running".into() });
    }

    #[test]
    fn builds_correct_payload() {
        let payload = build_payload("running");
        assert_eq!(payload["state"], "running");
    }
}
```

**Electron E2E:**

```typescript
import { _electron as electron } from 'playwright';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';

test('window appears at startup', async () => {
  const appInfo = parseElectronApp(findLatestBuild());
  const app = await electron.launch({ args: [appInfo.main] });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-avatar-mascot]');
  await app.close();
});

test('state change via HTTP POST updates animation', async () => {
  // launch app, POST to sidecar, assert renderer DOM reflects new state
});
```

### Adding a New Test File

1. Name it `<component>.test.ts` for Svelte/TS, or add a `#[cfg(test)]` module inline for
   Rust.
2. Place it in the same directory as the file it tests (colocated).
3. Add a row to the **Test File Inventory** table above.
4. Run `npm test` (and `cargo test` for Rust) to confirm no regressions before committing.
