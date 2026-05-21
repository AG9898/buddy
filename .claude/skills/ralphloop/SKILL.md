---
name: ralphloop
description: Monitor-only delegated loop that runs one worker per cycle against a skill/prompt and stops at `iterations:N` or `tasks:N` threshold.
version: 1.0.0
---

# Ralph Loop

This skill is for explicit delegated loop requests only.

The current agent is the monitor/orchestrator. It does not implement tasks directly.

## Invocation

`/ralphloop <skill-or-prompt> <threshold>`

Examples:

- `/ralphloop start-task iterations:3`
- `/ralphloop start-task tasks:2`
- `/ralphloop "audit docs links" iterations:1`

## Inputs

- `TASK`: skill name or quoted prompt
- `THRESHOLD`: `iterations:N` or `tasks:N`

If malformed, print usage and stop.

## Setup

Track:

- `ITER = 0`
- `BASELINE_DONE` when threshold is `tasks:N`:

```bash
jq '[.tasks[] | select(.status == "done")] | length' docs/workboard.json
```

If `TASK` is a skill name, ensure skill file exists in configured local skill directories.

## Per-Cycle Contract

1. Check threshold before launching next worker.
2. Launch one fresh worker agent/subprocess per cycle.
3. Worker performs at most one bounded cycle and must finish with a strict summary trailer:

```text
RALPH-SUMMARY-START
STATUS: SUCCESS|FAILURE|BLOCKED
TASK_ID: <task id or n/a>
TASK_TITLE: <task title or one-line summary>
DOCS: UPDATED|N/A|MISSING (<brief detail>)
TESTS: PASS|FAIL|SKIP (<brief detail>)
FILES_CHANGED: <comma-separated paths, max 5>
COMMIT_MSG: <one-line commit message, max 72 chars>
PUSHED: YES|NO (<sha or reason>)
FAILURE_REASON: <reason or none>
WORK_DONE: <brief summary of completed work before stop, or none>
PRESERVED_CHANGES: YES|NO (<brief worktree state or reason>)
RALPH-SUMMARY-END
```

4. On `FAILURE` or `BLOCKED`, the worker must stop without reverting, discarding, or cleaning up edits. It must use `WORK_DONE` to summarize what changed or what investigation was completed before termination.
5. Parse summary block only. If missing, treat as `FAILURE`.

## Publish Policy

- Monitor policy: the monitor/orchestrator never creates commits and never pushes.
- Worker commit policy: workers create local commits when the delegated skill requires commits (for example, `start-task`) and checks pass.
- Worker push policy: workers never push unless the user explicitly requested publishing for this run; when publishing is requested, push only on `SUCCESS` after docs+tests gates pass.

## Success Handling

- Increment `ITER`.
- If threshold is `tasks:N`, re-check done count and compute delta from baseline.
- For `start-task` style loops, if `SUCCESS` is reported but done count did not increase, treat as `BLOCKED` and stop.

## Failure/Blocked Handling

- `FAILURE`: halt loop, report `FAILURE_REASON`, `WORK_DONE`, `FILES_CHANGED`, `PRESERVED_CHANGES`, and current non-destructive `git status --short`.
- `BLOCKED`: halt loop gracefully, report the blocker, any completed investigation/work, and current non-destructive `git status --short`.
- Do not revert, reset, clean, stash, or discard partial worker edits. Leave the worktree intact so the developer can decide whether to continue, keep, commit, or drop the edits.
- Optionally write a concise failure note file only if useful in this repo, but never use that note as a substitute for the summary trailer.

## Guardrails

- Monitor never does implementation work.
- Never auto-discard changes with destructive git commands.
- Never ask a worker to revert or discard partial edits after `FAILURE` or `BLOCKED`; preserve state for developer review.
- Never continue past reached threshold.
- Never treat `SUCCESS` as valid when docs/tests/publish gates fail for a publish-required run.
