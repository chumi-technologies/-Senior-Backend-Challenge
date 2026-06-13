# Decision Log

> Required. Record semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | customer wallet balance (prepaid funds remaining) | wallet ledger | provider account balance / load-balancing weight |
| account | customer account (the paying team) | customer registry | provider account / upstream credential |
| usage | raw gateway usage event at official list price | usage/metering store | raw usage event / ledger entry / dashboard aggregate |
| total cost | official list-price total ($100) shown for reporting | usage report | official list price / customer payable amount |
| actual cost | payable amount actually debited to the wallet ($40) | ledger entry | deducted ledger amount / provider settlement amount |
| official cost | list-price cost before the prepaid multiplier ($100) | usage report | actual payable debit |
| provider balance | upstream provider account balance/credit | provider account API | customer wallet balance |
| load-balancing weight | ALB traffic weight ("balance" as routing) | rollout / ALB state | money / customer balance |
| ledger | append-only record of payable debits | ledger store | dashboard aggregate |
| prepaid multiplier | customer team package multiplier (0.4) | pricing config | provider discount |
| stable | ALB stable target group running the stable image | rollout state | Git branch / ALB stable target group / stable API contract |
| canary | ALB canary target group with public weight | rollout state | private shadow canary / public-traffic canary |

## Decision entries

### 2026-06-13 09:20 — Source of truth for customer balance vs official usage

- Context: the ticket conflates official usage cost ($100) with the wallet debit ($40).
- Decision: customer balance truth = ledger debit ($40 = $100 x 0.4); official usage reporting truth = raw usage at list price ($100); the dashboard is a derived view, never authoritative.
- Source of truth: ledger (balance); usage store (official reporting).
- Alternatives rejected: treating the dashboard aggregate as authoritative; rewriting debits to $100.
- Risk: relabeling copy could leak provider/internal terms — reviewed and excluded.
- Verification: assert ledger debit unchanged ($40), official usage unchanged ($100), provider balance and load-balancing weight untouched.

### 2026-06-13 09:30 — Scope of the prepaid multiplier

- Context: where should the 0.4 multiplier apply?
- Decision: the multiplier affects the ledger debit (payable) only; NOT raw usage events (official reporting stays at list price), NOT the underlying dashboard numbers (only the label/wording changes to distinguish the two).
- Source of truth: pricing config + ledger.
- Alternatives rejected: applying the multiplier to raw usage (corrupts reporting).
- Risk: none to the ledger; presentation only.
- Verification: a contract test keeps $100 and $40 distinct.

### 2026-06-13 09:35 — Do not rewrite history

- Context: should historical ledger entries be rewritten to "match" the label?
- Decision: no; past debits were correct; only forward-facing presentation changes.
- Source of truth: ledger (append-only / immutable).
- Alternatives rejected: backfill or rewrite of historical entries.
- Risk: data loss and broken audit trail if rewritten.
- Verification: no migration touches ledger rows; diff shows presentation-layer change only.

### 2026-06-13 11:10 — Analysis hot-path single writer

- Context: `createAnalysis` schedules a delayed write that overwrites the worker's completed result (ticket #4521 lost update).
- Decision: the worker's completed result is the source of truth for a job's demographics; the synchronous pre-compute is a placeholder only and must not be re-applied after the fact.
- Source of truth: worker `COMPLETED` write.
- Alternatives rejected: keeping the `setTimeout` "refresh"; adding locks/queues (over-engineered for this leak).
- Risk: if other callers depended on the delayed refresh — verified none do (it only rewrote the same pre-computed value).
- Verification: characterization test in `apps/legacy-app/test/bug-repro.spec.ts`.
