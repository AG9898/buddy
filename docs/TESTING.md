# TESTING.md — Test Suite Reference

> Canonical source for how to run tests, what is covered, and how to write new tests.
> Read before adding any new test file or modifying an existing one.
> Code conventions that affect test structure live in [`CONVENTIONS.md`](CONVENTIONS.md).

---

## Quick Start

```bash
# TODO: Replace with the actual commands for this project.

# Run all tests
# e.g. npm test
# e.g. cd backend && PYTHONPATH=. .venv/bin/pytest tests/ -v
# e.g. cargo test --workspace

# Run a single file
# e.g. npm test -- src/services/scoring.test.ts
# e.g. PYTHONPATH=. .venv/bin/pytest tests/test_scoring_digitspan.py -v

# Run with coverage
# e.g. npm run test:coverage
# e.g. PYTHONPATH=. .venv/bin/pytest tests/ --cov=app
```

---

## Test Stacks

<!-- TODO: One row per test stack. -->

| Stack | Tool | Version | Location | Run Command |
|---|---|---|---|---|
| <!-- TODO: e.g. Frontend --> | <!-- TODO: e.g. vitest --> | <!-- TODO --> | <!-- TODO: e.g. `src/**/*.test.ts` --> | <!-- TODO: e.g. `npm test` --> |
| <!-- TODO: e.g. Backend --> | <!-- TODO: e.g. pytest --> | <!-- TODO --> | <!-- TODO: e.g. `backend/tests/` --> | <!-- TODO: e.g. `PYTHONPATH=. .venv/bin/pytest tests/` --> |

---

## What Is Covered

<!-- TODO: Describe what the test suite covers at a high level.
Be honest about gaps — this helps agents make good decisions about where to add tests.

Example:
**Backend:** scoring modules (pure unit), service logic (mocked collaborators), router endpoints
(auth and response shape), import/export flows, analytics parity (fixture-based).

**Frontend:** same-origin Route Handler auth and cache behavior, route-topology guard assertions,
utility modules (status mapping, display formatting, error resolution).

**Not covered:** end-to-end browser tests, visual regression, load testing.
-->

---

## Test File Inventory

<!-- TODO: List every test file with its domain and coverage scope.
Keep this table up to date — add a row when adding a new test file.

| File | Domain | What It Covers |
|---|---|---|
| `test_scoring_foo.py` | Scoring | `score()` pure function — all correct, all wrong, mixed inputs |
| `test_service_bar.py` | Service | Business logic with mocked DB session |
| `test_router_baz.py` | Router | Endpoint auth, response shape, error codes |
| `foo.test.ts` | Frontend | Route Handler cache hit/miss/auth failure |
| `route-topology.test.ts` | Frontend | Asserts middleware + layout guard wiring on all RA routes |
-->

*(No test files yet — fill in as the suite grows.)*

---

## Writing New Tests

### Rules

<!-- TODO: Hard rules for tests in this project. Agents follow these unconditionally.

Examples:
- Unit tests must not hit a live database — use fakes (`SimpleNamespace`, `_FakeAsyncSession`) or mocks.
- Scoring functions are pure — test with plain input/output; no mocks required.
- Any route change that touches auth must include an assertion in the route-topology test file.
- Analytics / parity tests are blocking — a parity failure means the PR does not merge.
- New public service functions require at least one unit test before the task is marked done.
-->

### Patterns

<!-- TODO: Idiomatic test patterns for this project.

Backend (Python) example:
- Service isolation: mock imported collaborators via `unittest.mock.patch`.
- Async tests: use `@pytest.mark.anyio` or `IsolatedAsyncioTestCase`.
- Fake DB session: define `_FakeAsyncSession` inline with the expected method surface only.

Frontend (TypeScript) example:
- Module mocking: `vi.mock('../lib/supabase')` at the top of the test file.
- Route Handler tests: call the exported `GET`/`POST` function directly with a mock `Request`.
- Avoid testing implementation details — test behavior through the public interface.
-->

### Adding a New Test File

<!-- TODO: Step-by-step process for adding a test file.

Example:
1. Name the file following the project convention (e.g. `test_<domain>_<layer>.py`).
2. Place it in the correct test directory (e.g. `backend/tests/`).
3. Add a row to the Test File Inventory table above.
4. Run the full suite to confirm no regressions before committing.
-->
