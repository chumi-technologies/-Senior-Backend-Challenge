# Test Evidence

> Real command output from this session. Node 20, pnpm 8.15.

## 1. Submission gate

Command:

```bash
pnpm run verify:submission
```

Output (exit 0):

```text
✅ solutions/spec.md: Found spec-driven triage before code.
✅ solutions/ai-collaboration-log.md: Found AI collaboration chronology.
✅ solutions/decision-log.md: Found semantic and source-of-truth decisions.
✅ solutions/release-command-log.md: Found release state and command timeline.
✅ solutions/part1-billing-semantics.md: Found billing semantic incident report.
✅ solutions/part2-release-interruption.md: Found interrupted rollout plan.
✅ solutions/refactor-plan.md: Found surgical refactor plan.
✅ solutions/scale-plan.md: Found scale plan under constraints.
✅ Spec content: Spec appears filled.
✅ AI log entries: Found 12 timestamped AI collaboration entries; expected at least 4.
✅ Human correction evidence: AI log must show where the human accepted, rejected, or corrected AI output.
✅ Semantic glossary: Semantic glossary covers overloaded terms.
✅ Release state evidence: Release log includes required state fields.
✅ Billing semantics report: Billing report appears filled.
✅ Interrupted rollout report: Rollout report appears filled.
✅ Surgical refactor plan: Refactor plan includes scope controls.
✅ Scale plan: Scale plan includes required operational controls.
```

## 2. Characterization test (ticket #4521 lost-update fix)

Command:

```bash
pnpm --filter legacy-app test
```

### 2a. RED — with the racy `setTimeout` overwrite reintroduced (proves the test catches the bug)

Provenance: this RED output was captured live during this session by temporarily reintroducing the racy delayed `updateJob` call into `createAnalysis`, running the test, then reverting. It is intentionally NOT reproducible from the final tree (the race is removed). To reproduce, re-add a `setTimeout(() => this.databaseService.updateJob(jobId, { demographics: quickDemographics, updatedAt: ... }), 2000)` in `createAnalysis` and re-run.

```text
FAIL test/bug-repro.spec.ts
  Data Consistency (Bug Repro): single writer for job results
    ✓ persists the job once and publishes the analysis event once (3 ms)
    ✕ does NOT schedule a delayed write that overwrites the worker result (#4521) (1 ms)

    expect(jest.fn()).not.toHaveBeenCalled()
    Expected number of calls: 0
    Received number of calls: 1
    1: "<jobId>", {"demographics": {"ageRange": "35-44", "confidence": 0.3, "gender": "male", "location": "UK"}, ...}

Tests: 1 failed, 1 passed, 2 total
```

The received write carries the stale placeholder (`confidence: 0.3`) — exactly the worker-result overwrite reported in #4521.

### 2b. GREEN — after the fix (delayed overwrite removed)

```text
PASS test/bug-repro.spec.ts
  Data Consistency (Bug Repro): single writer for job results
    ✓ persists the job once and publishes the analysis event once (3 ms)
    ✓ does NOT schedule a delayed write that overwrites the worker result (#4521) (1 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

### 2c. Real-Mongo integration — cross-process lost update (the actual #4521 architecture)

Command (requires `docker compose up -d mongodb`):

```bash
pnpm --filter legacy-app test:integration
```

This test uses the REAL `DatabaseService` against a real MongoDB and two independent writers to the same `analysis_jobs` document: the request path (`createAnalysis` -> `saveJob`, PENDING + placeholder `confidence: 0.3`) and the worker path (`updateOne` -> COMPLETED + real demographics `confidence: 0.85`). It waits 2.5s — past the old 2000ms window — then reads the doc back from Mongo.

GREEN (after the fix):

```text
✅ Connected to MongoDB
PASS test/race-integration.int.spec.ts
  Lost-update race (REAL Mongo integration) — #4521
    ✓ worker COMPLETED result survives past the old 2000ms overwrite window (2526 ms)
Tests: 1 passed, 1 total
```

RED (race reintroduced — captured live, then reverted):

```text
FAIL test/race-integration.int.spec.ts
  ✕ worker COMPLETED result survives past the old 2000ms overwrite window (2516 ms)
    expect(received).toBe(expected)
    Expected: 0.85
    Received: 0.3
      at test/race-integration.int.spec.ts:75
Tests: 1 failed, 1 total
```

The RED proves the cross-process clobber is real and persisted: the worker's `confidence: 0.85` written to Mongo is overwritten back to the stale `0.3` placeholder by the delayed write, and read back from the database as `0.3`. This is the genuine #4521 lost update, not a mock proxy. The default `pnpm --filter legacy-app test` excludes `*.int.spec.ts`, so the unit suite still runs with no infra.

## 3. What the evidence proves

- The submission gate confirms all required artifacts exist and are not empty templates (the gate checks presence + structure, not quality).
- The red→green proves the fix is real: with the racy delayed write present the test fails on the overwrite; with it removed, `createAnalysis` persists once, publishes once, and no delayed write clobbers the worker's completed result.
- Billing semantics are untouched by the analysis-path fix: no ledger, provider-balance, or load-balancing-weight code is modified.

## 4. Baseline health (beyond the required gate)

The examiner flagged that the recursive baselines were not green. Both are now fixed and verified:

```bash
pnpm -r build   # exit 0 — shared-types builds first, then legacy-app (nest) + worker-service (tsc)
pnpm -r test    # exit 0 — legacy-app 2 passed; worker-service 12 passed
pnpm run verify:submission   # exit 0 — 17 green / 0 red
```

Root cause of the prior build break: `@senior-challenge/shared-types` was imported but never declared as a dependency and never built, so pnpm never linked it. Fix: declared it as `workspace:*` in both apps and built it (`packages/shared-types/dist`). This also clears the editor "cannot find module" diagnostic.

Worker-service now has a real characterization test instead of `--passWithNoTests`: `apps/worker-service/test/age-range.spec.ts` covers 12 age-bucket boundaries for the pure `calculateAgeRange` extraction.

```text
apps/worker-service test: PASS test/age-range.spec.ts
apps/worker-service test:   calculateAgeRange (worker age-bucket mapping)
apps/worker-service test:     ✓ maps age 10 to under-18
apps/worker-service test:     ✓ maps age 17 to under-18
apps/worker-service test:     ✓ maps age 18 to 18-24
apps/worker-service test:     ✓ maps age 24 to 18-24
apps/worker-service test:     ✓ maps age 25 to 25-34
apps/worker-service test:     ✓ maps age 34 to 25-34
apps/worker-service test:     ✓ maps age 35 to 35-44
apps/worker-service test:     ✓ maps age 44 to 35-44
apps/worker-service test:     ✓ maps age 45 to 45-54
apps/worker-service test:     ✓ maps age 54 to 45-54
apps/worker-service test:     ✓ maps age 55 to 55+
apps/worker-service test:     ✓ maps age 80 to 55+
```

Current remaining caveat: billing remains a tabletop semantic exercise because this repository intentionally has no billing / wallet / dashboard implementation to execute. The billing assertions are therefore source-of-truth and release-safety checks, not runnable billing tests.
