# Decision Log

> Required. Record semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | Customer wallet balance is money owed/available for a tenant. Provider balance and load-balancing weight are separate meanings. | Customer wallet ledger; provider account system; routing config. | Provider balance, load-balancing weight, upstream quota. |
| account | Customer account is the billed tenant/team. Provider account is our upstream vendor account. Credential is the key/token used for upstream calls. | Customer account store; provider config/billing system; credential store. | Customer account vs provider account vs upstream credential. |
| usage | Raw usage is metered gateway activity. Ledger usage is the financial entry. Dashboard usage is a read model. | Raw usage events; customer wallet ledger; reporting projection. | Raw usage event vs ledger entry vs dashboard aggregate. |
| cost | Official/list-price cost, customer payable debit, and provider settlement are different values. | Rate-card reporting; wallet ledger; provider billing. | Official cost vs actual debit vs provider settlement. |
| total cost | In this incident, likely official list-price usage: `$100.00`. | Raw usage events plus official rate card. | Customer payable amount. |
| actual cost | In this incident, the prepaid wallet debit: `$40.00`. | Customer wallet ledger debit. | Official usage reporting or provider settlement. |
| prepaid | Customer package multiplier; here `0.4`. | Customer contract/package config. | Provider discount. |
| stable | Promoted customer-serving deployment when release work is in scope. | Rollout/load balancer state. | Git branch or API stability. |
| canary | Candidate deployment receiving configured traffic. | Rollout/load balancer state. | Private shadow canary. |

## Decision entries

### 2026-06-13 17:02 — Part 1 billing semantics

- Context: Acme sees `Total usage cost: $100.00`; prepaid wallet debit is `$40.00`; prepaid multiplier is `0.4`.
- Decision: Treat this as a dashboard wording/read-model issue unless new evidence shows a ledger or contract bug. Preserve `$100.00` as official list-price usage and `$40.00` as wallet debit.
- Source of truth: Customer balance comes from the wallet ledger. Official usage reporting comes from raw usage events plus the official rate card. The prepaid multiplier applies to the payable debit.
- Rejected: rewriting historical ledger entries, changing official usage to `$40.00`, changing wallet debit to `$100.00`, adding another billing source of truth, or touching provider/routing state.
- Risk: `Total usage cost` is ambiguous in a prepaid-wallet context.
- Verification: Check official usage remains `$100.00`, wallet debit remains `$40.00`, customer balance changes by `$40.00`, provider balances and load-balancing weights are unchanged, and retry does not double debit.

### 2026-06-13 17:48 — Phase 2 urgent patch base

- Context: Phase 1 is live as public canary at 1% traffic, still observing, and not promoted. Its change area is prepaid usage reporting labels and dashboard aggregation. Phase 2 is an urgent display fix in the same business area.
- Decision: Freeze Phase 1 and base the urgent Phase 2 patch on stable image `registry.example.com/gateway:phase0-a17f3d2`, not canary image `registry.example.com/gateway:phase1-b93c1a8`.
- Source of truth: Rollout state comes from `ops/current-rollout-state.json`; billing display semantics come from the Part 1 decision.
- Rejected: promoting Phase 1 during the incident, updating the public canary in place while it has traffic, or combining Phase 1 and Phase 2 into one release candidate.
- Risk: Basing Phase 2 on Phase 1 would mix two variables in the same dashboard/prepaid area and make rollback/debugging unclear.
- Verification: Confirm stable A can handle 100% traffic, keep canary maintenance jobs disabled, verify no billing/backfill/migration/aggregation writers run on canary, shift Phase 1 public traffic to zero before replacing it, smoke Phase 2 for availability and unchanged billing semantics, and keep stable A as rollback target.

### 2026-06-13 18:58 — Part 4 delayed demographics overwrite

- Context: `legacy-app` saves a new analysis job with quick, low-confidence demographics and status `PENDING`, publishes an event for `worker-service`, then schedules a delayed quick-demographics refresh. The worker may complete first and write higher-confidence demographics with status `COMPLETED`.
- Decision: Treat the MongoDB `analysis_jobs.status` field as the source of truth for write ownership. The delayed quick refresh may update only jobs that are still `PENDING`; it must not overwrite worker-owned `PROCESSING`, `COMPLETED`, or `FAILED` states.
- Source of truth: The persisted `analysis_jobs` document, especially `jobId`, `status`, `demographics`, and timestamps. Worker-completed demographics are authoritative once the job leaves `PENDING`.
- Rejected: removing the quick preliminary result, removing the worker pipeline, adding broad worker recovery/replay infrastructure, or using timing assumptions to decide which demographics win.
- Risk: A non-atomic read-then-write check could still race with the worker; the status check must be part of the database update predicate.
- Verification: Add a fake-timer regression test proving the delayed quick refresh does not overwrite a completed result, and assert the database helper performs an atomic `{ jobId, status: expectedStatus }` update.
