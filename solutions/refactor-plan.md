# Surgical Refactor Plan

> Complete before touching messy hot-path code. Scope rules: no rewrite, no parallel framework, at most one focused extraction, characterization test before behavior change.

## 1. Target

- File: `apps/legacy-app/src/analysis/analysis.service.ts`
- Function / class: `AnalysisService.createAnalysis` (and the dead `delayedUpdate` it called)
- Why this is in scope: it is the exact site of support ticket #4521 ("data overwrite"). The Worker computes the real demographics asynchronously, but `createAnalysis` schedules a `setTimeout(2000)` that re-writes the original random pre-compute, racing against and overwriting the Worker's `COMPLETED` result.

## 2. Current responsibility leak

`createAnalysis` mixes two responsibilities: (a) create the job + publish the work event (legitimate), and (b) act as a delayed "refresher" that writes pre-compute data back to the database after the request has returned. Responsibility (b) is illegitimate — the Worker is the source of truth for full demographics, so a fire-and-forget write of stale data from the create path corrupts the record. This is the smallest concrete leak; no other behavior is in scope.

## 3. Characterization test

- Existing behavior to lock: once the Worker writes the full demographics (status `COMPLETED`), nothing from the create path may overwrite it.
- Test file: `apps/legacy-app/test/bug-repro.spec.ts` (runner-agnostic, executed with `tsx`; constructs `AnalysisService` with in-memory mocks and captures the scheduled timer instead of waiting 2s).
- Expected failure mode if behavior changes accidentally: if a delayed/background write to `demographics` is reintroduced, the test fails with a deep-equal mismatch (`confidence: 0.85` worker result replaced by `confidence: 0.3` pre-compute).

## 4. Extraction boundary

- Extracted helper / function: **none required.** The correct fix is a *deletion*, not an extraction — the smallest possible change. The pre-existing pure helper `calculateQuickDemographics` already isolates the immediate-feedback computation and is left untouched and directly testable.
- Inputs: n/a (no new helper).
- Outputs: n/a.
- Side effects removed: the `setTimeout` → `delayedUpdate` background DB write is removed; `delayedUpdate` becomes dead code and is deleted.
- Why this is the smallest safe boundary: removing the racing write fixes the bug with zero new abstractions and zero change to the create/publish contract or the public API. Adding a helper or a state machine would be larger and unjustified.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Rewrite `AnalysisService` into an event-sourced state machine | Broad rewrite, out of scope; does not serve the one-line fix. |
| Keep the delayed update but add `version`/optimistic locking now | Considered and **deferred**: it spreads changes across `DatabaseService`, the worker, and the schema for a write path that should not exist at all. Deleting the racing write is smaller and complete. Documented as a follow-up hardening, not part of this fix. |
| Replace `setTimeout` with a queued "refresh" job | Re-introduces the same stale-overwrite responsibility via a different mechanism. |
| Make `delayedUpdate` re-read before writing | Adds complexity to preserve a write that has no valid purpose. |

## 6. Verification

- Tests run: `cd apps/legacy-app && tsx test/bug-repro.spec.ts` (or `pnpm --filter legacy-app test:bug-repro`).
- Command output:
  - Before fix (RED): `❌ FAIL: Worker demographics were overwritten by stale pre-compute. Got: {"ageRange":"35-44","gender":"female","location":"US","confidence":0.3}` — exit code 1.
  - After fix (GREEN): `✅ PASS: worker demographics are preserved (no stale overwrite)` — exit code 0.
- Remaining risk: the existing `pnpm --filter legacy-app test` (jest) is not wired in this environment (jest/@nestjs/testing not declared as deps); the characterization test is therefore provided as a dependency-free `tsx` script. Optimistic-locking via the existing `version?` field remains an optional future hardening, intentionally out of scope here.
