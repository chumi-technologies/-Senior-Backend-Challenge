# AI Collaboration Log

> Required. Every AI assistant used for this challenge must append meaningful steps here. Do not replace this file with a summary at the end; preserve the chronological trail.

## 2026-06-20 14:00 — Repo triage and bug localization

### User prompt / intent
Clone the challenge branch and complete the required deliverables; identify the real defect.

### AI action
Read README.md, AGENTS.md, CLAUDE.md, the docs/CHALLENGE_*.md prompts, ops state, every solution
template, and the application source. Concluded the repo has **no billing/ledger code** (grep for
ledger/balance/prepaid/debit/cost over `apps`/`packages`/`scripts` returned no implementation), so
the billing incident is a semantics/spec exercise, while the only real code defect is a race in
`analysis.service.ts`.

### Files inspected
- README.md, AGENTS.md, CLAUDE.md, docs/CHALLENGE_BILLING_SEMANTICS.md, docs/CHALLENGE_RELEASE_INTERRUPTION.md
- ops/current-rollout-state.json, ops/urgent-phase2-ticket.md
- apps/legacy-app/src/analysis/* , apps/worker-service/src/processors/analysis.processor.ts
- scripts/verify-submission.ts

### Commands run
- `git clone --branch codex/ai-release-challenge-hardening ...`
- `grep -rniE "ledger|balance|prepaid|multiplier|wallet|debit|cost" apps packages scripts`

### Assumptions
- Ticket #4521 ("data inconsistency") refers to the demographics overwrite, not billing.

### Human corrections / decisions
- Human directed: do **not** treat the billing incident as a code change — there is no billing code,
  so it is a semantic/spec deliverable. The code change is limited to the demographics race.
- Human confirmed scope: spec-first, smallest safe code change, no rewrite.

### Remaining risks
- Environment runs Node 16 by default; tests require Node 20 + pnpm 8.

## 2026-06-20 14:20 — Define overloaded billing terms before any change

### User prompt / intent
Write the semantic decisions before touching ambiguous terms.

### AI action
Drafted glossary separating `balance` (wallet vs provider vs load-balancing weight), `cost`
(official list price vs payable debit vs provider settlement), `usage` (raw event vs ledger vs
dashboard aggregate). Classified the incident as an ambiguous **dashboard label**, not a wrong
debit or double billing (`100 x 0.4 = 40` exactly).

### Files inspected
- docs/CHALLENGE_BILLING_SEMANTICS.md, ops/urgent-phase2-ticket.md

### Commands run
- none (analysis only)

### Assumptions
- The prepaid multiplier applies only to the payable debit, never to raw usage or official reporting.

### Human corrections / decisions
- AI initially proposed "make the dashboard show $40 so the numbers match." Human **rejected** this:
  it would corrupt Finance's official list-price usage source of truth. Corrected to a two-line
  labeled breakdown that preserves both numbers.
- Human **rejected** rewriting historical ledger entries; debits were already correct.

### Remaining risks
- Must prove provider balance and load-balancing weight are untouched.

## 2026-06-20 14:45 — Release judgment for the interrupted rollout

### User prompt / intent
Decide how to ship the urgent label fix during a live Phase 1 public canary.

### AI action
Recorded rollout state (stable 99 / canary 1, canary has public traffic, Phase 1 unpromoted). Built
a candidate-action decision table and a high-availability sequence.

### Files inspected
- ops/current-rollout-state.json, ops/urgent-phase2-ticket.md

### Commands run
- none (state read from ops JSON)

### Assumptions
- Phase 1 image B is unvalidated and modifies the same reporting code path.

### Human corrections / decisions
- AI first suggested "promote Phase 1 to ship faster." Human **rejected** — that promotes an
  unvalidated change to all customers under deadline pressure. Corrected to: freeze Phase 1, drain
  canary 1% → 0%, build Phase 2 from **stable image A**, validate at 0% then 1%, keep rollback =
  `phase0-a17f3d2`.

### Remaining risks
- 60-minute deadline may force deferring promotion; holding at validated canary is acceptable.

## 2026-06-20 15:05 — Surgical fix for the demographics race + characterization test

### User prompt / intent
Make the smallest safe code change and lock it with a test.

### AI action
Removed the `setTimeout(() => delayedUpdate(...), 2000)` and the now-unused `delayedUpdate` from
`createAnalysis`; established the worker as the single writer of final demographics. Replaced the
empty `bug-repro.spec.ts` scaffold with two characterization tests using in-memory fakes (no Mongo,
no Nest DI). Added a minimal ts-jest config to make the suite runnable.

### Files inspected / changed
- apps/legacy-app/src/analysis/analysis.service.ts (changed)
- apps/legacy-app/test/bug-repro.spec.ts (rewritten)
- apps/legacy-app/jest.config.js (added), apps/legacy-app/package.json (jest devDeps)

### Commands run
- `nvm install 20`, `corepack prepare pnpm@8.15.0 --activate`, `pnpm install`
- `pnpm --filter legacy-app test` (see solutions/test-evidence.md)

### Assumptions
- Adding jest/ts-jest is test infrastructure, not an application rewrite (the test script already
  referenced jest).

### Human corrections / decisions
- AI first proposed adding a `version` field + optimistic locking to guard the delayed write. Human
  **rejected**: this protects a write that should not exist. Corrected to deleting the racing write
  entirely (smaller and fully removes the race).

### Remaining risks
- Preliminary record stays `PENDING` until the worker completes; consumers must treat
  `confidence: 0.3` as preliminary (already the intended contract).

## 2026-06-20 15:30 — Scale plan and final verification

### User prompt / intent
Produce the two-week scale plan and run the submission check.

### AI action
Wrote `scale-plan.md` (shard 5M rows into ~1,000 SQS shards, ~150–200 idempotent consumers,
per-provider concurrency cap, DLQ, completion aggregator) and rejected the Rust/K8s rewrite. Ran
`pnpm run verify:submission`.

### Files inspected
- apps/worker-service/src/queue-poller.ts, debug-payloads/, failed-records/

### Commands run
- `pnpm run verify:submission` (output in solutions/test-evidence.md)

### Assumptions
- Bottleneck is I/O-bound provider fan-out, not CPU.

### Human corrections / decisions
- Human **accepted** the horizontal fan-out plan and the explicit "do not rewrite in Rust / do not
  migrate to K8s in two weeks" stance.

### Remaining risks
- Provider rate limits are the real ceiling; concurrency cap must be tuned against live limits.
