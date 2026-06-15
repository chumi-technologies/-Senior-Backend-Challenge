# Decision Log

> Required. Records semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | customer prepaid wallet balance, decremented by ledger debits | prepaid wallet ledger | provider account balance / load-balancing weight / customer wallet |
| account | customer account (the tenant Acme Team) | customer identity record | customer account / provider account / upstream credential |
| usage | official metered usage at list price (`officialCost`) | usage/billing record | raw usage event / ledger entry / dashboard aggregate |
| total cost | official list-price cost ($100.00), a reporting figure | usage/billing record `officialCost` | official list price / customer payable amount |
| actual cost | the amount actually deducted from the wallet ($40.00 payable debit) | prepaid wallet ledger debit `payableAmount` | deducted ledger amount / provider settlement amount |
| provider balance | upstream provider account settlement balance, a separate money path | provider account ledger | customer wallet (must stay untouched) |
| load (load-balancing weight) | ALB target-group traffic split (stable 99 / canary 1) | `ops/current-rollout-state.json` | money, customer balance |
| official (official cost) | list-price usage figure for reporting | usage/billing record `officialCost` | payable debit |
| ledger | append-only record of wallet debits; the money source of truth | prepaid wallet ledger | dashboard aggregate / display label |
| prepaid multiplier | customer package factor `0.4` applied once to compute payable | customer package config | provider discount |
| stable | the promoted ALB target group + `stableImage` serving 99% traffic | `ops/current-rollout-state.json` `stableImage` | Git branch / ALB stable target group / stable API contract |
| canary | public-traffic canary target group + `canaryImage` at 1% (NOT a private shadow) | `ops/current-rollout-state.json` `canaryImage` | private shadow canary / public traffic canary |

## Decision entries

### 2026-06-15 09:10 — Classify the billing incident as a label defect, not a money bug

- Context: Dashboard shows `Total usage cost: $100.00`; wallet debited `$40.00`; team prepaid multiplier `0.4`.
- Decision: `$100.00 (official list price) × 0.4 (multiplier) = $40.00 (payable debit)` is exact. The defect is a customer-facing label that renders the official cost where customers expect the payable amount. Money paths are correct.
- Source of truth: customer payable = prepaid wallet ledger debit (`payableAmount`); official usage = usage/billing record (`officialCost`).
- Alternatives rejected: (a) raise the debit to $100 — corrupts the wallet ledger; (b) treat as double-billing — debit would not equal exactly multiplier × list price.
- Risk: customer wording change must not imply a refund or a price change.
- Verification: contract assertion that `officialCost` stays $100.00 and `payableAmount` stays $40.00; dashboard reads payable from ledger.

### 2026-06-15 09:25 — Multiplier applies only at the payable-debit layer

- Context: ambiguity over whether the `0.4` multiplier should affect raw usage events, ledger debits, dashboard labels, or all of them.
- Decision: the multiplier affects only the payable debit computed into the ledger. Raw usage events and official usage reporting stay at list price; the dashboard label is presentation and reads the already-computed payable.
- Source of truth: customer package config (multiplier) → applied once when writing the ledger debit.
- Alternatives rejected: applying the multiplier at the dashboard layer (would double-apply if billing also applies it) or at the metering layer (would distort official usage reporting).
- Risk: double application if any future code recomputes payable downstream.
- Verification: assert dashboard never multiplies; it reads `payableAmount` from the ledger.

### 2026-06-15 09:40 — Do not rewrite historical ledger entries

- Context: should past ledger debits be rewritten to align with the relabeled dashboard?
- Decision: No. Historical debits are correct ($40.00 each). Only the presentation label changes going forward; the ledger is append-only and immutable.
- Source of truth: prepaid wallet ledger (append-only).
- Alternatives rejected: backfilling/rewriting ledger history to "match" the label — destroys auditability and is a financial-integrity violation.
- Risk: none to money; only the display wording changes.
- Verification: ledger row count and amounts unchanged before/after; retry does not create a second debit.
