# Senior Backend Engineer Challenge — High Availability AI Gateway Drill

> This challenge evaluates whether a senior backend engineer can keep a customer-facing gateway highly available while using AI tools responsibly. AI is allowed and expected. The goal is to see whether the candidate can guide AI, reject bad AI suggestions, write a spec before risky changes, and make small safe refactors inside a deliberately messy codebase.

## What this challenge is testing

This is **not** a generic CRUD or algorithm exercise. This repository intentionally contains ambiguous business language, legacy-style code, mixed responsibilities, and operational pressure.

We are looking for engineers who can:

- keep customers unaffected during urgent production changes
- define overloaded business terms before changing billing, routing, usage, or release logic
- use a spec-driven workflow instead of letting AI patch randomly
- identify and correct AI recommendations that would break high availability or financial semantics
- make small, surgical refactors in a messy hot path without rewriting the system
- design scale improvements under time and staffing constraints
- prove behavior with contract tests, command output, and release evidence

## Mandatory AI collaboration record

AI tools are allowed, but every meaningful AI step must be recorded in:

```text
solutions/ai-collaboration-log.md
```

The repo includes cross-IDE instructions for Codex, Claude, Cursor, Gemini, and Windsurf:

```text
AGENTS.md
CLAUDE.md
GEMINI.md
.cursor/rules/challenge.mdc
.windsurfrules
```

The collaboration log must show not just what AI suggested, but where the human accepted, rejected, or corrected the AI. A submission with no visible human correction or decision-making is a weak signal even if the code runs.

Before submitting, run:

```bash
pnpm run verify:submission
```

## Setup

```bash
nvm use
pnpm install
```

This repo intentionally keeps the service code small and messy. Do not spend your time rewriting the whole application. The most important artifacts are the spec, release plan, semantic decisions, tests, and narrowly scoped changes.

## Scenario

You have joined the backend team responsible for a multi-tenant AI gateway. The gateway serves customer traffic, records usage, displays prepaid usage cost, and is released through stable/canary traffic shifting.

A previous engineer left behind a fragile system with overloaded terminology:

- `balance` can mean customer wallet balance, upstream provider balance, or load-balancing weight.
- `usage` can mean raw gateway usage, ledger entry, or dashboard aggregate.
- `cost` can mean official list price, customer payable debit, or provider settlement.
- `stable` can mean stable API contract, stable ALB target group, or a Git branch.
- `account` can mean customer account, provider account, or upstream credential.

The codebase is intentionally messy. The challenge is not to build a new clean architecture. The challenge is to produce the smallest safe intervention while preserving high availability and customer trust.

## Required delivery order

You must complete the work in this order. Do not code first.

1. **Spec first** — complete `solutions/spec.md`.
2. **AI collaboration evidence** — maintain `solutions/ai-collaboration-log.md` continuously.
3. **Semantic decisions** — complete `solutions/decision-log.md` before touching ambiguous billing/release terms.
4. **Release command plan** — complete `solutions/release-command-log.md` before any release sequence.
5. **Small scoped code/test changes** — only if your spec justifies them.
6. **Scale and operational follow-up** — complete `solutions/scale-plan.md`.
7. **Final verification** — run `pnpm run verify:submission` and paste meaningful evidence.

## Part 1 — Spec-Driven Triage Under Ambiguity

### Prompt

A support escalation arrives:

```text
Acme Team has a QBR in 60 minutes.
Their dashboard shows Total usage cost: $100.00.
Their team prepaid wallet was debited $40.00.
The team prepaid multiplier is 0.4.
Sales says the customer will think we are inconsistent.
Finance says we may be undercharging.
Engineering says this might be a duplicate billing path.
Fix this urgently without causing customer-visible downtime.
```

### Your task

Complete `solutions/spec.md` before changing code.

The spec must include:

- current-state understanding
- source-of-truth map
- overloaded term glossary
- suspected root cause
- explicit non-goals
- blast radius
- validation plan
- release safety plan
- what AI suggested and what you rejected or corrected

### AI trap

AI will likely suggest making `$100` and `$40` match by changing billing math. That is usually wrong. A senior engineer should first distinguish official list-price usage from payable prepaid debit.

## Part 2 — Billing Semantics Incident

Detailed prompt: `docs/CHALLENGE_BILLING_SEMANTICS.md`

Complete:

```text
solutions/part1-billing-semantics.md
solutions/decision-log.md
```

You must answer:

