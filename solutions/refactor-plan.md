# Surgical Refactor Plan

> Completed before touching messy hot-path code. Scope is one helper plus one call site; no rewrite.

## 1. Target

- File: `apps/legacy-app/src/analysis/analysis.service.ts` (call site) and `apps/legacy-app/src/shared/database/database.service.ts` (helper).
- Function / class: `AnalysisService.delayedUpdate` and a new `DatabaseService.updateJobIfPending`.
- Why this is in scope: ticket #4521 reports a data-overwrite where the final analysis result disappears. This is the smallest hot path that causes it.

## 2. Current responsibility leak

`createAnalysis` schedules `delayedUpdate` 2 seconds later, which calls the unconditional `updateJob` and writes the stale, randomly-generated preliminary `quickDemographics` back onto the job. By then the Worker may have already written PROCESSING/COMPLETED results, so the delayed write clobbers them (a lost-update race). The leak: a "preliminary refresh" path holds the authority to overwrite final results it should never touch. The fix is a concurrency guard, not a broad redesign.

## 3. Characterization test

- Existing behavior to lock: (a) `createAnalysis` persists a PENDING job and publishes one event; (b) the delayed refresh must not overwrite a job that has left PENDING.
- Test file: `apps/legacy-app/test/bug-repro.spec.ts` (4 tests).
- Expected failure mode if behavior changes accidentally: if the delayed refresh ever calls the unguarded `updateJob` again, the "routes through the guarded helper, never the unguarded updateJob" test fails; if the status guard is dropped from the filter, the "puts the PENDING status guard inside the atomic update filter" test fails.

## 4. Extraction boundary

- Extracted helper / function: `DatabaseService.updateJobIfPending(jobId, updates)`.
- Inputs: `jobId: string`, `updates: Partial<AnalysisJob>`.
- Outputs: `Promise<boolean>` — whether a PENDING document was actually modified (so a stale refresh is observably a no-op, not a silent failure).
- Side effects: a single MongoDB `updateOne` with the guard `{ jobId, status: 'PENDING' }` inside the atomic filter.
- Why this is the smallest safe boundary: the guard lives in the database filter so the check-and-write is atomic (no read-then-write race), and the only call-site change is swapping one method call. No new module, no state machine, no parallel framework.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Extract a full job state-machine / status-transition service | Far larger than the bug requires; violates the "at most one focused helper" rule and adds risk under a deadline. |
| Replace the file-queue + setTimeout flow with an event-sourced pipeline | A broad architecture change; out of scope and a negative signal per the challenge rules. |
| Add optimistic-locking `version` fields across all writes | Heavier than needed; the PENDING status guard already removes the specific lost-update for this path. |
| Drop the delayed refresh entirely | Changes existing public behavior beyond the scoped fix; the refresh is still valid while the job is PENDING. |

## 6. Verification

- Tests run: `pnpm --filter legacy-app test` (4 tests).
- Command output: see `solutions/test-evidence.md` for the red baseline (`jest: command not found`) and the green run (4 passed / 4).
- Remaining risk: other unrelated call sites of `updateJob` are intentionally left unchanged; only the delayed preliminary refresh is guarded.
