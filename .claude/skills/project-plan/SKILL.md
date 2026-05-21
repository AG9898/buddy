---
name: project-plan
description: Planning-first workflow for new features, product changes, integrations, or refactors. Infers minimum relevant docs, asks clarifying questions, drafts a documentation proposal, then produces workboard-compatible implementation tasks once direction is accepted.
version: 1.0.0
---

# Project Plan

Use this skill when the user has a new feature idea, product change, integration question, refactor proposal, or wants to understand how a proposed change should fit into this repo.

Do not jump into implementation unless the user explicitly switches from planning to execution.

## Workflow

1. Read `CLAUDE.md` first to understand the project's doc structure and routing.
2. Infer the minimum relevant docs from the proposal. Use [references/doc-routing.md](references/doc-routing.md).
3. Gather context surgically:
   - Prefer headings, targeted searches, and specific sections over opening full docs.
   - Do not read unrelated docs just because they exist.
   - Do not read the full `docs/workboard.json` unless the user explicitly asks for task planning or board edits.
4. Restate the proposal in repo terms and identify likely affected surfaces.
5. Ask at least one clarification question before presenting any proposal. Ask more questions when scope, rollout, or behavior is ambiguous.
6. Draft a terminal-only documentation proposal. This proposal is for doc changes only, not code changes.
7. Revise the proposal with the user until the documentation direction is accepted.
8. Once documentation direction is accepted:
   - Update the relevant docs if the user has asked for execution.
   - Produce workboard-compatible implementation tasks using [references/workboard-format.md](references/workboard-format.md).
   - For board writes, hand off to `/edit-workboard`.
   - For board reads or next-task selection, hand off to `/query-workboard`.
   - For task execution, hand off to `/start-task`.

## Proposal Output

When drafting the documentation proposal in the terminal, keep it compact and use this structure:

- Title
- Why this change exists
- Docs to update
- Proposed changes by doc
- Open questions or assumptions
- Acceptance conditions

The proposal should describe how docs should change, not how implementation should be coded line by line.

## Clarification Rules

- Ask at least one real question tied to scope, UX, data shape, rollout, or constraints.
- Prefer concise questions with concrete tradeoffs.
- Ask additional questions when auth boundaries, schema impact, or streaming behavior might change.

## Task Breakdown Rules

After the documentation direction is accepted and applied, produce tasks that another agent can execute without making product decisions.

- Match the existing workboard shape and naming style from [references/workboard-format.md](references/workboard-format.md).
- Split tasks by subsystem or responsibility, not by arbitrary file count.
- Keep each task focused on one primary behavioral outcome.
- Create subtasks only when they reduce ambiguity or enable parallel work.
- Use `depends_on` and `blocked_by` explicitly for ordering and blockers.
- Keep acceptance criteria behavioral and testable.
- Prefer tasks that map cleanly to one primary surface such as schema, server API, admin UI, public UI, or docs.
- Do not mutate `docs/workboard.json` unless the user explicitly asks to write tasks there; if writing, hand off to `/edit-workboard`.

## Context Discipline

The context window is a shared budget. Keep this skill lean:

- Load only docs implied by the proposal.
- Use targeted reads before full reads.
- Keep the first output to a documentation proposal only.
- Defer task generation until documentation direction is settled.

## Skill Handoffs

| Next action | Skill |
|---|---|
| Query board / find next task | `/query-workboard` |
| Write or restructure tasks | `/edit-workboard` |
| Execute a task end-to-end | `/start-task` |

## Guardrails

- Never implement code during the initial proposal phase.
- Never produce workboard tasks before documentation direction is accepted.
- Never mutate `docs/workboard.json` directly — hand off to `/edit-workboard`.
- Never assume specific group IDs, doc paths, or field names from other repos — consult `CLAUDE.md` for project-specific conventions.
- Always ask at least one clarifying question before presenting a proposal.
- Do not invent legacy task fields from other repos; use the current workboard schema.
