# Surgical Refactor Plan

> Completed before touching messy hot-path code.

## 1. Target

- File: `apps/legacy-app/src/analysis/analysis.service.ts`
- Function / class: `AnalysisService.createAnalysis` (and its private `delayedUpdate`)
- Why this is in scope: it contains a second, delayed write path to the same job record that the worker owns — the operational analog of the "two billing paths" concern and the direct cause of ticket #4521 data overwrite.

## 2. Current responsibility leak

`createAnalysis` persists a job with placeholder `quickDemographics` (random, `confidence: 0.3`), publishes the analysis event, and THEN schedules `setTimeout(() => delayedUpdate(jobId, quickDemographics), 2000)`. The worker fills in the real demographics and marks the job `COMPLETED`; ~2s later the delayed callback rewrites the record with the stale placeholder, clobbering the worker's result. Two writers, last-write-wins, no version guard.

## 3. Characterization test

- Existing behavior to lock: after `createAnalysis`, no delayed write may overwrite a record that the worker has completed; the request path persists exactly once and publishes exactly once.
- Test file: `apps/legacy-app/test/bug-repro.spec.ts` (jest + fake timers, mocked `DatabaseService`/`MessageQueueService`).
- Expected failure mode if behavior changes accidentally: if the `setTimeout` overwrite is reintroduced, the test that asserts `updateJob` is not called after advancing timers past 2000ms fails.

## 4. Extraction boundary

- Extracted helper / function: none added. The smallest safe change is to REMOVE the second writer, not to add abstraction. Job-result persistence is consolidated onto the worker's single completion path.
- Inputs: unchanged (`CreateAnalysisDto`).
- Outputs: unchanged (the `AnalysisJob` returned to the caller, status `PENDING`).
- Side effects: one `saveJob` + one `publishEvent`; the delayed `updateJob` side effect is deleted.
- Why this is the smallest safe boundary: deleting the racy `setTimeout` (and its now-dead `delayedUpdate`) removes the defect without introducing a queue, lock, or new module.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Introduce optimistic locking / a `version` field and guard every update | Over-engineered for this leak; the placeholder write has no reason to exist at all. |
| Add a distributed lock / mutex around job updates | New infrastructure and failure modes for a bug fixed by a deletion. |
| Rewrite the analysis pipeline into a state machine / saga | A broad rewrite the spec does not justify; out of scope per the challenge rules. |
| Keep the delayed refresh but make it idempotent | It still races the worker and adds nothing; correct fix is removal. |

## 6. Verification

- Tests run:
  - `pnpm --filter legacy-app test` — fast unit characterization (mocked DB, fake timers), 2 passing.
  - `pnpm --filter legacy-app test:integration` — REAL MongoDB cross-process repro (`docker compose up -d mongodb`), proves the worker's COMPLETED result is not clobbered.
- Command output (see `solutions/test-evidence.md`): both green after the fix; both go red when the racy `setTimeout` is reintroduced (integration red reads `confidence: 0.3` back from Mongo instead of `0.85`).
- Remaining risk: none identified for this record. The real two-writer race is now reproduced against Mongo; broader job-update concurrency (other fields, other callers) is out of scope and untouched.

## 7. Secondary micro-extraction (worker testability)

- Target: `apps/worker-service/src/processors/analysis.processor.ts` `calculateAgeRange` (a pure age-bucket mapping buried in the messy worker).
- Change: extracted byte-for-byte to `apps/worker-service/src/processors/age-range.ts` and imported back; zero behavior change to `process()`.
- Why justified (not scope creep): it gives the worker a dependency-free unit so the age-bucket boundaries can be characterization-tested without a DB or the third-party API. This replaces the worker's `--passWithNoTests` placeholder with a real test (`apps/worker-service/test/age-range.spec.ts`).
- Rejected alternative: testing via `new AnalysisProcessor()` — its constructor fires a Mongo connect side effect, so a unit test would need infra; extracting the pure function is the smaller, infra-free boundary.
