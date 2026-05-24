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

# Run a single test file
npm test -- src/renderer/PetSprite.test.ts

# Run with coverage
npm run test:coverage

# Run Rust unit tests
cd petdex-bridge && cargo test

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

---

## What Is Covered

**Svelte unit tests:** PetSprite animation state machine (frame sequencing, state
transitions, `once` + `fallback` logic), pointer interactivity detection logic, App
component IPC event handling.

**Rust unit tests:** petdex-bridge CLI arg parsing, HTTP payload construction, token file
reading, exit codes on connection failure.

**Electron E2E:** Window appears at startup, pet state changes via HTTP POST animate
correctly, state persists across restart, tray Show/Hide/Quit work.

**CLI tests:** Command help and changed command behavior, non-TTY/plain output, styled
output when supported, expected error messages and exit codes, hatch progress output that
does not dump raw subprocess logs, and pet discovery/selection behavior.

**Not covered (yet):** Visual regression, multi-monitor DPI scaling, packaged installer
smoke test, Windows-native hook execution.

---

## Test File Inventory

*(No test files yet — fill in as the suite grows.)*

| File | Domain | What It Covers |
|---|---|---|
| `src/main/state-store.test.ts` | State persistence | loadState defaults, saveState directory creation, round-trip fidelity, saveBounds byResolution key |
| `src/cli/env.test.ts` | CLI environment | isWSL() detection, buddyPort() defaults and overrides, sidecarBaseUrl() |
| `src/main/hooks-install.test.ts` | Hook installation | installHooks idempotency, getHooksStatus, Claude Code and Codex CLI targets |
| `src/cli/output.test.ts` | CLI output layer | status/success/warn/error helpers, NO_COLOR plain mode, check/subCheck/bullet/label, banner text, separator |
| `src/cli/commands/hatch.test.ts` | Hatch command | Normal mode suppresses raw subprocess output, verbose flag/env shows subprocess detail, skill-missing error, incomplete packaging error, success summary with pet id and next-step hint |

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
- Hatch workflow tests should verify normal output is summarized and verbose/debug output
  is opt-in.
- Pet discovery tests should cover buddy-managed pets, Codex-compatible pets, invalid
  folders, and selected pet persistence.
- New public functions in `sidecar.ts` or `state-store.ts` require a Vitest unit test
  before the task is marked done.

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
