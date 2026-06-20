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
