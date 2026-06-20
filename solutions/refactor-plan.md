# Surgical Refactor Plan

> Completed before touching messy hot-path code.

## 1. Target

- **File:** `apps/legacy-app/src/analysis/analysis.service.ts`
- **Function / class:** `AnalysisService.createAnalysis` (and the private `delayedUpdate`).
- **Why this is in scope:** This is the code path behind support ticket #4521 ("data
  inconsistency / overwrite"). It is the smallest change that fixes a real correctness bug.

## 2. Current responsibility leak

`createAnalysis` is a request handler whose job is to (a) seed a preliminary job record and
(b) publish an `AnalysisRequested` event. It additionally owns a **fire-and-forget background
mutation**: `setTimeout(() => this.delayedUpdate(jobId, quickDemographics), 2000)`. That timer
re-persists the stale *preliminary* demographics (`confidence: 0.3`) two seconds later. Final
demographics are owned by a different writer — the worker pipeline (`AnalysisProcessor`). So two
writers race over one field with last-writer-wins semantics: if the worker finishes within ~2s, the
request path's delayed write clobbers the real `COMPLETED` result. The leak is the request handler
asserting ownership over a field it does not own.

## 3. Characterization test

- **Existing behavior to lock:** the request path seeds the job exactly once and the worker's final
  demographics are authoritative; the request path must not write demographics after publishing.
- **Test file:** `apps/legacy-app/test/bug-repro.spec.ts` (run with `pnpm --filter legacy-app test`).
- **Expected failure mode if behavior changes accidentally:** if a post-publish demographics write
  is reintroduced, the test "does not overwrite a worker-written COMPLETED result" fails because the
  persisted record reverts to `confidence: 0.3` / `PENDING` instead of the worker's `0.85` /
  `COMPLETED`.

## 4. Extraction boundary

- **Extracted helper / function:** none added. The smallest safe boundary here is **removal**, not
  extraction: delete the racing `setTimeout` and the now-unused `delayedUpdate` method. The single
  legitimate write (`saveJob`) is already present and is kept. Establishing the worker as the sole
  writer of final demographics *is* the boundary.
- **Inputs / Outputs / Side effects:** `createAnalysis` still takes the DTO, returns the seeded
  `AnalysisJob`, and has exactly one DB side effect (the initial `saveJob`) plus the queue publish.
- **Why this is the smallest safe boundary:** removing a redundant, racing write touches one method,
  changes no public signature, and deletes dead code — strictly less surface than introducing any
  new abstraction.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Add `version`/optimistic locking so the delayed update only writes if newer | Adds machinery to protect a write that should not exist; larger and still racy. |
| Convert the whole flow to a saga / state machine framework | Broad rewrite of a messy-but-working path; out of scope per challenge rules. |
| Have `delayedUpdate` re-fetch and merge before writing | Still a second writer racing the worker; complexity without need. |
| Make the worker emit an event the API waits on synchronously | Couples request latency to worker; changes public behavior and availability. |

## 6. Verification

- **Tests run:** `pnpm --filter legacy-app test` (characterization tests for #4521).
- **Command output:** captured in `solutions/test-evidence.md`.
- **Remaining risk:** the preliminary record now stays `PENDING` until the worker completes (no
  spurious "refresh"); consumers must treat `confidence: 0.3` as preliminary, which was already the
  intended contract. No customer-facing API shape changed.
