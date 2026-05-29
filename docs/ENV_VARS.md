# ENV_VARS.md — Environment Variable Reference

This is the single source of truth for all environment variable and secret configuration.
If any other doc mentions a variable, it should link here rather than restate it.

> **Security rules:**
> - Never commit secret values to source control.
> - `.env` files containing secrets must be in `.gitignore`.
> - `VITE_*` vars are browser-visible — never put secrets in them.
> - Rotate any secret that may have been committed; update all affected environments immediately.
> - buddy is a local desktop app with no cloud deployment dashboard. All variables are optional overrides — the app runs with safe built-in defaults if none are set.

---

## Variable Matrix

All variables are optional. The app ships with safe defaults for every variable. Set them only when you need to override the default behavior (e.g., during development or to relocate assets).

| Variable | Required | Default | Description | Where set |
|---|---|---|---|---|
| `BUDDY_PORT` | No | `7777` | Port for the local HTTP hook sidecar. petdex-bridge and any Windows hook must POST to this same port. | `.env` (dev) or Electron app config |
| `BUDDY_DATA_DIR` | No | `%USERPROFILE%\.petdex-win` on Windows, `$HOME/.petdex-win` in WSL | Override the buddy-owned data root for state, runtime token, and buddy-managed pets. Prefer a WSL symlink/copy to the Windows-owned directory; use this only when a symlink is not practical. | `.env` (dev), Windows shell, or WSL shell |
| `BUDDY_TOKEN` | No | _(unset)_ | Token override for `petdex-bridge`; when unset, the bridge reads `$HOME/.petdex-win/runtime/update-token`. Use only for debugging or temporary WSL token sharing. | WSL shell |
| `BUDDY_SPRITES_DIR` | No | `<BUDDY_DATA_DIR>\pets` | Override only the buddy-managed pet asset directory. buddy also checks packaged pets and `%USERPROFILE%\.codex\pets` as read-only sources. | `.env` (dev) or app settings UI |
| `BUDDY_LOG_LEVEL` | No | `info` | Log verbosity for the Electron main process. Accepted values: `debug`, `info`, `warn`, `error`. | `.env` (dev) or Electron app config |
| `BUDDY_CODEX_COMMAND` | No | `codex` | Command used by `buddy hatch` to invoke Codex CLI for hatch-pet `$imagegen` work. Override only when Codex is installed under a non-standard command name or path. Paths with spaces should be quoted by the shell. | `.env` (dev) or shell |
| `BUDDY_VERBOSE` | No | _(unset)_ | Set to `1` to enable verbose/debug subprocess output in `buddy hatch` (equivalent to `--verbose` flag or `BUDDY_LOG_LEVEL=debug`). | `.env` (dev) or shell |

---

## Local Development Setup

buddy has no `.env.example` file because all variables are optional overrides with safe production-ready defaults. No variable is required for the app to start.

For development, if you need to override any default:

1. Create a `.env` file in the project root (next to `package.json`).
2. Add only the variables you want to override, for example:
   ```
   BUDDY_PORT=7778
   BUDDY_LOG_LEVEL=debug
   ```
3. The Vite + Electron dev setup (`npm run dev`) loads this file automatically via the Vite config.
4. Never commit `.env` — it is listed in `.gitignore`.
5. The HTTP sidecar host is intentionally not configurable. It always binds `127.0.0.1`.

No `.env.example` is required or maintained. The variable matrix above is the canonical documentation of the full variable surface.

---

## Per-Environment Summary

| Variable | Local dev | Production (packaged) |
|---|---|---|
| `BUDDY_PORT` | Optional — defaults to `7777` | Optional — defaults to `7777` |
| `BUDDY_DATA_DIR` | Optional — defaults to `%USERPROFILE%\.petdex-win` | Optional — defaults to `%USERPROFILE%\.petdex-win` for the Windows app and `$HOME/.petdex-win` for WSL tools |
| `BUDDY_TOKEN` | Optional — only used by `petdex-bridge` | Optional — only used by `petdex-bridge` |
| `BUDDY_SPRITES_DIR` | Optional — defaults to `<BUDDY_DATA_DIR>\pets` | Optional — defaults to `<BUDDY_DATA_DIR>\pets` |
| `BUDDY_LOG_LEVEL` | Optional — recommend `debug` during dev | Optional — defaults to `info` |
| `BUDDY_CODEX_COMMAND` | Optional — defaults to `codex` | Optional — defaults to `codex` |
| `BUDDY_VERBOSE` | Optional — set to `1` to enable verbose subprocess output in `buddy hatch` | Optional — defaults to unset |

`buddy hatch` must not require `ANTHROPIC_API_KEY` or any other buddy-owned image provider secret. Image generation is delegated to Codex CLI, which uses its own configured authentication and `$imagegen` route. Before starting a hatch run, buddy checks the configured Codex command with `--version` and `doctor --summary --ascii`; failures should be fixed with `codex login`, `codex doctor`, or by setting `BUDDY_CODEX_COMMAND`.

For WSL hook support, `petdex-bridge` reads the same `BUDDY_PORT` value as the Windows app
and resolves the token from `BUDDY_TOKEN` first, then
`$HOME/.petdex-win/runtime/update-token` unless `BUDDY_DATA_DIR` points at another
`.petdex-win` root. Prefer the token file for normal hook use. The supported WSL setup is
to make `$HOME/.petdex-win` a symlink to the Windows-owned `%USERPROFILE%\.petdex-win`
directory, or to copy the `runtime/update-token` file into the WSL directory after
starting buddy on Windows. Set `BUDDY_DATA_DIR=/mnt/c/Users/<you>/.petdex-win` only when
that path bridge is clearer than a symlink.
