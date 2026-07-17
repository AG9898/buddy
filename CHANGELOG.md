# Changelog

All notable changes to buddy are documented in this file.

## 1.0.1 — 2026-07-17

First public npm release of `@ag9898/buddy`.

- Establishes the `@ag9898` package scope while preserving the `buddy` command.

## 1.0.0 — 2026-07-17

Initial GitHub release of buddy.

- Adds the `buddy` global CLI for starting, stopping, configuring, and diagnosing the Windows desktop pet.
- Integrates with Codex CLI and Claude Code through local hook events.
- Includes the transparent Electron overlay, system tray controls, persistent window state, and authenticated loopback sidecar.
- Supports pet discovery, selection, and generation with `buddy pets` and `buddy hatch`.
- Ships the `default` and `penguin` animated pet packs.
- Supports WSL state updates through the optional `petdex-bridge` companion binary.
