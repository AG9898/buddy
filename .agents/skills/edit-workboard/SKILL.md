---
name: edit-workboard
description: Create new workboard tasks and edit existing task fields with targeted JSON patches, including dependency-safe deletion and split-task workflows, without using this skill for task selection or execution.
version: 1.0.0
---

# Edit Workboard

Use this skill to author, modify, and restructure tasks in `docs/workboard.json`.

Use `$edit-workboard` when work needs to create tasks, refine task fields, or split heavy tasks into smaller scoped tasks.

Do not use this skill for selecting the next task, executing tasks, or transitioning `todo -> in_progress -> done`; those belong to `$query-workboard` and `$start-task`.

## Workflow

1. Read the repo instruction dispatcher first (`AGENTS.md`).
2. If the request is task selection, dependency triage, or next-task identification, hand off to `$query-workboard`.
3. If the request is executing a task lifecycle (`todo -> in_progress -> done`), hand off to `$start-task`.
4. For writes, use only targeted task-level or structural patches; never rewrite the entire board.
5. After each write, run the shared write protocol in this skill before reporting completion.

## Command Index

| Command | Operates on |
|---|---|
| `show <ID>` | Print full task JSON |
| `add-task` | Insert a new task |
| `edit-task <ID> <field> <value>` | Set a scalar field (`title`, `description`, `group_id`) |
| `reprioritize <ID> <level>` | Change `priority` |
| `append-to <ID> <field> <value>` | Add one item to an array field |
| `remove-from <ID> <field> <value>` | Remove one item from an array field by exact match |
| `set-array <ID> <field> <json-array>` | Replace an entire array field wholesale |
| `add-dep <ID> <dep-ID>` | Append to `depends_on` (validates dep-ID exists first) |
| `remove-dep <ID> <dep-ID>` | Remove from `depends_on` |
| `set-blocked <ID> <reason>` | Set `blocked_by` + `status = "blocked"` atomically |
| `unblock <ID>` | Clear `blocked_by`, set `status = "todo"` |
| `delete-task <ID>` | Remove a task (refused if `in_progress` or depended upon by another task) |
| `split-task <ID>` | Replace one task with two or more scoped subtasks |

`status` is write-protected in this skill. The only legal status writes are the atomic `set-blocked` and `unblock` operations below. Execution transitions belong to `$start-task`.

`id` is immutable. Renaming an ID silently breaks every `depends_on` reference to it; refuse if asked.

## Shared Write Protocol

Run after every command that writes to the board:

1. Apply the targeted patch using the template for that command; never rewrite the full file.
2. Update `last_updated` in the same jq expression as the patch. Never update it separately.
3. Validate shape:
   ```bash
   jq -e '.tasks and (.tasks | type == "array")' docs/workboard.json >/dev/null
   ```
4. Validate schema:
   ```bash
   npx --yes ajv-cli validate -s docs/workboard.schema.json -d docs/workboard.json
   ```
5. If schema validation fails due to pre-existing invalid records, isolate responsibility by shape-checking `/tmp/wb.json`; report pre-existing noise separately from your edit result.
6. If either validation fails due to your change, stop immediately, report the failure, and do not attempt another write.
7. Print a compact one-line summary of the changed task.

## Commands

### `show <ID>`

Read-only. Run this before any edit to verify current state.

```bash
jq '.tasks[] | select(.id == "TASK-ID")' docs/workboard.json
```

### `add-task`

All 12 required fields must be present. New tasks always start as `todo`. Replace `YYYY-MM-DD` with today's date.

Before writing:

- Confirm the ID is not already taken:
  ```bash
  jq -e --arg id "NEW-ID" '.tasks[] | select(.id == $id)' docs/workboard.json >/dev/null && echo "ID taken"
  ```
- To find the next unused sequence number for a group:
  ```bash
  jq --arg g "GROUP_ID" '[.tasks[] | select(.group_id == $g) | .id] | sort | last' docs/workboard.json
  ```
- Confirm every `depends_on` ID exists in the board using the existence check above for each one.

```bash
jq --argjson task '{
  "id": "GROUP_NNN",
  "title": "...",
  "description": "...",
  "status": "todo",
  "priority": "medium",
  "group_id": "GROUP",
  "depends_on": [],
  "blocked_by": [],
  "acceptance_criteria": ["..."],
  "docs": [],
  "files": [],
  "commands": []
}' \
'.tasks += [$task] | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

### `edit-task <ID> <field> <value>`

Scalar fields only: `title`, `description`, `group_id`.

```bash
jq --arg val "new value" \
'(.tasks[] | select(.id == "TASK-ID")).FIELD_NAME = $val | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

Replace `FIELD_NAME` literally with `title`, `description`, or `group_id`.

### `reprioritize <ID> <level>`

Level must be one of: `critical`, `high`, `medium`, `low`.

```bash
jq --arg level "high" \
'(.tasks[] | select(.id == "TASK-ID")).priority = $level | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

## Array Field Commands

Array fields are `acceptance_criteria`, `docs`, `files`, and `commands`.
(`depends_on` and `blocked_by` use dedicated commands below.)

Use `append-to` and `remove-from` for incremental changes. Use `set-array` only when replacing the whole array is intentional; run `show <ID>` first so the current value is visible.

### `append-to <ID> <field> <value>`

```bash
jq --arg val "new item" \
'(.tasks[] | select(.id == "TASK-ID")).FIELD_NAME += [$val] | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

### `remove-from <ID> <field> <value>`

Removes by exact string match. If the string is not present, the board is unchanged.

