# Doc Routing

Open only the docs implied by the proposal. The specific docs available in this project are discovered by reading `{{INSTRUCTION_FILE}}` or the project's docs index.

## General Heuristics

- Read `{{INSTRUCTION_FILE}}` first to find which canonical docs exist for this project.
- Start with the narrowest likely docs for the proposal type.
- Expand only when the proposal crosses subsystem boundaries.
- Do not preload unrelated docs.

## Common Proposal-to-Doc Mappings

| Proposal type | Likely doc categories |
|---|---|
| New product feature | Product requirements, architecture, conventions |
| Data model or migration change | Architecture, decisions, schema docs |
| Auth, session, or env behavior | Architecture, environment config, decisions |
| UI redesign or component behavior | Style guide, component library, animation guide |
| Work planning and sequencing | Workboard usage contract, workboard schema, targeted workboard data |
| Engineering guardrails or patterns | Conventions, testing strategy |

## Selection Rules

- Read one doc per concern rather than preloading everything.
- For mixed proposals, identify the primary concern first, then expand as needed.
- Load `docs/workboard.json` only when the user explicitly requests task planning or board edits.
