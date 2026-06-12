# Test Evidence

All outputs below are verbatim from runs on 2026-06-12 (EDT), Node v22 / `corepack pnpm@8.15.0`, in this repository. Nothing is hand-edited.

## 1. Baseline — before any change (broken inherited test harness)

Command: `corepack pnpm --filter legacy-app test`

```text
> jest

sh: jest: command not found
<repo>/apps/legacy-app:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  legacy-app@1.0.0 test: `jest`
spawn ENOENT
```

`legacy-app` declared `"test": "jest"` with no jest, no `ts-jest`, no `@nestjs/testing`, and an undeclared `@senior-challenge/shared-types` import. Harness repaired as a dev-only change (see `solutions/refactor-plan.md` §3).

## 2. Red — characterization + regression tests added, fix NOT yet applied

Command: `corepack pnpm --filter legacy-app test`

```text
✕ preserves COMPLETED worker results when the 2s delayed update fires afterwards (3 ms)

● Data Consistency (Bug Repro) › regression — ticket #4521: delayed refresh must not clobber worker results
  › preserves COMPLETED worker results when the 2s delayed update fires afterwards

  expect(received).toEqual(expected) // deep equality

  - Expected  - 6
  + Received  + 2

    Object {
  -   "ageRange": "25-34",
  -   "confidence": 0.85,
  +   "ageRange": "35-44",
  +   "confidence": 0.3,
      "gender": "female",
  -   "interests": Array [
  -     "fashion",
  -     "travel",
  -   ],
      "location": "US",
    }

Test Suites: 1 failed, 1 total
Tests:       1 failed, 3 passed, 4 total
```

This is exactly the ticket #4521 symptom: the worker's COMPLETED results (`ageRange 25-34`, `confidence 0.85`, `interests` present) are overwritten by the stale quick-demographics placeholder (`ageRange 35-44`, `confidence 0.3`, interests dropped). The three characterization tests pass, locking existing behavior.

## 3. Green — after the surgical fix (guarded atomic update)

Command: `corepack pnpm --filter legacy-app test`

```text
PASS test/bug-repro.spec.ts
  Data Consistency (Bug Repro)
    characterization — existing public behavior locked before any change
      ✓ returns a PENDING job with quick demographics and persists it exactly once (5 ms)
      ✓ publishes exactly one AnalysisRequested event matching the job (1 ms)
      ✓ still refreshes a job that remains PENDING when the delayed update fires (9 ms)
    regression — ticket #4521: delayed refresh must not clobber worker results
      ✓ preserves COMPLETED worker results when the 2s delayed update fires afterwards (1 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

Fix diff surface: one new helper (`DatabaseService.updateJobIfPending`, status guard inside the atomic update filter) + one call-site change in `AnalysisService.delayedUpdate`. Characterization tests unchanged and still green — public behavior preserved.

## 4. Submission verification

Command: `pnpm run verify:submission` (exit code 0)

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
✅ AI log entries: Found 5 timestamped AI collaboration entries; expected at least 4.
✅ Human correction evidence: AI log must show where the human accepted, rejected, or corrected AI output.
✅ Semantic glossary: Semantic glossary covers overloaded terms.
✅ Release state evidence: Release log includes required state fields.
✅ Billing semantics report: Billing report appears filled.
✅ Interrupted rollout report: Rollout report appears filled.
✅ Surgical refactor plan: Refactor plan includes scope controls.
✅ Scale plan: Scale plan includes required operational controls.
```