```bash
jq --arg val "item to remove" \
'(.tasks[] | select(.id == "TASK-ID")).FIELD_NAME -= [$val] | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

### `set-array <ID> <field> <json-array>`

Replaces the entire array. Run `show <ID>` first; the current array must be visible in context before this write executes.

```bash
jq --argjson arr '["item 1", "item 2"]' \
'(.tasks[] | select(.id == "TASK-ID")).FIELD_NAME = $arr | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

## Dependency Commands

### `add-dep <ID> <dep-ID>`

Verify dependency exists before appending:

```bash
jq -e --arg id "DEP-ID" '.tasks[] | select(.id == $id)' docs/workboard.json >/dev/null
```

Then append:

```bash
jq --arg dep "DEP-ID" \
'(.tasks[] | select(.id == "TASK-ID")).depends_on += [$dep] | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

### `remove-dep <ID> <dep-ID>`

```bash
jq --arg dep "DEP-ID" \
'(.tasks[] | select(.id == "TASK-ID")).depends_on -= [$dep] | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

## Status Commands

### `set-blocked <ID> <reason>`

Reason must be non-empty. Sets both `status` and `blocked_by` atomically.

```bash
jq --arg reason "reason text" \
'(.tasks[] | select(.id == "TASK-ID")) |= . + {"status": "blocked", "blocked_by": [$reason]} | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

To append a second reason without clearing the first:

```bash
jq --arg reason "additional reason" \
'(.tasks[] | select(.id == "TASK-ID")).blocked_by += [$reason] | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

### `unblock <ID>`

```bash
jq '(.tasks[] | select(.id == "TASK-ID")) |= . + {"status": "todo", "blocked_by": []} | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

### `delete-task <ID>`

Removes a task permanently. Only valid when `status` is `todo`, `blocked`, or `done`.

Before writing:

Check task is not `in_progress`:

```bash
jq -e --arg id "TASK-ID" '.tasks[] | select(.id == $id and .status == "in_progress")' docs/workboard.json >/dev/null && echo "REFUSED: task is in_progress"
```

Check no other task depends on it:

```bash
jq --arg id "TASK-ID" '[.tasks[] | select(.depends_on | contains([$id])) | .id]' docs/workboard.json
```

Then delete:

```bash
jq --arg id "TASK-ID" \
'.tasks |= map(select(.id != $id)) | .last_updated = "YYYY-MM-DD"' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json
```

## `split-task <ID>`

Replaces one task with two or more scoped subtasks. Only valid when source task is `todo` or `blocked`.

This is a multi-step destructive operation. Stop after Step 3 and wait for explicit confirmation before writing.

Step 1: Read the original task in full.

```bash
jq '.tasks[] | select(.id == "ORIG-ID")' docs/workboard.json
```

Step 2: Find downstream dependents that need `depends_on` rewrites.

```bash
jq --arg orig "ORIG-ID" '[.tasks[] | select(.depends_on | contains([$orig])) | .id]' docs/workboard.json
```

Step 3: Present split proposal and wait for confirmation.

Show:

- New task objects (`id`, `title`, `description`, `acceptance_criteria`)
- Which split task is terminal (downstream dependents will point here)
- Downstream task IDs that will have `depends_on` updated

Do not write until confirmed.

Step 4: Execute after confirmation.

ID naming rule: split IDs must use underscore-plus-digit suffixes: `ORIG-ID_1`, `ORIG-ID_2`, etc. Never use letter suffixes.

First split inherits original `depends_on`. Each subsequent split depends on the previous split. All splits inherit `group_id` and `priority` unless explicitly overridden.

Write the splits to a temp file first (the quoted heredoc delimiter prevents shell interpolation, so single quotes and special characters in descriptions are safe), then run the atomic jq expression:

```bash
cat > /tmp/splits.json << 'SPLITS_EOF'
[
  {
    "id": "ORIG-ID_1",
    "title": "...",
    "description": "...",
    "status": "todo",
    "priority": "...",
    "group_id": "...",
    "depends_on": [],
    "blocked_by": [],
    "acceptance_criteria": ["..."],
    "docs": [],
    "files": [],
    "commands": []
  },
  {
    "id": "ORIG-ID_2",
    "title": "...",
    "description": "...",
    "status": "todo",
    "priority": "...",
    "group_id": "...",
    "depends_on": ["ORIG-ID_1"],
    "blocked_by": [],
    "acceptance_criteria": ["..."],
    "docs": [],
    "files": [],
    "commands": []
  }
]
SPLITS_EOF

jq \
  --arg orig "ORIG-ID" \
  --arg last "ORIG-ID_2" \
  --slurpfile splits /tmp/splits.json \
'.last_updated = "YYYY-MM-DD" |
 .tasks = (
   [ .tasks[] |
     select(.id != $orig) |
     if (.depends_on | contains([$orig]))
     then .depends_on = (.depends_on | map(if . == $orig then $last else . end))
     else . end
   ] + $splits[0]
 )' \
docs/workboard.json > /tmp/wb.json && mv /tmp/wb.json docs/workboard.json

rm -f /tmp/splits.json
```

Step 5: Validate using Shared Write Protocol steps 3 and 4.

Step 6: Report new IDs created, downstream `depends_on` updates, and removal of original task.

## Guardrails

- Never rewrite the full file; apply targeted edits only.
- Never edit `status` via `edit-task`; use `set-blocked`, `unblock`, or `$start-task`.
- Never rename an `id`.
- Warn before writing to an `in_progress` task.
- `add-task` refuses `status != "todo"`.
- `split-task` refuses source tasks with `status == "in_progress"` or `status == "done"`.
- `split-task` requires at least two output tasks.
- `split-task` IDs must use `_N` suffixes.
- `delete-task` refuses `status == "in_progress"` and refuses deletion when any other task references it in `depends_on`.
- `set-blocked` refuses an empty reason string.
