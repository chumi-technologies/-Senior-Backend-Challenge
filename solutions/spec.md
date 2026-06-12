# Spec — High Availability Urgent Change

> Complete this before modifying code.

## 1. Current-state understanding

- Customer-facing symptom: Acme Team's dashboard shows `Total usage cost: $100.00` while their team prepaid wallet was debited `$40.00`. The customer reads the dashboard label as "amount deducted from my wallet", so the two numbers look contradictory. QBR in 60 minutes.
- Affected customer / surface: Acme Team (team prepaid package, multiplier `0.4`). Surface is the customer-facing dashboard usage-cost display only. No money-movement path has produced evidence of being wrong.
- Current release state (evidence: `ops/current-rollout-state.json`): stable `phase0-a17f3d2` at ALB weight 99 (desired 2); canary `phase1-b93c1a8` at weight 1 **with public traffic**, desired 1, Phase 1 not promoted, maintenance jobs disabled on canary. Urgent patch deadline 60 minutes.
- Known constraints (evidence: `ops/urgent-phase2-ticket.md`): no customer-visible API downtime; do not mutate ledger semantics to make labels match; do not create a second billing source of truth; justify any canary update against the observed traffic state; preserve a clear rollback target; record every release decision.

## 2. Source-of-truth map

```text
Request / usage event
  -> usage metering store (raw usage events, list-price valuation)    [source of truth: official usage]
       -> dashboard "usage" aggregate (READ MODEL, derived, NOT a source of truth)
  -> billing engine applies team prepaid multiplier (0.4) once, at debit time
       -> ledger debit entry (official $100 x 0.4 = $40)              [source of truth: payable debit]
            -> customer prepaid wallet balance (sum of ledger entries) [source of truth: wallet balance]

Separate, unrelated namespaces that reuse the same words:
  provider account balance  (our spend at the upstream provider)       [provider settlement, not customer money]
  load-balancing weight     (ALB stable/canary traffic weights)        [release plumbing, not money]
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | prepaid wallet ledger (sum of debit/credit entries) | wallet panel / wallet history API | append-only ledger writes by the billing engine | provider balance / load-balancing weight |
| official usage cost | raw usage events valued at list price in the metering store | usage report / dashboard aggregate | metering pipeline (append-only) | payable debit |
| payable prepaid debit | ledger debit entries (official x team multiplier, applied once at debit time) | wallet history / billing statement | billing engine debit path | official list price |
| release stable | ALB stable target group currently serving weight 99 (`phase0-a17f3d2`) | `ops/current-rollout-state.json` / ALB describe | release pipeline | Git branch named stable |
| canary | ALB canary target group at weight 1 with `canaryHasPublicTraffic: true` (`phase1-b93c1a8`) | `ops/current-rollout-state.json` | release pipeline | private shadow canary vs public canary |

## 3. Root-cause hypotheses before code

1. **(Primary) Wrong dashboard label; money paths correct.** `$100.00 x 0.4 = $40.00` — the two numbers are arithmetically self-consistent as two *different* concepts: official list-price usage ($100) and payable prepaid debit ($40). The dashboard shows the official aggregate under a label ("Total usage cost") that customers read as the wallet deduction. The Phase 2 ticket's own observed example ("Official list-price usage: $100.00 / Payable prepaid debit: $40.00") names both concepts explicitly.
2. **Undercharge (wrong debit).** Refuted by arithmetic: the debit equals exactly official x contract multiplier. An undercharge would show debit < official x 0.4.
3. **Double billing path.** Refuted by observed data: a duplicate debit path would produce *extra* wallet debits (e.g., $40 + $40 or $40 + $100), not a single $40 debit. Confirmed further by counting ledger debit entries per usage window in the validation plan.

## 4. Non-goals

- No change to ledger semantics, debit amounts, or the multiplier application point.
- No rewrite of historical ledger entries (the append-only audit record stays untouched).
- No change to provider account balances, provider credentials, or load-balancing weights.
- No in-place modification or promotion of the Phase 1 canary (`phase1-b93c1a8`).
- No second billing source of truth (the dashboard must *read* payable from the ledger, never recompute it).
- No broad rewrite of the legacy analysis service; only the surgically scoped fix + characterization tests in Part 4.

## 5. Blast radius

- Affected endpoints: dashboard usage-cost read model / display layer only.
- Affected customer-facing display: the usage-cost label; a second, explicitly labeled "prepaid debit" line is added so each real concept has its own label.
- Affected billing / ledger behavior: none — the change is read-only with respect to money movement.
- Affected provider / routing behavior: none — provider balances and ALB weights are out of scope and protected by checks.
- Affected release state: one fresh canary cycle based on stable image A; Phase 1 canary frozen and drained (see `solutions/release-command-log.md`).
- Metadata leakage risk: the fix must only expose the customer's own contract multiplier (0.4), never provider settlement prices or internal routing/account metadata.

## 6. Validation plan

- Characterization tests: before touching legacy code (Part 4), lock current `AnalysisService.createAnalysis` behavior with mocked DB/queue (job persisted once as PENDING with quick demographics, exactly one event published) — `apps/legacy-app/test/bug-repro.spec.ts`.
- Contract tests: (a) ledger debit invariant `debit == official x multiplier`; (b) replaying the same usage-event id produces exactly one ledger debit (idempotent retry, no double debit); (c) provider balance records and load-balancing weight config are identical before/after the deploy.
- Smoke checks: official usage report still shows `$100.00`; wallet history still shows a single `$40.00` debit; new label strings render on the canary; error rate and latency on canary within baseline.
- Release checks: ALB weights match the planned value at every step in `solutions/release-command-log.md`; rollback target (stable image A) reachable in one traffic-shift action at all times.
- Evidence to paste into final report: baseline failing test output, post-fix passing test output, `pnpm run verify:submission` output (collected in `solutions/test-evidence.md`).

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| Make the dashboard show $40 by multiplying the official aggregate by 0.4 at read time | Rejected | Creates a second derived billing number; payable must be read from the ledger, never recomputed in the presentation layer — recomputation double-applies the multiplier the day the ledger logic changes. |
| Rewrite historical ledger entries so history matches the new display | Rejected | The ledger is the audit source of truth; rewriting history corrupts reconciliation and customer trust. The incident is a labeling problem, not a money problem. |
| Patch the Phase 1 canary in place since it already touches dashboard labels | Rejected | The canary carries public traffic; an in-place update ships unvalidated Phase 1 + Phase 2 changes together with no isolated rollback target. The urgent patch bases on stable image A. |
| Display both numbers with explicit labels: official usage (list price) and prepaid debit (read from ledger) | Accepted | Two real concepts get two clearly labeled numbers; zero change to money paths; smallest customer-visible fix that ends the confusion. |
| Delete the legacy delayed-refresh write path entirely while in the file | Modified | Out of scope for the urgent change; handled in Part 4 as a guarded, characterization-tested minimal change instead of an outright deletion (see `solutions/refactor-plan.md`). |
