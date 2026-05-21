# PRD — <Project Name>

<!-- TODO: Replace <Project Name> above. -->
<!-- TODO: Update the status table each time scope or delivery state changes.     -->

> **Status** (<!-- TODO: YYYY-MM-DD -->)
>
> | Track | State |
> |---|---|
> | Shipped | <!-- TODO: list shipped capabilities, or "Nothing shipped yet." --> |
> | In Progress | <!-- TODO: active workboard items, or "See docs/workboard.json." --> |
> | Planned | <!-- TODO: next scope boundary, or "None yet confirmed." --> |

---

## Objective

<!-- TODO: 2–4 sentences. What does this product do and for whom?
What problem does it solve? What is the core value proposition?

Example:
Internal lab-operated web app for running cognitive assessments with research participants.
RAs manage sessions from a dashboard; participants complete keyboard-only tasks and surveys.
All data is auto-scored, stored, and viewable by the lab team without manual export steps.
-->

---

## Users

<!-- TODO: Define each user role. Be concrete about permissions and access model.

Example:
- **Admin** — configures the system, manages users, controls data access.
- **RA (Research Assistant)** — creates and monitors sessions, views dashboard, imports/exports data.
- **Participant** — completes tasks and surveys; no login required; identified by session ID only.
-->

---

## Scope

<!-- TODO: Define scope clearly per phase. Each phase has a concrete delivery boundary. -->

### Phase 1 — <!-- TODO: Name (e.g. "MVP", "Core Data Collection") -->

<!-- TODO: Bullet list of features delivered in this phase.
Example:
- Keyboard-only Backwards Digit Span task
- Four survey instruments (ULS-8, CES-D 10, GAD-7, CogFunc 8a)
- Auto-scoring for all instruments
- Session creation and data access via database UI
-->

### Phase 2 — <!-- TODO: Name -->

<!-- TODO: Bullet list.
Example:
- RA dashboard with session KPIs
- Import/export page (CSV/XLSX, preview-first)
- Participant demographics collection at session start
-->

### Out of Scope

<!-- TODO: Explicitly list what this project does NOT do.
This section prevents scope creep and guides agent decision-making.

Example:
- No real-time collaboration features.
- No public-facing analytics dashboard.
- No native mobile app — web only.
- No automated email or notification system.
-->

---

## Success Criteria

<!-- TODO: Measurable outcomes that define "done" for this project or current phase.
Each criterion should be verifiable.

Example:
- End-to-end session completes without manual scoring intervention.
- All data is linked to participant_uuid + session_id.
- Lab team can view all stored results without direct database access.
- RA login is gated at the server edge — no client-side-only auth.
-->

---

## Constraints

<!-- TODO: Technical, legal, or operational constraints that bound the solution.
Agents use this section to rule out implementation approaches that violate project requirements.

Example:
- Participants are anonymous — no names or other direct identifiers stored.
- Data must remain in Canada (data residency requirement).
- System must work on iOS Safari 16+ and Chrome 110+.
- No third-party analytics SDKs that transmit participant behavior data off-site.
-->

---

## Non-Goals

<!-- TODO: Explicitly call out what this project intentionally will not do.
Useful for ruling out well-intentioned but out-of-scope additions.

Example:
- Not a general-purpose survey platform — purpose-built for this lab's instruments.
- Not a real-time monitoring system — data is reviewed asynchronously.
- Not a participant-facing portal — participants only see their active task session.
-->
