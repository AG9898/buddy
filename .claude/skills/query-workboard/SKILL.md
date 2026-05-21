---
name: query-workboard
description: Query `docs/workboard.json` for actionable tasks without dumping the full board. Use for task selection, dependency checks, and targeted task inspection.
version: 1.0.0
---

# Query Workboard

Use this skill when the active queue is `docs/workboard.json`.

## Core Rules

1. Treat `docs/workboard.json` `tasks[]` as canonical active work.
2. Prefer targeted `jq` queries; do not print unrelated board data.
3. A task is startable only if:
   - `status == "todo"`
   - `blocked_by` is empty (or missing)
   - all `depends_on` tasks are `done`
4. Do not read archive/progress logs unless explicitly requested.

## Validation

Before query operations, confirm board shape:

```bash
jq -e '.tasks and (.tasks | type == "array")' docs/workboard.json >/dev/null
```

If invalid, report and stop.

## Query Patterns

### Next startable task

```bash
jq '
  (.tasks | map({(.id): .}) | add) as $byId |
  [.tasks[] |
    select(.status == "todo") |
    select((.blocked_by // []) | length == 0) |
    select((.depends_on // []) | map($byId[.].status == "done") | all)
  ] |
  sort_by(if .priority == "critical" then 0 elif .priority == "high" then 1 elif .priority == "medium" then 2 else 3 end) |
  .[0] | {id, title, priority, group_id, depends_on, blocked_by}
' docs/workboard.json
```

### Exact task by id

```bash
jq '.tasks[] | select(.id == "TASK-ID")' docs/workboard.json
```

### Blocked/not-startable todo tasks

```bash
jq '
  (.tasks | map({(.id): .}) | add) as $byId |
  [.tasks[] |
    select(.status == "todo") |
    {
      id,
      title,
      priority,
      blocked_by: (.blocked_by // []),
      unmet_deps: ((.depends_on // []) | map(select($byId[.].status != "done")))
    } |
    select((.blocked_by | length > 0) or (.unmet_deps | length > 0))
  ] |
  sort_by(if .priority == "critical" then 0 elif .priority == "high" then 1 elif .priority == "medium" then 2 else 3 end)
' docs/workboard.json
```

### Group summary

```bash
jq '
  [.tasks[] |
    select(.group_id == "GROUP") |
    {id, title, status, priority, depends_on, blocked_by}
  ]
' docs/workboard.json
```

## Output Discipline

- For list requests: return compact summaries.
- Return full task JSON only when user asks for a specific task or execution is starting.
- If no startable task exists: return top blocked items and why.

## Guardrails

- Never mutate the board in this skill.
- Never assume `status == "blocked"` is required to identify blocked work.
- Never start work from this skill unless user explicitly asks to execute (handoff to `/start-task`).

