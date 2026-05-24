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
| `BUDDY_HOST` | No | `127.0.0.1` | Bind address for the HTTP sidecar. **Never set to `0.0.0.0`** — loopback only to prevent exposure to other machines on the network. | `.env` (dev) only |
| `BUDDY_SPRITES_DIR` | No | `%USERPROFILE%\.petdex-win\pets` | Override directory for sprite/pet asset files. buddy also checks `%USERPROFILE%\.codex\pets` as a fallback. | `.env` (dev) or app settings UI |
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
5. `BUDDY_HOST` should only ever appear in a local `.env` for testing alternative bind addresses. It must never be set to anything other than `127.0.0.1` in any environment.

No `.env.example` is required or maintained. The variable matrix above is the canonical documentation of the full variable surface.

---

## Per-Environment Summary

| Variable | Local dev | Production (packaged) |
|---|---|---|
| `BUDDY_PORT` | Optional — defaults to `7777` | Optional — defaults to `7777` |
| `BUDDY_HOST` | Optional — defaults to `127.0.0.1` | Optional — defaults to `127.0.0.1` (do not override) |
| `BUDDY_SPRITES_DIR` | Optional — defaults to `%USERPROFILE%\.petdex-win\pets` | Optional — defaults to `%USERPROFILE%\.petdex-win\pets` |
| `BUDDY_LOG_LEVEL` | Optional — recommend `debug` during dev | Optional — defaults to `info` |
| `BUDDY_CODEX_COMMAND` | Optional — defaults to `codex` | Optional — defaults to `codex` |
| `BUDDY_VERBOSE` | Optional — set to `1` to enable verbose subprocess output in `buddy hatch` | Optional — defaults to unset |

`buddy hatch` must not require `ANTHROPIC_API_KEY` or any other buddy-owned image provider secret. Image generation is delegated to Codex CLI, which uses its own configured authentication and `$imagegen` route. Before starting a hatch run, buddy checks the configured Codex command with `--version` and `doctor --summary --ascii`; failures should be fixed with `codex login`, `codex doctor`, or by setting `BUDDY_CODEX_COMMAND`.
