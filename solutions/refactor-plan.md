# Surgical Refactor Plan

> Complete before touching messy hot-path code.

## 1. Target

- File: `apps/legacy-app/src/analysis/analysis.service.ts` (and one focused helper added to `apps/legacy-app/src/shared/database/database.service.ts`)
- Function / class: `AnalysisService.createAnalysis` → the `setTimeout(..., 2000)` fire-and-forget call to `private delayedUpdate`
- Why this is in scope: this is the live data-loss bug invited by `apps/legacy-app/test/bug-repro.spec.ts` (customer support ticket #4521, "data overwrite issue"). The delayed refresh re-writes stale quick demographics with an **unconditional** `$set`, so when the worker completes the real analysis within the 2-second window, the worker's results are silently overwritten by random placeholder data.

## 2. Current responsibility leak

`createAnalysis` (a request handler) owns a detached persistence side effect: a fire-and-forget timer that escapes the request lifecycle and races the worker pipeline for the same document, last-write-wins, with no state guard. Secondary smells in the same path (error swallowed as `console.log('Error happened')`, mixed `Logger`/`console`) are noted but **deliberately left out of scope** — fixing them is not required to close the data-loss bug.

## 3. Characterization test

- Existing behavior to lock (must pass before AND after the fix):
  1. `createAnalysis` returns a `PENDING` job with quick demographics drawn from the documented value sets, persists it exactly once, and publishes exactly one `AnalysisRequested` event carrying the same `jobId`/`userId`/`dataUrl`.
  2. The delayed refresh still updates a job that is **still PENDING** 2 seconds later (refresh behavior preserved, only its clobber power removed).
- New regression test (red before the fix, green after): when the worker marks the job `COMPLETED` with real demographics before the 2-second timer fires, those results must survive the delayed refresh.
- Test file: `apps/legacy-app/test/bug-repro.spec.ts`, against an in-memory store that emulates the Mongo update semantics (unconditional `$set` vs. status-guarded `$set`), with jest fake timers driving the 2-second window. No live MongoDB required.
- Expected failure mode if behavior changes accidentally: the regression test fails with the worker's demographics replaced by quick-demographics placeholder values (the exact #4521 symptom); the characterization tests fail if creation/publish/refresh behavior drifts.
- Harness note: `legacy-app` declares `"test": "jest"` but ships no jest, no `@nestjs/testing`, and does not declare its `@senior-challenge/shared-types` import (baseline: `sh: jest: command not found`). Dev-only repair, required to write any test at all: add `jest`/`ts-jest`/`@types/jest`/`@nestjs/testing` devDependencies, a jest config block, a `tsconfig.spec.json`, and the missing `workspace:*` dependency. No application logic is touched by the harness repair.

## 4. Extraction boundary

- Extracted helper / function: `DatabaseService.updateJobIfPending(jobId, updates)` — the single new focused helper.
- Inputs: `jobId: string`, `updates: Partial<AnalysisJob>`.
- Outputs: `Promise<void>` (matches the existing `updateJob` contract).
- Side effects: one atomic conditional update — filter `{ jobId, status: 'PENDING' }` — so the refresh can never touch a job that has left `PENDING`. The guard lives in the database filter, not in service-layer read-then-write logic, so there is no check-to-write race window.
- Why this is the smallest safe boundary: one new method, one call-site change (`delayedUpdate` calls `updateJobIfPending` instead of `updateJob`). The public API, the event flow, the worker, the controller, and the existing `updateJob` used elsewhere are all untouched. The fix is expressed as a state invariant ("a delayed refresh may only refresh a job that is still pending"), which is exactly the bug's root cause and nothing more.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Delete the `setTimeout`/`delayedUpdate` path entirely ("it re-writes data already saved") | Larger observable behavior change than needed (removes an existing write path and its `updatedAt` refresh); the minimal invariant fix keeps behavior and kills only the clobber. |
| Read job status in the service, then update only if still PENDING | Keeps a read-check-write race window; the guard must be atomic in the update filter. |
| Rewrite `createAnalysis` into an outbox/event-sourced flow with versioned optimistic locking | Correct long-term direction, but a framework-level rewrite of the hot path — explicitly out of scope per the challenge rules ("do not rewrite the application"). |
| Also fix swallowed errors, `console.log` usage, and the unimplemented replay/chaos scripts "while we're here" | Scope creep beyond the spec'd fix; recorded as known issues instead. |
| Replace the file-based queue with a real broker to "fix it properly" | Infrastructure rewrite unrelated to the overwrite bug. |

## 6. Verification

- Tests run: `corepack pnpm --filter legacy-app test` — (a) baseline before harness repair: `jest: command not found`; (b) after tests, before fix: regression test red with worker results clobbered; (c) after fix: full suite green.
- Command output: captured verbatim in `solutions/test-evidence.md` (red and green runs).
- Remaining risk: jobs that legitimately stay `PENDING` past 2s still get their quick demographics re-asserted (unchanged existing behavior, accepted); `PROCESSING` jobs are no longer refreshed by the timer — intended, since the worker owns the document from that point.
