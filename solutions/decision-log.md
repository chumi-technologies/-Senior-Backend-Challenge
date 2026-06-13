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