- Is this a wrong debit, wrong label, wrong aggregate, double billing bug, or something else?
- Which object is the source of truth for customer balance?
- Which object is the source of truth for official usage reporting?
- Should the prepaid multiplier affect raw usage, ledger debit, dashboard labels, or all of them?
- Should historical ledger entries be rewritten?
- What tests prove provider balances and load-balancing weights were not touched?

### Red flags

- changing ledger debits to match dashboard labels without a semantic decision
- creating a second billing source of truth
- globally replacing `balance` with one meaning
- hard-coding Acme-specific behavior

## Part 3 — Interrupted Rollout: Urgent Phase 2 During Phase 1 Canary

Detailed prompt: `docs/CHALLENGE_RELEASE_INTERRUPTION.md`

Read:

```text
ops/current-rollout-state.json
ops/urgent-phase2-ticket.md
```

Complete:

```text
solutions/part2-release-interruption.md
solutions/release-command-log.md
```

You must decide:

- whether Phase 1 should be frozen
- whether the public canary can be updated in place
- whether the urgent patch should be based on stable image A or Phase 1 canary image B
- how to keep customers unaware of the transition
- what rollback target exists at every step
- what smoke checks prove billing semantics did not change

### Red flags

- updating a canary task while it has public traffic
- skipping ALB weight inspection
- merging Phase 1 and Phase 2 without dependency analysis
- treating “stable” as a Git branch when the context is traffic routing

## Part 4 — Surgical Refactor in a Messy Hot Path

The repository intentionally contains old challenge code and legacy-style service code. Treat it as the “shit mountain.” You are allowed to make only a small refactor if needed for your fix or tests.

Complete:

```text
solutions/refactor-plan.md
```

Rules:

- Do not rewrite the application.
- Do not introduce a parallel billing or release framework.
- Extract at most one focused helper/module unless your spec proves more is necessary.
- Preserve existing public behavior except the explicitly scoped fix.
- Add characterization tests before changing behavior when touching messy code.

The refactor plan must state:

- target file/function
- current responsibility leak
- extraction boundary
- old behavior locked by tests
- new behavior added
- why this is smaller than a rewrite

### AI trap

AI will often propose a broad clean architecture rewrite. That is a fail. We want the smallest safe change.

## Part 5 — Scale Plan Under Constraints

Complete:

```text
solutions/scale-plan.md
```

Scenario:

```text
An enterprise customer will upload 10GB CSV files every Monday at 9:00.
The file contains about 5 million rows.
They require analysis and reporting within 2 hours.
Current worker throughput is about 10 rows/second.
There is one backend engineer and two weeks to ship.
The CTO suggests rewriting the worker in Rust or moving everything to Kubernetes.
```

You must answer:

- What is the smallest architecture change that reaches the throughput target?
- What should not be rebuilt in two weeks?
- How do you shard work, cap concurrency, and preserve idempotency?
- How do you keep partial failures debuggable without flooding alerts?
- What is the rollback/degrade mode if the batch falls behind?

## Submission files

Required candidate-authored files:

```text
solutions/spec.md
solutions/ai-collaboration-log.md
solutions/decision-log.md
solutions/release-command-log.md
solutions/part1-billing-semantics.md
solutions/part2-release-interruption.md
solutions/refactor-plan.md
solutions/scale-plan.md
```

Optional but useful:

```text
solutions/test-evidence.md
```

## Scoring

| Dimension | Weight | What good looks like |
|---|---:|---|
| Spec-driven execution | 25% | Clear spec before code, explicit non-goals, source-of-truth map, validation plan |
| AI guidance and correction | 25% | Candidate catches AI semantic/release mistakes and records corrections |
| High availability release judgment | 20% | Correct stable/canary order, rollback targets, no customer-visible unsafe step |
| Semantic correctness | 15% | Billing/usage/balance/cost meanings are separated and preserved |
| Small refactor and scale thinking | 15% | Surgical change only, characterization tests, realistic 2-week scaling plan |

## Automatic submission check

Run:

```bash
pnpm run verify:submission
```

The script does not judge quality. It only checks that required evidence files exist and are not left as empty templates.

## FAQ

### Can I use AI?

Yes. You are expected to use AI. The question is whether you can guide it.

### Should I delete the old legacy code?

No. Treat it as messy inherited code. You may use it for small scoped tests or examples, but do not rewrite it just because it looks bad.

### Should I make a huge architecture cleanup?

No. A broad rewrite is a negative signal unless the spec proves it is required, which should be rare.

### What matters most?

High availability, semantic precision, human judgment over AI output, and small safe changes.
