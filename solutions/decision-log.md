# Decision Log

> Required. Record semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | A loaded term that must be split by context: customer wallet balance, provider account balance, or load-balancing weight | Customer wallet: ledger-backed prepaid balance. Provider balance: provider account records. Load balance: rollout/routing configuration | provider account balance / load-balancing weight / customer wallet |
| account | Could mean the customer tenant that owns prepaid usage, the provider billing account, or an upstream credential used to call another system | Customer account identity comes from tenant/customer records; provider account identity is separate operational metadata | customer account / provider account / upstream credential |
| usage | Must be separated into raw gateway usage event, ledger debit derived from usage, and dashboard aggregate derived from reporting | Raw usage events for official reporting; ledger entries for wallet debits | raw usage event / ledger entry / dashboard aggregate |
| total cost | In this incident, the phrase most likely refers to official list-price usage before prepaid multiplier is applied | Official usage reporting aggregate | official list price / customer payable amount |
| actual cost | The customer-payable debit applied to the prepaid wallet after multiplier rules; not provider settlement | Customer ledger debit / wallet deduction | deducted ledger amount / provider settlement amount |
| stable | The current stable production image and ALB stable target group carrying 99% of public traffic | `ops/current-rollout-state.json` and release controls | Git branch / ALB stable target group / stable API contract |
| canary | The public canary deployment carrying non-zero real user traffic | `ops/current-rollout-state.json` and release controls | private shadow canary / public traffic canary |

## Decision entries

### 2026-06-13 12:10 — Separate official usage from payable debit

- Context: The incident ticket shows `Total usage cost: $100.00` while the wallet debit is `$40.00` and multiplier is `0.4`. The same word "cost" is being used for at least two financial meanings.
- Decision: Treat official list-price usage and customer-payable prepaid debit as separate concepts until code evidence proves otherwise. Do not force them to match by changing ledger behavior.
- Source of truth: Official usage comes from raw usage events aggregated at list price; payable debit comes from ledger-backed wallet deductions after multiplier application.
- Alternatives rejected: Treating the mismatch as automatic evidence of double billing; rewriting historical debits to mirror dashboard wording.
- Risk: If the display layer is actually hiding a real duplicate debit, a label-only fix would be insufficient.
- Verification: Later tests must show the multiplier explains the `$100 -> $40` relationship and that retry paths do not double debit.

### 2026-06-13 12:16 — Do not infer billing truth from unrelated legacy analysis code

- Context: The inspected application code in `apps/legacy-app/src/analysis` and shared database/queue services implements analysis job creation, persistence, and queueing, but does not contain wallet, ledger, provider balance, or rollout semantics for this incident.
- Decision: Use the incident prompt, release-state files, and explicit challenge wording as the current semantic source until further billing-specific code is found. Do not pretend the analysis service is the billing source of truth.
- Source of truth: `docs/CHALLENGE_BILLING_SEMANTICS.md`, `ops/urgent-phase2-ticket.md`, and later any billing-specific code or tests discovered.
- Alternatives rejected: Mapping customer balance to `analysis_jobs` records or assuming queue files are ledger records.
- Risk: There may still be hidden or future code paths that refine the source-of-truth map.
- Verification: Continue code inspection for billing-specific modules before implementing any behavior changes in later parts.

### 2026-06-13 12:22 — Freeze semantics before choosing release actions

- Context: `ops/current-rollout-state.json` shows Phase 1 is in public canary with 1% live traffic and is not promoted. The urgent ticket says not to mutate ledger semantics and not to create a second billing source of truth.
- Decision: Release decisions must preserve stable image A as the primary rollback target and keep Phase 1 separate from the urgent patch until dependency evidence proves they must be combined.
- Source of truth: `ops/current-rollout-state.json` for stable/canary identity and traffic weight; urgent ticket constraints for what must not change.
- Alternatives rejected: Updating the public canary in place simply because the canary percentage is small; combining Phase 1 and Phase 2 by default.
- Risk: If the urgent customer-facing change depends on Phase 1 code not present in stable A, a simple unwind may not be enough.
- Verification: The rollout plan must state whether Phase 2 is based on stable image A or canary image B, plus a rollback target for every step.
