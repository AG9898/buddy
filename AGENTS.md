# <Project Name> — Agent Working Guide

<!-- AGENTS.md is the canonical file. CLAUDE.md is a symlink to it.              -->
<!-- To set up after copying this file: ln -sf AGENTS.md CLAUDE.md               -->
<!--                                                                              -->
<!-- This file is a LIVING DOCUMENT — not a static README.                       -->
<!-- Agents update it after every task cycle with new discoveries and constraints.-->
<!-- Engineers seed it at project setup with known pitfalls and architecture.     -->
<!--                                                                              -->
<!-- TODO: Replace every placeholder marked with TODO before committing.          -->
<!-- TODO: Delete comment blocks after filling them in.                           -->

---

## Overview

<!-- TODO: 2–4 sentences. What does this project do? What is the agent's primary -->
<!-- role here? Where is the canonical task queue?                                -->
<!--                                                                              -->
<!-- Example:                                                                     -->
<!-- This is the backend API for the Acme data pipeline. Agents implement        -->
<!-- workboard tasks: features, fixes, schema migrations, and infra changes.     -->
<!-- The canonical task queue is docs/workboard.json.                            -->
<!-- Skills are available at .claude/skills/ (synced from ag.dev).              -->

---

## Quick Start

<!-- TODO: Exact commands to get a working dev environment. No prose.            -->

```bash
# Install dependencies
# TODO: e.g. npm install / pip install -r requirements.txt / cargo build

# Run tests
# TODO: e.g. npm test / pytest / cargo test --workspace

# Start local server
# TODO: e.g. npm run dev / uvicorn app.main:app --reload

# Lint / typecheck
# TODO: e.g. npm run lint / ruff check . / cargo clippy
```

---

## Build & Verification Commands

<!-- TODO: Commands agents must run to verify their changes before marking done. -->
<!-- Mark each as fast (< 10 s) or slow. Agents prefer fast checks.             -->
<!-- Never skip a fast check. Skip slow checks only when the task says so.      -->

| Command | What it checks | Speed |
|---------|---------------|-------|
| <!-- TODO: `npm test` --> | <!-- TODO: unit + integration tests --> | fast |
| <!-- TODO: `npm run lint` --> | <!-- TODO: lint + types --> | fast |
| <!-- TODO: `npm run build` --> | <!-- TODO: production build --> | slow |

---

## Repository Structure

<!-- TODO: Top-level directory map. One line per entry. Be precise.              -->

```
<!-- TODO:
src/           Application source
docs/          Project docs and task queue
  INDEX.md        Documentation navigation map
  PRD.md          Product requirements and scope
  ARCHITECTURE.md System topology and boundaries
  CONVENTIONS.md  Coding standards and patterns
  DECISIONS.md    Architectural decision log
  ENV_VARS.md     Environment variable matrix
  TESTING.md      Test strategy and inventory
  workboard.json  Canonical task queue
  workboard.schema.json JSON Schema for task queue
  workboard.md    Workboard field definitions and usage rules
tests/         Test suite
scripts/       Utility scripts
.claude/       Claude harness config
  skills/      Synced skills (do not edit here — edit source in ag.dev)
-->
```

Docs navigation: [`docs/INDEX.md`](docs/INDEX.md)

---

## Architecture

<!-- TODO: 5–10 bullets summarizing the constraints that matter most for day-to-day   -->
<!-- implementation. Focus on constraints, not descriptions. Keep this section brief — -->
<!-- the deep-dive lives in docs/ARCHITECTURE.md.                                      -->

- <!-- TODO: e.g. "All external I/O goes through the adapter layer in src/adapters/." -->
- <!-- TODO: e.g. "Database schema lives in db/migrations/. Never alter tables directly." -->
- <!-- TODO: e.g. "Public API surface is defined in src/api/schema.ts. Do not break it." -->
- <!-- TODO: e.g. "Auth is handled exclusively in src/middleware/auth.ts." -->
- <!-- TODO: e.g. "Config is read from environment variables only. No hardcoded values." -->

Full topology, component responsibilities, data flow, and deployment targets: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Code Style & Constraints

<!-- TODO: Hard rules for this codebase. Agents follow these unconditionally.         -->
<!-- Keep this section to the most critical never/always rules only.                  -->
<!-- Full conventions, naming rules, and per-stack patterns: docs/CONVENTIONS.md      -->

### Never

- Never commit secrets or credentials.
- Never bulk-rewrite `docs/workboard.json`; use targeted edits only.
- <!-- TODO: e.g. "Never use `any` in TypeScript." -->
- <!-- TODO: e.g. "Never use `console.log` in production paths; use the logger." -->
- <!-- TODO: e.g. "Never mutate shared state outside the store layer." -->

### Always

- Always run the fast verification suite before marking a task done.
- Always update relevant `docs/` files when behavior changes.
- <!-- TODO: e.g. "Always write a test for new public functions." -->
- <!-- TODO: e.g. "Always use the project logger (src/lib/logger.ts), not console." -->

### Patterns

<!-- TODO: 2–4 idiomatic patterns agents should follow.                         -->
<!-- Examples:                                                                   -->
<!-- - Error handling: use Result<T, AppError>, not thrown exceptions.          -->
<!-- - API routes: follow the pattern in src/api/routes/example.ts.            -->
<!-- - DB queries: use the repository pattern in src/db/repositories/.         -->

Full convention guide: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)

---

## Maintaining Docs

Docs must stay current with the code. Update the relevant doc in the **same commit** as
the code change — never defer a doc update to a follow-up task.

