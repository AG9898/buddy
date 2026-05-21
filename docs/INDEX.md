# Documentation Index

Canonical navigation map for this repository's documentation.

This is the single source of truth for doc locations. When adding, removing, renaming, or
moving any file under `docs/`, update this file in the same commit.

---

## Core Docs (`docs/`)

| Path | Purpose |
|---|---|
| [`docs/INDEX.md`](INDEX.md) | This file — documentation navigation map |
| [`docs/PRD.md`](PRD.md) | Product requirements, scope, users, and success criteria |
| [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | System topology, runtime boundaries, and component responsibilities |
| [`docs/CONVENTIONS.md`](CONVENTIONS.md) | Coding standards, naming rules, and idiomatic patterns |
| [`docs/DECISIONS.md`](DECISIONS.md) | Architectural decision log (open and resolved) |
| [`docs/ENV_VARS.md`](ENV_VARS.md) | Canonical environment variable and secret matrix |
| [`docs/TESTING.md`](TESTING.md) | Test strategy, how to run, file inventory, and writing new tests |
| [`docs/workboard.json`](workboard.json) | Active task queue (canonical board) |
| [`docs/workboard.schema.json`](workboard.schema.json) | JSON Schema contract for workboard structure and required task fields |
| [`docs/workboard.md`](workboard.md) | Workboard semantics, field definitions, and agent usage rules |

<!-- TODO: Add project-specific docs below as needed. Examples:
| [`docs/SCHEMA.md`](SCHEMA.md) | Database schema and migration history |
| [`docs/API.md`](API.md) | API endpoint contracts |
| [`docs/STYLE_GUIDE.md`](STYLE_GUIDE.md) | UI style system and design direction |
| [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) | Deployment runbook |
-->

---

## Maintenance Rules

- When adding a doc: add its row to the correct section in the same commit.
- When removing a doc: remove its row and update every doc that linked to it.
- When renaming or moving a doc: update its row and all inbound links in the same commit.
- `AGENTS.md` (root) and any section `README.md` files must be updated in the same commit
  when the docs they reference change.
- Never add a root-level stub doc that only redirects to a path inside `docs/`.
