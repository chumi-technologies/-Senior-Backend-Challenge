# Test & Command Evidence

> Real command output captured on 2026-06-20 with Node v20.20.2 and pnpm 8.15.0.
> The environment defaults to Node 16; run `nvm use` (`.nvmrc` → 20) first.

## 1. Characterization tests for ticket #4521 (the demographics race)

```bash
nvm use            # Node 20 (.nvmrc)
pnpm install
pnpm --filter legacy-app test
```

Output (after the fix — passing):

```text
PASS test/bug-repro.spec.ts
  Data Consistency (Bug Repro #4521)
    ✓ writes the job exactly once and performs no demographics write after publishing (10 ms)
    ✓ does not overwrite a worker-written COMPLETED result with stale preliminary data (1 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

## 2. Proof the tests actually characterize the bug (they fail on the original code)

The original `analysis.service.ts` (with `setTimeout(() => delayedUpdate(...), 2000)`) was restored
temporarily and the same suite re-run:

```text
FAIL test/bug-repro.spec.ts
    ✕ writes the job exactly once and performs no demographics write after publishing
    ✕ does not overwrite a worker-written COMPLETED result with stale preliminary data
Tests:       2 failed, 2 total
```

Restoring the fixed file makes both pass again (section 1). The tests fail for the right reason: the
original code performs a second, racing demographics write that overwrites the worker's `COMPLETED`
result with the stale preliminary estimate (`confidence: 0.3`).

## 3. Submission gate

```bash
pnpm run verify:submission
```

All 16 checks pass:

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

## 4. Workspace build

```bash
nvm use            # Node 20 (.nvmrc)
pnpm -r build
```

Output:

```text
Scope: 3 of 4 workspace projects
packages/shared-types build$ tsc
packages/shared-types build: Done
apps/worker-service build$ tsc
apps/legacy-app build$ nest build
apps/worker-service build: Done
apps/legacy-app build: Done
```

The worker and legacy app both build after declaring the shared-types workspace dependency where
it is imported.

## 5. Scope of the code change

```bash
git diff --stat apps/legacy-app/src/analysis/analysis.service.ts
# apps/legacy-app/src/analysis/analysis.service.ts | 32 +++++----------------
# 1 file changed, 10 insertions(+), 22 deletions(-)
```

Only the racing background write (and its now-unused helper) was removed. No public method
signature changed; the customer-facing API shape is unchanged.
