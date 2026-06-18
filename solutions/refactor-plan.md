# Surgical Refactor Plan

> Completed before touching messy hot-path code. Updated after a reviewer
> correction: concurrent write protection MUST be an atomic update, not a
> read-then-write.

## 1. Target

- **File**: `apps/legacy-app/src/analysis/analysis.service.ts` and the supporting persistence boundary in `apps/legacy-app/src/shared/database/database.service.ts`.
- **Function / class**: `AnalysisService.delayedUpdate()` (2-second post-create refresh) and a new `DatabaseService.updateJobIfNotCompleted()` (atomic conditional update).
- **Why this is in scope**: Ticket #4521 — full-analysis (high-confidence) Worker results are intermittently overwritten with low-confidence quick-demographics. The root cause is a write-ordering race between the 2 s delayed refresh and the Worker COMPLETED write.

## 2. Current responsibility leak

The smallest concrete responsibility leak: `delayedUpdate()` decides what to
write **without consulting the durability layer atomically**. The original
implementation issued an unconditional `updateJob` regardless of state. A
naive first-attempt fix added a `findJobById` status check before the
write — but that is read-then-write and is itself unsafe under concurrency.

The correct boundary is: the persistence layer must own the
"write only if not COMPLETED" invariant, because only the database can
evaluate that invariant atomically with the write itself.

Concrete race the fix must defeat:

```
T+0ms     createAnalysis      saveJob(PENDING, quick=0.3)
T+1.2s    Worker              updateJob(COMPLETED, high=0.85)
T+2.0s    delayedUpdate       atomic: update only if status != COMPLETED
                              -> filter rejects, no write performed
```

And the TOCTOU case the read-then-write pattern would have failed:

```
T+2.000s  delayedUpdate.read    findJobById -> status=PENDING
T+2.001s  Worker                updateJob(COMPLETED, high=0.85)
T+2.002s  delayedUpdate.write   updateJob(quick=0.3)  // OVERWRITES COMPLETED
```

The atomic conditional update has no such window because the filter and
the write are evaluated together by the database.

## 3. Characterization tests

- **Test file**: `apps/legacy-app/test/bug-repro.spec.ts`.
- **Test 1 (Worker faster than 2 s)**: Worker flips job to COMPLETED before the timer fires. Atomic guard rejects the late write. Final demographics confidence remains 0.85.
- **Test 2 (TOCTOU regression)**: a one-shot mock implementation of `updateJobIfNotCompleted` flips the document to COMPLETED at the moment the database evaluates the filter (i.e. between the application "intent to write" and the database "decision to write"). The conditional update returns `false` and the COMPLETED state is preserved. This test is the explicit regression guard against any future reintroduction of read-then-write.
- **Test 3 (queue backlog)**: job stays PENDING (Worker has not picked it up). The delayed refresh applies and the user still gets quick-demographics in the dashboard.
- **Test 4 (structural)**: asserts the service ONLY calls `updateJobIfNotCompleted` and NEVER the unconditional `updateJob` from the delayed-refresh code path. Prevents accidental regression by future contributors.

## 4. Extraction boundary

- **New persistence method**: `DatabaseService.updateJobIfNotCompleted(jobId, updates): Promise<boolean>`.
  - Inputs: `jobId: string`, `updates: Partial<AnalysisJob>`.
  - Returns: `true` if a document was actually updated, `false` if the guard rejected it (already COMPLETED, or document missing).
  - Implementation: a single MongoDB `updateOne({ jobId, status: { $ne: 'COMPLETED' } }, { $set: ... })`. No application-side check.
- **AnalysisService.delayedUpdate** simply calls `updateJobIfNotCompleted` and logs the boolean result. No `findJobById` is performed in this code path. The TOCTOU window is gone because there is no application-side check between read and write.
- **Why this is the smallest safe boundary**:
  - One new method on the persistence interface.
  - One call-site change in `AnalysisService`.
  - No schema migration (uses the existing `status` field).
  - No change to the Worker write path.
  - No change to the initial quick-demographics save (user still gets immediate feedback).
  - No change to the `setTimeout` duration (preserves timing semantics for queue-backlog cases).

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Read-then-write status check (`findJobById` then unconditional `updateJob`) | TOCTOU race. Reviewer corrected this explicitly. The check provides no protection because the database is not asked to enforce it at write time. |
| Remove `delayedUpdate` entirely | Changes observable behaviour for queue-backlog cases (Worker has not picked up the job after 2 s). The user would lose the "give-them-something-now" feedback. |
| Replace the timer with a saga / BullMQ delayed job | Architecturally tidier, but introduces a new dependency, new infra, and new failure modes during an active customer incident. Out of scope for a surgical fix. |
| Optimistic locking with a `version` field | Correct long-term, but requires coordinated changes in the Worker write path and a schema-aware migration. The atomic conditional update achieves the same correctness with one persistence method. Optimistic locking is queued as a separate item. |
| Rewrite `AnalysisService` with clean architecture (use cases, repositories, domain events) | Out of scope. Broad rewrite introduces risk with no immediate customer benefit beyond the race condition fix. |

## 6. Verification

- **Tests run**: `pnpm test` (root) → `pnpm --filter legacy-app test` → 4/4 passed including the TOCTOU regression case.
- **Clean-clone safety**: `pnpm run verify:clean-clone` programmatically asserts that `DatabaseService.updateJobIfNotCompleted` exists, that `AnalysisService.delayedUpdate` does not contain a `findJobById -> updateJob` pattern, and that the spec exercises the atomic API.
- **Build**: `pnpm run build` compiles all workspace packages from a clean install.
- **Submission check**: `pnpm run verify:submission` 17/17 ✓.

## 7. Remaining risk

- The atomic conditional update is one MongoDB round-trip per delayed refresh. This is strictly less I/O than the previous read-then-write attempt, so no perf regression is introduced.
- If at some future point the team adopts optimistic locking with `version`, the conditional filter can be extended to `{ jobId, status: { $ne: 'COMPLETED' }, version: <expected> }` without changing the call-site contract.
