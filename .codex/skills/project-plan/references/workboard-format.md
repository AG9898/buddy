# Workboard Task Format

When breaking accepted documentation direction into implementation work, target the existing `docs/workboard.json` task shape in this repo.

## Required Fields

Each task must include:

- `id`
- `title`
- `description`
- `status`
- `priority`
- `group_id`
- `depends_on`
- `blocked_by`
- `acceptance_criteria`
- `docs`
- `files`
- `commands`

## Formatting Guidance

- Use the current ID style in this repo — inspect existing task IDs in `docs/workboard.json` to match the pattern. A common convention is `<GROUP>-NN` with an optional letter suffix for splits (e.g. `FEAT-01`, `FEAT-02A`).
- Keep `group_id` aligned to the existing groups in this project's workboard. Do not invent new groups without the user's approval.
- Default new tasks to `status: "todo"` unless the user asks for another state.
- Use allowed priorities only: `critical`, `high`, `medium`, `low`.
- Write `title` as a concise action-oriented summary.
- Write `description` as one implementation-ready paragraph with clear boundaries.
- Make `acceptance_criteria` a short list of observable outcomes.
- Use `depends_on` for prerequisite task IDs.
- Use `blocked_by` for external blockers or unresolved decisions.
- Keep `docs` limited to canonical docs that must stay synchronized.
- Keep `files` limited to likely primary implementation paths.
- Keep `commands` to the minimum verification checklist for the task.

## Decomposition Rules

- Split tasks when work crosses distinct surfaces (schema, server, admin UI, public UI, docs).
- Keep each task focused on one behavioral outcome.
- Create subtasks only when they reduce ambiguity or enable independent execution.
- Prefer explicit dependency edges over large umbrella tasks.
- Avoid bundling unrelated docs and code changes into one task unless unavoidable.