| What changed | Doc to update |
|---|---|
| System topology, services, auth, data flow, deployment | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Coding pattern, naming rule, or never/always constraint | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| Env var added, removed, renamed, or changed | [`docs/ENV_VARS.md`](docs/ENV_VARS.md) |
| New architectural question raised | [`docs/DECISIONS.md`](docs/DECISIONS.md) — add OPEN-XX |
| Architectural decision resolved | [`docs/DECISIONS.md`](docs/DECISIONS.md) — move to Resolved |
| Test file added, removed, or pattern changed | [`docs/TESTING.md`](docs/TESTING.md) |
| Product scope, users, or success criteria changed | [`docs/PRD.md`](docs/PRD.md) |
| Any doc added, removed, renamed, or moved | [`docs/INDEX.md`](docs/INDEX.md) — always |
| Constraint or gotcha discovered during a task | This file (`AGENTS.md`) — append to Discoveries |

**Rule:** If a section in `AGENTS.md` summarizes something, and the full doc changes, update
both the summary here and the full doc in the same commit.

---

## Workboard

The canonical task queue is `docs/workboard.json`.
Schema and usage contract: [`docs/workboard.md`](docs/workboard.md).
Machine validation schema: [`docs/workboard.schema.json`](docs/workboard.schema.json).

Use the `/query-workboard` skill to inspect it. Use the `/start-task` skill to execute
a task end-to-end. Never dump the full board into context — use targeted `jq` queries.

A task is startable when:
- `status == "todo"`
- `blocked_by` is empty or missing
- all `depends_on` tasks have `status == "done"`

Targeted edit rules:
- Never rewrite the full `workboard.json`.
- Only update the status fields of the task currently being worked.
- Roll back `in_progress → todo` if blocked mid-task and unresolved.

<!-- TODO: Note any project-specific workboard conventions here.                -->
<!-- e.g. "Group IDs in this project: ENGINE, MODEL, INFRA, FOUND."            -->
<!-- e.g. "Critical tasks in the INFRA group are never skipped mid-sprint."    -->

---

## Agent Workflow

Standard task cycle for this project:

1. Read this file (`AGENTS.md` / `CLAUDE.md`) at the start of every session.
2. Run `{{CMD_PREFIX}}query-workboard` to find the next startable task.
3. Run `{{CMD_PREFIX}}start-task` to execute it (reads docs, implements, verifies, updates board).
4. Update this file if you discovered a constraint, pattern, or pitfall worth encoding.
5. Commit changes. Summarize: what was done, what was skipped, what is next.

For multi-task runs: `{{CMD_PREFIX}}ralphloop start-task iterations:N`.

<!-- NOTE: {{CMD_PREFIX}} is rendered by sync-skills.sh: → `/` for Claude, `$` for Codex. -->
<!-- Skills are sourced from ag.dev and synced into .claude/skills/ or .agents/skills/.   -->

### Stopping Conditions

Stop and report (do not continue) when:
- No startable task exists (all are blocked or done).
- A verification command fails and the fix is not obvious.
- An irreversible action (migration, destructive write, external publish) is required
  and the task does not explicitly authorize it.
- <!-- TODO: Add project-specific stop conditions. -->

---

## Debugging & Gotchas

<!-- TODO: Known traps, environment quirks, or non-obvious behaviors.           -->
<!-- This section grows over time as agents discover issues.                    -->
<!-- Examples:                                                                   -->
<!-- - "The test suite requires a local Postgres instance on port 5432.         -->
<!--    Run `docker compose up -d db` before running tests."                    -->
<!-- - "The linter is strict about import order. Run `npm run lint:fix`         -->
<!--    to auto-fix before committing."                                          -->
<!-- - "Migration files must be named YYYYMMDD_NNN_description.sql or the      -->
<!--    runner will silently skip them."                                         -->

---

## Environment Variables

<!-- TODO: List any variable whose name agents need to know to run the project locally. -->
<!-- Do not put secret values here. Full matrix with ownership and defaults:            -->

See [`docs/ENV_VARS.md`](docs/ENV_VARS.md) for the canonical variable and secret matrix.

---

## Testing

<!-- TODO: Fast check agents must run before marking any task done.             -->

Full test strategy, file inventory, and patterns for writing new tests: [`docs/TESTING.md`](docs/TESTING.md)

---

## Deployment

<!-- TODO: How to deploy — or confirm it is CI-only and agents must not deploy. -->
<!-- If agents should never deploy, say so explicitly.                          -->
<!--                                                                            -->
<!-- Example (CI-only):                                                         -->
<!-- Deployments are CI-only. Never manually push to production.               -->
<!-- Staging deploys automatically on merge to `main`.                         -->
<!-- Production requires a tagged release via the GitHub release workflow.     -->

---

## Living Document

This file is a running notebook of agent discoveries. After each task cycle, update
this file if you found:

- A constraint that would have saved time if it were written here.
- A debugging tip that resolves a non-obvious failure.
- A pattern that should be followed for consistency.
- A "never do X" rule that emerged from a near-miss.

Append under `## Discoveries` below. Keep each entry to 2–3 sentences with a date.
Do not reorganize or rewrite existing entries — append only.

```
### YYYY-MM-DD — <short title>
<What you found and why future agents working here should know it.>
```

---

## Discoveries

<!-- Agents: append new discoveries here after each task cycle.                 -->
<!-- Engineers: seed this section with known pitfalls at project setup time.    -->
