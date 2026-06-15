# Test & Verification Evidence

> Command output captured during the submission, not invented. Times use the repo clock (2026-06-15).

## 1. RED — inherited broken test harness (before fix)

The package declared `"test": "jest"` but jest was never installed, so the baseline test command failed before any assertion could run:

```text
> legacy-app@1.0.0 test /Users/keke/fsdownload/-Senior-Backend-Challenge/apps/legacy-app
> jest

sh: jest: command not found
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  legacy-app@1.0.0 test: `jest`
spawn ENOENT
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

Repair (dev-only): added `jest`, `ts-jest`, `@types/jest`, `@nestjs/testing` to `apps/legacy-app` devDependencies and added `apps/legacy-app/jest.config.js`. No runtime/production code was changed by the harness repair.

## 2. GREEN — characterization tests pass after the surgical fix

```text
> legacy-app@1.0.0 test
> jest

PASS test/bug-repro.spec.ts
  Data Consistency (Bug Repro #4521)
    DatabaseService.updateJobIfPending (status-guarded atomic update)
      ✓ puts the PENDING status guard inside the atomic update filter
      ✓ is a no-op (returns false) once the job is no longer PENDING
    AnalysisService delayed refresh
      ✓ persists a PENDING job and publishes an event on creation
      ✓ routes the delayed refresh through the guarded helper, never the unguarded updateJob

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        1.212 s
Ran all test suites.
```

Command: `pnpm --filter legacy-app test` — exit code 0.

These tests would be RED before the fix: tests 1–2 reference `DatabaseService.updateJobIfPending`, which did not exist; test 4 asserts the delayed refresh never calls the unguarded `updateJob`, which it did before the change.

## 3. Submission verifier — 17/17

```text
> senior-backend-challenge@1.0.0 verify:submission
> tsx scripts/verify-submission.ts

✅ solutions/spec.md: Found spec-driven triage before code.
✅ solutions/ai-collaboration-log.md: Found AI collaboration chronology.
✅ solutions/decision-log.md: Found semantic and source-of-truth decisions.
✅ solutions/release-command-log.md: Found release state and command timeline.
✅ solutions/part1-billing-semantics.md: Found billing semantic incident report.
✅ solutions/part2-release-interruption.md: Found interrupted rollout plan.
✅ solutions/refactor-plan.md: Found surgical refactor plan.
✅ solutions/scale-plan.md: Found scale plan under constraints.
✅ Spec content: Spec appears filled.
✅ AI log entries: Found 10 timestamped AI collaboration entries; expected at least 4.
✅ Human correction evidence: AI log must show where the human accepted, rejected, or corrected AI output.
✅ Semantic glossary: Semantic glossary covers overloaded terms.
✅ Release state evidence: Release log includes required state fields.
✅ Billing semantics report: Billing report appears filled.
✅ Interrupted rollout report: Rollout report appears filled.
✅ Surgical refactor plan: Refactor plan includes scope controls.
✅ Scale plan: Scale plan includes required operational controls.
```

Command: `pnpm run verify:submission` — 17/17 checks pass, exit code 0.

## 4. Scope of code change (surgical)

- `apps/legacy-app/src/shared/database/database.service.ts`: added `updateJobIfPending` (status guard inside the atomic `updateOne` filter).

- `apps/legacy-app/src/analysis/analysis.service.ts`: `delayedUpdate` now calls `updateJobIfPending` and logs via the NestJS `Logger`.

- Dev-only: `apps/legacy-app/package.json` (test devDeps), `apps/legacy-app/jest.config.js`, `apps/legacy-app/test/bug-repro.spec.ts`.

No changes to the worker, the billing/ledger logic, provider settlement, or ALB load-balancing weights.
