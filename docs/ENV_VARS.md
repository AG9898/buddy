# ENV_VARS.md — Environment Variable Reference

This is the single source of truth for all environment variable and secret configuration.
If any other doc mentions a variable, it should link here rather than restate it.

> **Security rules:**
> - Never commit secret values to source control.
> - `.env` files containing secrets must be in `.gitignore`.
> - `NEXT_PUBLIC_*` / `VITE_*` vars are browser-visible — never put secrets in them.
> - Rotate any secret that may have been committed; update all affected environments immediately.
> - Production secrets are set in the deployment dashboard only (Railway / Vercel / CI secrets).

---

## Variable Matrix

<!-- TODO: One row per variable. Fill in all columns accurately.
Required = "Yes" / "Conditional" (needed only when a feature is enabled) / "No" (optional with a default)
Where set = the environment(s) where this var must exist (local .env, Vercel env, Railway, CI secret, etc.)
-->

| Variable | Required | Default | Description | Where set |
|---|---|---|---|---|
| <!-- TODO: `DATABASE_URL` --> | <!-- Yes --> | <!-- None --> | <!-- Postgres connection string (with `ssl=require` for asyncpg) --> | <!-- Backend runtime env (`backend/.env`, Railway) --> |
| <!-- TODO: `ALLOWED_ORIGINS` --> | <!-- Yes (production) --> | <!-- Localhost dev list when unset --> | <!-- Comma-separated CORS allowlist --> | <!-- Backend runtime env (`backend/.env`, Railway) --> |
| <!-- TODO: Add all variables for this project --> | | | | |

---

## Local Development Setup

<!-- TODO: Explain how to set up local environment files for development.

Example:
**Backend:**
1. Copy `backend/.env.example` to `backend/.env`.
2. Fill in all variables marked "Required" or "Conditional" for local dev.
3. Never commit `backend/.env` — it is in `.gitignore`.

**Frontend:**
1. Copy `frontend/.env.example` to `frontend/.env.local`.
2. Fill in `NEXT_PUBLIC_*` vars from the Supabase project settings.
3. Never commit `frontend/.env.local` — it is in `.gitignore`.

If there is no `.env.example`, create one with placeholder values and commit it.
The example file documents the variable surface without exposing secrets.
-->

---

## Per-Environment Summary

<!-- TODO: Show which variables are required per environment.
This helps engineers configure a new environment without missing anything.

| Variable | Local dev | Staging | Production |
|---|---|---|---|
| `DATABASE_URL` | Required | Required | Required |
| `ALLOWED_ORIGINS` | Optional | Required | Required |
| `SUPABASE_JWT_SECRET` | Conditional | Conditional | Conditional |
-->
