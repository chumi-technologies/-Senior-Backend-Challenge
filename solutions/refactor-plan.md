# Surgical Refactor Plan

> Completed before touching messy hot-path code.

## 1. Target

- **File**: `apps/legacy-app/src/analysis/analysis.service.ts`
- **Function / class**: `AnalysisService.delayedUpdate()` and the `setTimeout` call in `createAnalysis()`
- **Why this is in scope**: Ticket #4521 reports that full-analysis results are intermittently overwritten with lower-confidence quick-demographics. The root cause is a race condition: `setTimeout(delayedUpdate, 2000)` fires unconditionally and calls `databaseService.updateJob()` with quick-demographics, regardless of whether the Worker has already written high-confidence COMPLETED results during those 2 seconds.

## 2. Current responsibility leak

The smallest concrete responsibility leak: `delayedUpdate()` has **no awareness of the job's current state**. It always writes quick-demographics to the job, mixing concerns between:
1. The initial "give user fast feedback" responsibility (correct — write quick-demographics immediately on job creation)
2. A "refresh/confirm initial data" responsibility (wrong — this re-applies the low-confidence initial data, effectively rolling back any Worker progress)

The delayed re-write of the same initial data it already wrote is a no-op in the best case and a destructive overwrite in the common case (Worker is faster than 2s).

Concrete race:
```
T+0ms:    createAnalysis() → saveJob(quickDemographics, status=PENDING)
T+500ms:  Worker picks up job → updateJobStatus(PROCESSING)
T+1200ms: Worker completes → updateJobWithResults(highConfidenceDemographics, status=COMPLETED)
T+2000ms: delayedUpdate() → updateJob(quickDemographics) ← overwrites COMPLETED result with confidence=0.3
```

## 3. Characterization test

- **Existing behavior to lock**: After `createAnalysis()` is called, if the Worker updates the job to `COMPLETED` with high-confidence demographics before the 2-second timer fires, the resulting stored demographics should be the Worker's high-confidence result — not the initial quick-demographics.
- **Test file**: `apps/legacy-app/test/bug-repro.spec.ts`
- **Expected failure mode if behavior changes accidentally**: If `delayedUpdate()` is called without the status guard, the test will show that `demographics.confidence` is `0.3` (quick-demographics confidence) instead of the Worker's higher value, proving the overwrite occurred.

## 4. Extraction boundary

- **Extracted helper / function**: Add a status check inside `delayedUpdate()` — fetch current job state before writing; skip the update if `status === 'COMPLETED'`.
- **Inputs**: `jobId: string`, `demographics: Demographics` (existing parameters)
- **Outputs**: `Promise<void>` (no change)
- **Side effects**: Reads the job once from DB inside `delayedUpdate`. Only writes if `status !== 'COMPLETED'`.
- **Why this is the smallest safe boundary**:
  - No new abstractions introduced
  - No schema migration required (status field already exists in `AnalysisJob`)
  - No change to the Worker code path
  - No change to the initial quick-demographics write (user still gets immediate feedback)
  - No change to the `setTimeout` duration (preserving timing behavior for queue-backlog scenarios)
  - Single conditional read + conditional skip: one guard, minimal surface area

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Remove `delayedUpdate` entirely | Changes observable behavior: for jobs where Worker is in a slow queue backlog (>2s before pickup), the quick-demographics initial write is never "confirmed" — removing delayedUpdate is safe only if we know Worker always starts within 2s, which is not guaranteed. |
| Replace `setTimeout` with a proper queue/saga pattern (e.g., BullMQ delayed job) | Architecturally correct long-term, but out of scope for a surgical fix. Introduces new dependencies, requires testing infrastructure changes, increases deployment risk during an active incident. |
| Use optimistic locking with `version` field | Correct approach for concurrent write protection. `AnalysisJob` type already has `version?: number`. However, implementing optimistic locking requires: (a) `saveJob` to set `version: 1`, (b) `updateJob` to use `$inc: { version }` + version match filter, (c) Worker to also use versioned updates. This touches 3 files and the shared type — larger than the minimum safe change for this incident. Scheduled for next sprint. |
| Rewrite `AnalysisService` with clean architecture (use cases, repositories, domain events) | Out of scope. Broad rewrite introduces risk with no immediate customer benefit beyond the race condition fix. |

## 6. Verification

- **Tests run**: `pnpm --filter legacy-app test` in `apps/legacy-app`
- **Command output**: See `test/bug-repro.spec.ts` for the reproduction test. Expected output after fix:
  ```
  ✓ should reproduce the data overwrite issue before fix (demonstrates bug)
  ✓ should not overwrite COMPLETED job demographics with delayedUpdate after fix
  ```
- **Remaining risk**: The status-guard fix relies on a read-then-check pattern inside `delayedUpdate`. In an extremely high-concurrency scenario with multiple rapid `createAnalysis` calls for the same jobId (not currently possible since jobId is a new UUID per call), a TOCTOU race could theoretically still exist. Since jobId is generated fresh per request (`uuidv4()`), no two requests share the same jobId — this risk does not apply in practice.
