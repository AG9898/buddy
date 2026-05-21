# Workboard Contract

Canonical active queue data lives in [`docs/workboard.json`](workboard.json).
Canonical machine schema lives in [`docs/workboard.schema.json`](workboard.schema.json).

All agents and automation that read or write workboard tasks must follow this contract.

---

## Enforcement

Minimum required check (used by `query-workboard` and `start-task`):

```bash
jq -e '.tasks and (.tasks | type == "array")' docs/workboard.json >/dev/null
```

Full schema validation (recommended before commit):

```bash
npx --yes ajv-cli validate -s docs/workboard.schema.json -d docs/workboard.json
```

If `ajv-cli` is unavailable, install a validator and validate against
`docs/workboard.schema.json` before changing task structure.

---

## Top-Level Shape

`docs/workboard.json` object:

- `$schema` (string): relative path to schema file. Keep as `./workboard.schema.json`.
- `schema_version` (string): semantic version for this document contract.
- `last_updated` (string, `YYYY-MM-DD`): date of last board edit.
- `tasks` (array): list of active tasks.

---

## Task Schema

Each `tasks[]` item:

- `id` (string): stable task identifier, uppercase token (`ENGINE_001`, `DOCS-02`).
- `title` (string): short human-readable summary.
- `description` (string): concrete implementation intent and boundaries.
- `status` (enum): one of `todo`, `in_progress`, `done`, `blocked`.
- `priority` (enum): one of `critical`, `high`, `medium`, `low`.
- `group_id` (string): workload lane/category (`DOCS`, `INFRA`, `ENGINE`, etc.).
- `depends_on` (string[]): task IDs that must be `done` first.
- `blocked_by` (string[]): explicit blockers (tickets, decisions, incidents, missing access).
- `acceptance_criteria` (string[]): objective completion checks.
- `docs` (string[]): documentation files to read/update for this task.
- `files` (string[]): code files/directories expected to be touched or reviewed.
- `commands` (string[]): preferred validation commands to run before marking `done`.

---

## Agent Usage Rules

- Use `query-workboard` for selection and inspection; do not dump the full board by default.
- Startable task conditions:
  - `status == "todo"`
  - `blocked_by` is empty
  - every task in `depends_on` has `status == "done"`
- `start-task` edits only one task per run.
- Status lifecycle: `todo -> in_progress -> done`.
- If blocked mid-task and unresolved, revert `in_progress -> todo` and set `blocked_by`.
- Never bulk-rewrite the board; use targeted edits scoped to the active task.
- Keep `last_updated` current whenever `docs/workboard.json` changes.

