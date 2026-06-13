# Test & Command Evidence

> Real output from this environment. Release commands in `release-command-log.md` are dry-run shapes (no live ALB/registry); nothing fabricated.

## Setup

```text
$ pnpm install
devDependencies: + @types/node + concurrently + tsx + typescript
(app deps resolved under apps/*/node_modules)  Done in 3m 11s
```

## Characterization test — analysis-overwrite bug (ticket #4521)

Runner-agnostic test (`apps/legacy-app/test/bug-repro.spec.ts`) executed with `tsx`
(`pnpm --filter legacy-app test:bug-repro`). It captures the scheduled timer so it is
deterministic and does not wait 2 real seconds.

### Before the fix — RED (bug reproduced)

```text
$ tsx test/bug-repro.spec.ts   # exit 1
❌ FAIL: Worker demographics were overwritten by stale pre-compute.
   Got: {"ageRange":"35-44","gender":"female","location":"US","confidence":0.3}
```

The Worker's real result (`confidence: 0.85`, interests `["fashion","travel"]`) was
clobbered by the create-path pre-compute (`confidence: 0.3`, random fields).

### Fix

`apps/legacy-app/src/analysis/analysis.service.ts`: removed the
`setTimeout(2000) -> delayedUpdate(jobId, quickDemographics)` racing write and the now-dead
`delayedUpdate` method. No other behavior changed.

### After the fix — GREEN

```text
$ tsx test/bug-repro.spec.ts   # exit 0
✅ PASS: worker demographics are preserved (no stale overwrite)
```

## Submission verification

```text
$ pnpm run verify:submission     # exit 0 — 17/17 checks
✅ solutions/spec.md ... ✅ Spec content
✅ AI log entries: Found 6 timestamped entries; expected at least 4
✅ Human correction evidence
✅ Semantic glossary / Release state evidence
✅ Billing semantics report / Interrupted rollout report
✅ Surgical refactor plan / Scale plan
```

## What was deliberately NOT changed (evidence of restraint)

- No billing/ledger/wallet code added (none exists; Part 1 is resolved at the semantic/display level).
- No change to provider balances, provider settlement, or load-balancing / auth-pool weights.
- No promotion or in-place mutation of the public Phase 1 canary.
- No rewrite of the worker/analysis pipeline beyond the one-line overwrite fix.
