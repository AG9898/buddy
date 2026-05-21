# CONVENTIONS.md — Code Style and Patterns

> Normative guide for all code in this project.
> Read before writing any new file.
> This is not a log — it always reflects the current standard.
> When a new pattern is established during implementation, update this file, not a task note.

---

## Universal Rules

These apply across every stack in this project.

- **No secrets in source.** All credentials and tokens come from environment variables only.
  See [`ENV_VARS.md`](ENV_VARS.md) for the canonical variable matrix.
- **No PII in logs.** Never log participant identifiers, names, or other direct identifiers.
- **No business logic in route handlers.** Route handlers call service functions; service
  functions call domain modules or data helpers.
- **No orphaned code.** Dead code is removed — not commented out, not wrapped in a flag.
- <!-- TODO: Add universal rules specific to this project. -->

---

## <!-- TODO: Stack 1 — e.g. "Frontend (TypeScript / React / Next.js)" -->

### Language and Types

<!-- TODO: Type strictness, lint rules, and disallowed constructs.

Examples:
- TypeScript strict mode is enabled — no `any`; prefer `unknown` + type narrowing.
- All exported functions must have explicit return types.
- Prefer named exports over default exports for non-page modules.
- `console.log` is banned in production paths — use the project logger.
-->

### Module and File Organization

<!-- TODO: Where do specific types of files go?

Examples:
- Components: `src/components/<domain>/<ComponentName>.tsx`
- Services (API wrappers): `src/services/<domain>.ts`
- Route Handlers: `src/app/api/<path>/route.ts`
- Tests: collocated as `<name>.test.ts` or grouped in `src/__tests__/`
- Shared helpers: `src/lib/<concern>.ts`
-->

### Naming Conventions

<!-- TODO: Variable, function, file, and component naming rules.

Examples:
- React components: PascalCase (`SessionCard.tsx`)
- Utility functions and hooks: camelCase (`useSessionState`)
- Constants: UPPER_SNAKE_CASE
- Filenames: kebab-case for utilities (`route-handler-auth.ts`), PascalCase for components
- Route segments: kebab-case (`/new-session`)
-->

### Patterns

<!-- TODO: 2–4 idiomatic patterns this stack must follow.

Examples:
- API calls go through typed service wrappers — never raw `fetch` inside components.
- Route Handlers share a server-only helper layer for auth, caching, and timeout fetches.
  Do not re-inline those concerns per handler.
- State management uses [Zustand / Redux / React Context — pick one and document it here].
- All same-origin Route Handlers export `maxDuration` to match the backend timeout window.
-->

---

## <!-- TODO: Stack 2 — e.g. "Backend (Python / FastAPI)" -->

### Module Structure

<!-- TODO: How routers, services, and schemas are organized.

Examples:
- One router file per domain: `participants.py`, `sessions.py`, `scoring.py`
- Register all routers in `main.py` with explicit prefixes
- Schemas in `app/schemas/`, one file per domain, grouping `*Create` / `*Response` / `*Update`
- Services in `app/services/`, one file per domain
- Domain constants in `app/config.py` — never hardcode them in routers or services
-->

### Types and Validation

<!-- TODO: Type strictness and validation rules.

Examples:
- All path functions and Pydantic models must be fully typed.
- Request bodies: `...Create` schema. Responses: `...Response` schema.
- Never return SQLAlchemy ORM objects from endpoints — always serialize to `...Response`.
- Enums for fixed-vocabulary fields (status, role, category).
-->

### Scoring / Pure Modules

<!-- TODO: If the project has pure computation modules, define their contract here.

Example:
- One file per instrument in `app/scoring/`: `digitspan.py`, `uls8.py`, etc.
- Each file exposes exactly one public function: `score(raw: ...) -> ScoredResult`
- Scoring functions are pure — no DB calls, no side effects, testable in isolation.
-->

### Auth

<!-- TODO: How auth dependencies are structured in route handlers.

Example:
- `Depends(get_current_lab_member)` on all RA-only endpoints.
- `Depends(get_current_admin)` on admin-only endpoints.
- Participant endpoints: validate `session_id` existence + `status == "active"` before accepting data.
- All Supabase Auth SDK calls isolated in `app/auth.py`.
-->

### DB Access

<!-- TODO: Rules for DB interactions.

Example:
- Alembic for all schema changes. Always review generated migration before committing.
- `DATABASE_URL` from environment only — never hardcode connection strings.
- FK constraints enforced at DB level, not just application level.
- All tables get `created_at TIMESTAMPTZ DEFAULT NOW()`.
- UUIDs generated server-side: `uuid.uuid4()`. Never trust client-generated IDs.
-->

---

## Database

<!-- TODO: Cross-stack DB rules.

Examples:
- Migrations only — never ALTER TABLE or DROP COLUMN directly.
- All schema changes go through the migration tool (Alembic / Flyway / Prisma migrate).
- FK constraints enforced at the DB level.
- All tables have a `created_at` timestamp column with server-side default.
-->

---

## Testing

<!-- TODO: Reference TESTING.md rather than restating its conventions here.
Add only the rules that affect how code is written (not how tests are run).

Examples:
- Every new public service function requires a unit test.
- Scoring tests are pure input/output — no mocks required.
- Any route change touching auth must include an assertion in the route-topology test.
-->

Full testing guide: [`TESTING.md`](TESTING.md)

---

## Never

Hard rules. Agents follow these unconditionally.

- Never commit secrets or credentials to source control.
- Never bulk-rewrite `docs/workboard.json` — use targeted edits only.
- Never bypass or weaken the auth middleware on protected routes.
- Never use `any` (TypeScript) or untyped function signatures (Python) in new code.
- <!-- TODO: Add project-specific never rules. -->

## Always

- Always run the fast verification suite before marking a task done.
- Always update `docs/` files when public behavior, interfaces, or invariants change.
- Always use the project logger — not `console.log` / `print` — in production paths.
- <!-- TODO: Add project-specific always rules. -->
