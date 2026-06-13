# AI Collaboration Log

> Required. Every AI assistant used for this challenge must append meaningful steps here. Do not replace this file with a summary at the end; preserve the chronological trail.

## Entry template

```md
## 2026-xx-xx HH:mm — Step title

### User prompt / intent
...

### AI action
...

### Files inspected
- ...

### Commands run
- ...

### Assumptions
- ...

### Human corrections / decisions
- ...

### Remaining risks
- ...
```

## 2026-06-13 10:00 — Project orientation

### User prompt / intent
"详细了解一下这个项目" — understand the repository in detail.

### AI action
Read challenge docs, source, ops state, and solution templates; produced a system-understanding summary: this is an interview challenge (HA AI Gateway drill), spec-driven, with intentionally overloaded billing/release terminology.

### Files inspected
- `README.md`, `AGENTS.md`, `CLAUDE.md`
- `docs/CHALLENGE_BILLING_SEMANTICS.md`, `docs/CHALLENGE_RELEASE_INTERRUPTION.md`
- `apps/legacy-app/src/analysis/analysis.service.ts`, `apps/worker-service/src/processors/analysis.processor.ts`
- `ops/current-rollout-state.json`, `ops/urgent-phase2-ticket.md`
- `scripts/verify-submission.ts`, all `solutions/*.md` templates

### Commands run
- `ls`, `find`, `grep` over the repo to map structure.

### Assumptions
- The challenge is graded on judgment + spec-driven workflow, not on volume of code.

### Human corrections / decisions
- Human confirmed they want a full submission and that this is a real interview submission, so visible human decision-making is required (scoring weight 25%).

### Remaining risks
- Must avoid over-generating code that the challenge explicitly discourages.

## 2026-06-13 10:30 — Key finding: billing incident has no code; the real bug is elsewhere

### User prompt / intent
"可以帮我解决这个问题吗" — help solve the challenge with the most correct answers.

### AI action
Searched the whole repo for billing/ledger/wallet/multiplier code. Found NONE — the billing "incident" (Part 1/2) is a pure semantic/spec exercise. Identified the actual runnable bug: `analysis.service.ts` schedules a `setTimeout(2000)` `delayedUpdate` that overwrites the Worker's real demographics with stale random pre-compute (the "data overwrite" of `bug-repro.spec.ts`). Proposed: treat Part 1 as display-only (don't touch money), classify `$100`/`$40` as both-correct, and make a surgical fix for the overwrite bug.

### Files inspected
- `apps/legacy-app/src/analysis/analysis.service.ts`, `apps/legacy-app/test/bug-repro.spec.ts`
- `apps/legacy-app/src/shared/database/database.service.ts`, `packages/shared-types/src/types.ts`
- `apps/worker-service/src/audience-integration/mock-auth-pool.ts` (the "load balance" trap)
- `debug-payloads/chaos-data-samples.json` (Part 5 data variety)

### Commands run
- `grep -rni -E "ledger|wallet|prepaid|multiplier|debit|balance|billing|cost"` over `apps`/`packages`/`scripts`.

### Assumptions
- `$40 = $100 × 0.4` is the intended discounted payable debit; the defect is the ambiguous dashboard label.

### Human corrections / decisions
- Human reviewed the proposed semantic rulings and release judgment and approved them, instructing "全部按最正确的答案修复" (fix everything with the most correct answers). Human accepted the recommendation to treat the billing incident as display-only and to keep the code change surgical; no semantic correction was needed, but the human explicitly owns the decision to NOT touch money/ledger.

### Remaining risks
- Test tooling (jest/@nestjs/testing) is not installed; needed a runner-agnostic characterization test.

## 2026-06-13 11:00 — Semantic foundation + spec (decision-log, spec, part1)

### AI action
Wrote `decision-log.md` (glossary + source-of-truth + key rulings), `spec.md` (current state, source-of-truth map, non-goals, blast radius, validation/release plan, AI review table), and `part1-billing-semantics.md` (classification = label/aggregate defect; multiplier affects only the debit; history not rewritten).

### Files inspected
- `solutions/decision-log.md`, `solutions/spec.md`, `solutions/part1-billing-semantics.md` (templates)

### Commands run
- none (authoring).

### Assumptions
- Provider balance and load-balancing weight are separate `balance`s and out of scope.

### Human corrections / decisions
- Human approved the display-only fix plan and the "do not rewrite ledger history" ruling.

### Remaining risks
- Display fix is described at the spec level since no dashboard code exists to edit.

## 2026-06-13 11:40 — Characterization test + surgical code fix (Part 4)

### AI action
Installed dependencies (`pnpm install`). Rewrote `bug-repro.spec.ts` as a dependency-free `tsx` characterization test (in-memory mocks, captured timer). Ran it against the buggy code → RED (worker result overwritten). Removed the `setTimeout`/`delayedUpdate` racing write in `analysis.service.ts`. Re-ran → GREEN. Added a `test:bug-repro` script and wrote `refactor-plan.md`.

### Files inspected
- `apps/legacy-app/src/analysis/analysis.service.ts`, `apps/legacy-app/test/bug-repro.spec.ts`, `apps/legacy-app/package.json`

### Commands run
- `pnpm install`
- `cd apps/legacy-app && tsx test/bug-repro.spec.ts` (before fix → exit 1; after fix → exit 0)

### Assumptions
- The Worker is the source of truth for full demographics; the create-path pre-compute must not overwrite it.

### Human corrections / decisions
- Human chose "most correct" fix; AI judged that for THIS challenge the most correct answer is the *smallest* one (delete the racing write) and explicitly deferred optimistic-locking as out-of-scope hardening — recorded in `refactor-plan.md`.

### Remaining risks
- Jest path remains unwired; evidence is the `tsx` run.

## 2026-06-13 12:10 — Release plan + scale plan + verification

### AI action
Wrote `release-command-log.md` and `part2-release-interruption.md` (freeze Phase 1, build urgent image C from stable A, keep phases separate, rollback target = stable A at every step, ledger-semantics smoke checks) and `scale-plan.md` (reject Rust/k8s, SQS shard fan-out, idempotent upsert, per-provider concurrency cap, backpressure, degrade/rollback). Ran `pnpm run verify:submission`.

### Files inspected
- `solutions/release-command-log.md`, `solutions/part2-release-interruption.md`, `solutions/scale-plan.md`
- `ops/current-rollout-state.json`

### Commands run
- `pnpm run verify:submission`
- `cd apps/legacy-app && tsx test/bug-repro.spec.ts` (final GREEN)

### Assumptions
- No live ALB/registry, so release commands are documented as dry-run shapes; no fabricated output.

### Human corrections / decisions
- Human approved basing the urgent patch on stable image A rather than the Phase 1 canary image B.

### Remaining risks
- Phase 1 still unverified and must be re-released separately later.
