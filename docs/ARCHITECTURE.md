# Architecture

<!-- TODO: Replace <Project Name> in the parent AGENTS.md header, not here.       -->

> Canonical source for system topology, runtime boundaries, and component responsibilities.
> Other docs should link here rather than restating architecture details.

---

## Overview

<!-- TODO: 2–4 sentences describing what the system is and its primary tiers or services. -->

---

## System Topology

<!-- TODO: Describe the services/tiers and where they run. Pick the shape that fits.

Single-service example:
- **API** (<!-- TODO: host e.g. Railway / Fly.io -->): <!-- TODO: e.g. FastAPI, Node.js -->
- **Database** (<!-- TODO: host -->): <!-- TODO: e.g. Postgres via Supabase -->

Three-tier web app example:
- **Frontend** (<!-- TODO: e.g. Vercel -->): <!-- TODO: e.g. Next.js (TypeScript + Tailwind) + same-origin Route Handlers -->
- **Backend** (<!-- TODO: e.g. Railway -->): <!-- TODO: e.g. FastAPI — all business logic, validation, and DB writes -->
- **Database** (<!-- TODO: e.g. Supabase -->): <!-- TODO: e.g. Managed Postgres -->
- **Cache** (optional): <!-- TODO: e.g. Upstash Redis via Vercel KV integration -->
- **Auth** (optional): <!-- TODO: e.g. Supabase Auth — JWTs validated by backend JWKS -->
-->

---

## Component Responsibilities

<!-- TODO: One section per major component. Describe what it owns and what it explicitly does NOT do.

Example:
### Frontend
- Renders UI and handles client-side state.
- Calls backend through same-origin Route Handlers (no direct browser-to-backend calls).
- No business logic, no direct DB access.

### Backend
- All business logic, scoring, validation, and DB writes.
- Validates JWTs on every protected route.
- No direct client-facing endpoints — accessed only through same-origin Route Handlers.

### Database
- Managed Postgres. Schema changes via migrations only — never ALTER TABLE directly.
- All tables have `created_at TIMESTAMPTZ DEFAULT NOW()`.
-->

---

## Data Flow

<!-- TODO: Describe how a request or data record moves through the system.
A simple diagram or ordered list works well here.

Example (read request):
1. Browser hits Vercel Route Handler.
2. Route Handler validates JWT (JWKS primary, HS256 fallback).
3. Route Handler checks Redis cache; on miss, calls backend.
4. Backend executes DB query, returns typed response.
5. Route Handler writes result to cache and returns to browser.

Example (write request):
1. Browser POSTs to Vercel Route Handler.
2. Route Handler validates JWT, forwards to backend.
3. Backend validates payload, runs business logic, writes to DB.
4. Backend returns typed response; Route Handler passes through.
-->

---

## Auth

<!-- TODO: Describe the auth model. Answer: who needs auth? how are credentials issued?
how are they verified? what happens on failure?

Example:
- **RA routes** (`/dashboard`, `/new-session`, `/import-export`): require Supabase JWT.
  - Primary gate: Next.js edge middleware (`src/middleware.ts`), runs before any page render.
  - Secondary guard: `(ra)` layout client guard, handles mid-session sign-outs.
- **Backend**: validates JWTs via JWKS (ES256 primary, HS256 fallback when `SUPABASE_JWT_SECRET` set).
- **Participant routes**: unauthenticated. Validated by `session_id` existence + `status == "active"`.
- **Role scoping**: `role` and `lab_name` stored in Supabase `app_metadata` (admin-only writable).
-->

---

## External Dependencies

<!-- TODO: List all external services this system depends on.
Mark each as Required or Optional (with graceful degradation behavior if optional).

| Service | Purpose | Required / Optional |
|---|---|---|
| <!-- TODO: e.g. Supabase --> | <!-- TODO: e.g. Managed Postgres + Auth --> | <!-- TODO: Required --> |
| <!-- TODO: e.g. Upstash Redis --> | <!-- TODO: e.g. Route Handler cache (dashboard, weather) --> | <!-- TODO: Optional — degrades to live-only reads --> |
| <!-- TODO: e.g. GitHub Actions --> | <!-- TODO: e.g. Scheduled data ingestion jobs --> | <!-- TODO: Required (production) --> |
-->

---

## Deployment Targets

<!-- TODO: One row per environment. Replace the placeholder cells with actual values.
Example rows:
  Production  | Vercel (main branch)   | Railway          | Supabase ca-central-1
  Staging     | Vercel (staging branch)| Railway (staging)| Supabase (staging project)
  Local dev   | localhost:3000         | localhost:8000   | Docker Compose postgres
-->

| Environment | Frontend | Backend | Database |
|---|---|---|---|
| Production | TODO | TODO | TODO |
| Staging | TODO | TODO | TODO |
| Local dev | `localhost:3000` | `localhost:8000` | TODO |

See [`ENV_VARS.md`](ENV_VARS.md) for the canonical variable and secret matrix per environment.

---

## Constraints

<!-- TODO: Hard architectural rules agents must never violate. 5–10 bullets.
These are the invariants that protect the system's integrity.

Examples:
- Never bypass the auth middleware on protected routes — the middleware is the security boundary.
- All external API calls go through the service layer — never inline in route handlers.
- Schema changes use migrations only — never ALTER TABLE or DROP COLUMN directly.
- Secrets are read from environment variables only — no hardcoded values anywhere.
- No business logic in route handlers — delegate to service functions.
- UUIDs are generated server-side only — never trust client-generated IDs.
- No PII stored — participants are identified by UUID and session ID only.
-->
