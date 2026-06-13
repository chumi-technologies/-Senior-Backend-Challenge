# Surgical Refactor Plan

> Complete before touching messy hot-path code.

## 1. Target

- File: `apps/legacy-app/src/analysis/analysis.service.ts`
- Function / class: `AnalysisService.delayedUpdate`
- Supporting file: `apps/legacy-app/src/shared/database/database.service.ts`
- Why this is in scope: customer support ticket #4521 is a data consistency bug where a delayed quick-demographics refresh can overwrite a newer worker result.

## 2. Current responsibility leak

`AnalysisService` schedules a delayed write for preliminary demographics, but the write does not verify that the job is still owned by the preliminary phase. Once `worker-service` moves the job to `PROCESSING`, `COMPLETED`, or `FAILED`, the delayed quick refresh should no longer be allowed to write demographics.

## 3. Characterization test

- Existing behavior to lock: creating an analysis job still saves quick demographics immediately and publishes the worker event.
- New regression behavior: if the worker has already marked the job `COMPLETED`, the delayed quick refresh must not overwrite the worker demographics.
- Test file: `apps/legacy-app/test/bug-repro.spec.ts`
- Expected failure mode if behavior changes accidentally: after the fake timer advances by 2 seconds, a completed job's high-confidence demographics are replaced by the low-confidence quick estimate.

## 4. Extraction boundary

- Extracted helper / function: `DatabaseService.updateJobIfStatus`
- Inputs: `jobId`, expected `AnalysisStatus`, and the partial job update.
- Outputs: boolean indicating whether a matching document was updated.
- Side effects: one MongoDB `analysis_jobs.updateOne` with `{ jobId, status: expectedStatus }` in the predicate.
- Why this is the smallest safe boundary: the race is between two writers, so the status guard must live in the same database write operation rather than in a separate read-before-write check.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Remove quick demographics entirely | Changes user-facing latency behavior and is broader than the bug. |
| Rewrite worker recovery, leases, replay, or queue semantics | Useful future hardening, but not necessary to stop this overwrite. |
| Decide write ownership by timer ordering | Timing is the source of the bug; persisted job status is the source of truth. |
| Add Nest testing module setup | The regression can be tested with direct service instantiation and mocks. |

## 6. Verification

- Tests run:
  - `pnpm --filter legacy-app test`
  - `pnpm --filter legacy-app build`
  - `pnpm run build`
  - `pnpm run verify:submission`
- Command output:
  - `legacy-app test`: 2 tests passed in `apps/legacy-app/test/bug-repro.spec.ts`.
  - `legacy-app build`: Nest build completed successfully.
  - `pnpm run build`: `shared-types`, `legacy-app`, and `worker-service` builds completed successfully.
  - `verify:submission`: all required solution files and content checks passed.
- Remaining risk: this fix prevents the known delayed quick-refresh overwrite, but it does not add broader worker recovery, replay, idempotent event processing, or distributed lock semantics.
