# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | prepaid wallet funds remaining for the team | wallet ledger | provider balance / load-balancing weight |
| provider balance | upstream provider account credit | provider account API | customer wallet |
| load balance | ALB traffic weight (routing) | rollout / ALB state | money |
| official cost / total cost | list-price usage total ($100) | usage/metering store | actual payable debit |
| actual cost / payable cost | amount debited from the wallet ($40) | ledger entry | official list price |
| raw usage event | a metered gateway call at list price | usage store | ledger entry |
| ledger entry | append-only payable debit record | ledger store | dashboard aggregate |
| team prepaid multiplier | the team package factor (0.4) | pricing config | provider discount |

## 2. Incident classification

This is a **wrong dashboard label / presentation defect**, not a wrong debit and not double billing.
`$100 official list price x 0.4 prepaid multiplier = $40 payable debit`. The `$40` ledger debit is correct. The dashboard renders the `$100` official figure under a label ("Total usage cost") that customers read as the amount deducted from their wallet. The numbers are both right; only the label is misleading.

## 3. Source-of-truth map

```text
Gateway response / metered usage  -> raw usage event ($100 list price)   [SOURCE OF TRUTH: official usage reporting]
                                  -> ledger entry ($40 payable debit)    [SOURCE OF TRUTH: customer balance]
                                  -> wallet balance decremented by $40   [derived from ledger]
                                  -> dashboard aggregate (a VIEW)         [derived; currently mislabeled]
```

- Source of truth for customer balance: the **ledger entry** ($40), which decrements the wallet.
- Source of truth for official usage reporting: the **raw usage event** at list price ($100).
- The dashboard aggregate is a derived view and is authoritative for nothing.

## 4. Fix plan

- Layer to change: presentation only — the dashboard label/aggregation, to show both "Official usage cost: $100.00" and "Prepaid wallet debit: $40.00".
- Layers explicitly not changed: metering ($100 list price), ledger debit ($40), prepaid multiplier (0.4), provider settlement, provider balance, load-balancing weight.
- Historical data treatment: none. Past debits were correct; the ledger is append-only and is not rewritten. Only the forward-facing label changes.
- Idempotency risk: the debit must remain idempotent per usage event so a retry does not double-debit; the label change does not touch the write path.
- Customer-facing wording risk: the new copy must not surface provider account or upstream credential terms.

## 5. Verification evidence

Scope note (honest): this is a tabletop semantic exercise. The repo intentionally contains no billing / ledger / wallet / dashboard code — the only executable code path is the analysis hot path (Part 4). So the items below are design-level guarantees of the proposed presentation-only fix, NOT outputs of a billing test that exists in this repo. The only executed test in this submission is the analysis-path race characterization (`solutions/test-evidence.md`).

Under the proposed fix the following WOULD hold, and are the exact checks I would run against a real gateway before shipping:

- official list-price usage is preserved ($100 unchanged in the usage store).
- payable prepaid debit is preserved ($40 unchanged in the ledger).
- provider balance is not touched (the presentation fix calls no provider account path).
- load-balancing weight is not touched (ALB weights unchanged by a presentation fix).
- retry does not double debit (debit keyed by usage event id; the label fix adds no write path).
