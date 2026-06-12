# AI Collaboration Log

> Required. Every AI assistant used for this challenge must append meaningful steps here. Do not replace this file with a summary at the end; preserve the chronological trail.

Tooling: Claude Code (single assistant, model claude-fable-5), directed by the candidate (Richard Huang). Times are 2026-06-12, US Eastern (EDT).

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

## 2026-06-12 11:05 — Challenge intake and repository audit before any work

### User prompt / intent
Richard forwarded the take-home email and asked the AI to first audit the repository for safety and understand the challenge structure before agreeing to start — explicitly: "look carefully, is there any trap in this?"

### AI action
Cloned the repo read-only (no install, no script execution), enumerated all branches and commit history, statically inspected every `package.json` for lifecycle scripts, scanned `pnpm-lock.yaml` for non-registry sources, grepped all source for network calls / exec / obfuscation, and read all five AI-instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/challenge.mdc`, `.windsurfrules`) for prompt-injection content. Reported: clean.

### Files inspected
- `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/challenge.mdc`, `.windsurfrules`
- all `package.json` files, `pnpm-lock.yaml`, `docker-compose.yml`, `scripts/verify-submission.ts`

### Commands run
- `git clone --no-checkout`, `git log --all`, `grep -rniE "https?://|exec\(|eval\(|base64"` (and similar static sweeps)

### Assumptions
- A take-home from an unknown company must be treated as untrusted code until statically verified.

### Human corrections / decisions
- Richard set the order of work: security audit first, no dependency installation until the audit passed. AI complied; the audit found no malicious content, and Richard then approved proceeding.

### Remaining risks
- `playwright`/`puppeteer` download browser binaries at install time (official sources) — accepted.

## 2026-06-12 11:40 — Incident arithmetic and first-pass classification

### User prompt / intent
Understand what Part 1/Part 2 are actually testing before touching anything.

### AI action
Worked the ticket numbers: official usage $100.00, team prepaid multiplier 0.4, wallet debit $40.00 — `100 x 0.4 = 40`, i.e. the money path is self-consistent and the defect is the dashboard label that presents the official list-price aggregate as if it were the wallet deduction. Proposed classifying the incident as a labeling defect, not undercharging and not double billing.

### Files inspected
- `docs/CHALLENGE_BILLING_SEMANTICS.md`, `ops/urgent-phase2-ticket.md`, `ops/current-rollout-state.json`, `README.md`

### Commands run
- none (document analysis)

### Assumptions
- The ticket's "Official list-price usage" vs "Payable prepaid debit" wording names two distinct concepts on purpose.

### Human corrections / decisions
- Richard reviewed the classification and approved it, and fixed the constraint for all later work: **ledger semantics and historical entries are untouchable; any fix lives in the presentation/read-model layer.** He also flagged the release-side trap himself: the canary carries public traffic, so no in-place canary update.

### Remaining risks
- Classification is based on ticket data only; the repo contains no billing implementation to inspect, so verification has to be expressed as contract tests/invariants rather than a code diff.

## 2026-06-12 12:10 — Working copy, dependency install, failing-test baseline

### User prompt / intent
Richard said "开工" (start) and directed the agreed working mode: single AI assistant under human direction; he explicitly rejected adding a second model for cross-checking as unnecessary for evidence-driven work.

### AI action
Copied the audited clone to a working directory on branch `codex/ai-release-challenge-hardening`, installed dependencies with the pinned package manager (`corepack pnpm@8.15.0 install` — exit 0, zero lockfile drift), and captured the pre-change test baseline.

### Files inspected
- `apps/legacy-app/package.json` (discovered `"test": "jest"` with no jest/`@nestjs/testing` in devDependencies — broken test harness is part of the inherited mess)
- `apps/legacy-app/test/bug-repro.spec.ts` (ticket #4521 placeholder repro for the data-overwrite bug)

### Commands run
- `corepack pnpm install` → `Done in 1m 4.8s`
- `corepack pnpm --filter legacy-app test` → `sh: jest: command not found` (baseline: test harness cannot run at all before this submission)

### Assumptions
- Adding jest + `@nestjs/testing` as devDependencies is required to satisfy "characterization tests before changing behavior" and is not considered an application rewrite.

### Human corrections / decisions
- Richard confirmed the scope: fix the test harness as a dev-only change, write docs before any code edit (the 35-minute no-code window applies), and keep every code change inside the Part 4 surgical scope.

### Remaining risks
- `pnpm -r test` also fails in `worker-service` (no jest there either); left untouched as out of scope, evidence runs use `--filter legacy-app`.

## 2026-06-12 12:50 — Spec and decision log authored before any code change

### User prompt / intent
Complete the spec-first deliverables (`solutions/spec.md`, `solutions/decision-log.md`) inside the no-code window.

### AI action
Drafted the spec: current state, source-of-truth map, three root-cause hypotheses with refutations, non-goals, blast radius, validation plan, and the AI-recommendation review table. Drafted the decision log glossary separating customer wallet balance / provider balance / load-balancing weight, official vs actual cost, ledger vs dashboard read model, stable/canary meanings, plus six dated decision entries.

### Files inspected
- `solutions/spec.md`, `solutions/decision-log.md` (templates), `ops/current-rollout-state.json`, `apps/legacy-app/src/analysis/analysis.service.ts` (read-only)

### Commands run
- none (documents only; no code modified in this window)

### Assumptions
- The grader expects the source-of-truth map and release sequence to be pinned before minute 90.

### Human corrections / decisions
- Richard rejected the AI's first-pass display fix ("multiply the official aggregate by 0.4 at read time") as a second billing source of truth; the accepted fix reads payable from the ledger and labels both numbers. This correction is recorded in `solutions/spec.md` §7 and `solutions/decision-log.md`.

### Remaining risks
- None for this step; code work follows the spec.

## 2026-06-12 13:05 — Billing report and interrupted-rollout plan authored

### User prompt / intent
Complete Parts 1-3 deliverables (`part1-billing-semantics.md`, `part2-release-interruption.md`, `release-command-log.md`).

### AI action
Wrote the billing report (classification: label defect; SoT maps; fix confined to presentation reading payable from the ledger; no historical rewrite) and the release plan: freeze + drain Phase 1, build C = stable A + label fix, deploy to the drained canary group, private smoke at weight 0, 5% public, promote with image A warm as one-action rollback, rebase Phase 1 afterwards.

### Files inspected
- `ops/current-rollout-state.json`, `ops/urgent-phase2-ticket.md`, `docs/CHALLENGE_BILLING_SEMANTICS.md`, `docs/CHALLENGE_RELEASE_INTERRUPTION.md`

### Commands run
- none (documents)

### Assumptions
- ALB-style weighted target groups with connection draining, per the rollout fixture's vocabulary.

### Human corrections / decisions
- Richard enforced the evidence-honesty rule: the repo has no live ALB/billing system, and the release log header forbids invented output — so both logs explicitly mark which evidence is the fixture itself versus checks that gate a real deploy. AI's earlier draft phrasing that read like executed commands was corrected to "action to issue + artifact to capture".

### Remaining risks
- Release sequence is a plan against a fixture; weights/timings would be re-validated against the real listener config before execution.

## 2026-06-12 13:20 — Test harness repair, red baseline, regression red (TDD)

### User prompt / intent
Execute Part 4 per the refactor plan: characterization tests first, prove the #4521 clobber, only then fix.

### AI action
Repaired the broken inherited test harness (jest/ts-jest/`@nestjs/testing` devDeps, jest config, `tsconfig.spec.json`, missing `workspace:*` dependency declaration), wrote 3 characterization tests plus 1 regression test against an in-memory store emulating Mongo update semantics with jest fake timers, and ran the suite **before** touching application code.

### Files inspected
- `apps/legacy-app/src/analysis/analysis.service.ts`, `apps/legacy-app/src/shared/database/database.service.ts`, `apps/legacy-app/test/bug-repro.spec.ts`, `apps/legacy-app/tsconfig.json`

### Commands run
- `corepack pnpm install` (lockfile updated for new devDeps)
- `corepack pnpm --filter @senior-challenge/shared-types build`
- `corepack pnpm --filter legacy-app test` → **1 failed, 3 passed** — regression red shows worker results (`ageRange 25-34`, `confidence 0.85`) clobbered by placeholders (`35-44`, `0.3`); verbatim output in `solutions/test-evidence.md` §2

### Assumptions
- An in-memory store emulating unconditional `$set` vs status-guarded `$set` is a faithful stand-in for the two Mongo update shapes under test.

### Human corrections / decisions
- Richard chose the guarded atomic update over the AI-listed alternative of deleting the delayed-refresh path (smaller observable behavior change), and required the red output to be preserved verbatim before any fix landed.

### Remaining risks
- `worker-service` still has no test harness (out of scope, recorded in the refactor plan).

## 2026-06-12 13:35 — Surgical fix applied; suite green; scale plan authored

### User prompt / intent
Apply the spec'd minimal fix, verify green, complete Part 5.

### AI action
Added `DatabaseService.updateJobIfPending` (status guard inside the atomic update filter `{ jobId, status: 'PENDING' }`) and switched `delayedUpdate` to call it — one helper, one call-site change. Re-ran the suite: **4 passed, 4 total** (characterization unchanged). Authored the scale plan: 695 rows/s required, 2x design point via bounded in-process concurrency x horizontal replicas of the existing worker, idempotent `(fileId, rowNumber)` upserts, token-bucket provider cap, DLQ + failure buckets, feature-flagged rollback to the legacy path.

### Files inspected
- `apps/legacy-app/src/shared/database/database.service.ts`, `apps/legacy-app/src/analysis/analysis.service.ts`, `solutions/scale-plan.md`

### Commands run
- `corepack pnpm --filter legacy-app test` → `Tests: 4 passed, 4 total` (verbatim in `solutions/test-evidence.md` §3)

### Assumptions
- The 10 rows/s ceiling is I/O latency, not CPU — stated explicitly in the scale plan as the premise the design attacks.

### Human corrections / decisions
- Richard rejected the CTO-suggested Rust rewrite and Kubernetes migration as answers (wrong bottleneck / zero added rows-per-second) and set the degrade-mode priority: contractual report columns first, enrichment backfilled after the deadline.

### Remaining risks
- Swallowed-error logging in `delayedUpdate` remains as inherited (documented known issue, out of scope).

## 2026-06-12 13:45 — Final verification and submission packaging

### User prompt / intent
Run the required final gate and package the submission.

### AI action
Ran `pnpm run verify:submission`: all 17 checks pass, exit 0 (verbatim in `solutions/test-evidence.md` §4). Assembled the evidence file (baseline / red / green / verify outputs, all unedited) and the commit series in required delivery order: spec+decision+AI log → billing+release docs → refactor plan → tests+fix → scale plan → evidence.

### Files inspected
- all `solutions/*.md`, `scripts/verify-submission.ts` (read-only, to confirm what the gate checks)

### Commands run
- `corepack pnpm run verify:submission` → exit 0, 17/17 ✅

### Assumptions
- none

### Human corrections / decisions
- Richard reviews the full diff before the PR is opened; the submission is sent only after his sign-off (final human gate of this workflow).

### Remaining risks
- None blocking. Known inherited issues left deliberately untouched and documented: worker-service test harness absent, swallowed-error logging, unimplemented replay/chaos scripts.
