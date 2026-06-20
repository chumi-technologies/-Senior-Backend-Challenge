# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | Acme Team's remaining prepaid wallet funds | prepaid wallet ledger | provider balance / load-balancing weight |
| provider balance | Funds/credit we hold with an upstream AI provider | provider settlement records | customer wallet |
| load balance | Routing weight distributing traffic across upstreams/targets | router / ALB config | money |
| official cost / total cost | Units consumed x published list price ($100.00) | priced raw usage events | actual payable debit |
| actual cost / payable cost | What actually left the wallet = official x 0.4 ($40.00) | wallet ledger debit entry | official list price |
| raw usage event | One immutable record of units consumed by a request | usage-event store | ledger entry |
| ledger entry | A debit/credit posting against the wallet | wallet ledger | dashboard aggregate |
| team prepaid multiplier | Tenant discount factor (0.4) applied to derive payable debit | tenant prepaid package config | provider discount |

## 2. Incident classification

This is a **wrong/ambiguous dashboard label**, not a wrong debit, wrong aggregate, or double
billing. The debit ($40) is exactly `official ($100) x multiplier (0.4)`, so the money movement is
correct and singular. The dashboard renders the **official list-price usage** under the label
`Total usage cost`, which the customer reads as "amount deducted from my wallet." The defect is
that one label is doing the job of two distinct concepts. We additionally **assert no second debit
exists** to rule out Engineering's double-billing hypothesis with evidence rather than assumption.

## 3. Source-of-truth map

```text
Gateway response
  -> raw usage event (units)                    [immutable fact]
     -> official usage cost = units x list price  -> dashboard "Usage (list price)"  = $100.00
     -> payable debit = official x 0.4 (prepaid)  -> wallet ledger debit             = $40.00
        -> wallet balance -= $40.00               -> dashboard "Charged to wallet"   = $40.00
  provider balance        -> provider settlement store   [UNRELATED, untouched]
  load-balancing weight   -> router config               [UNRELATED, untouched]
```

Source of truth for **customer balance** = the prepaid **wallet ledger**.
Source of truth for **official usage reporting** = the **priced raw usage events** (list price).

## 4. Fix plan

- **Layer to change:** presentation / read-model only. Split the single `Total usage cost` line
  into two labeled values: `Usage (list price): $100.00` and `Charged to prepaid wallet: $40.00`.
- **Layers explicitly not changed:** raw usage events, ledger debit math, the `0.4` multiplier,
  wallet balance computation, provider balance, load-balancing weights.
- **Historical data treatment:** none. Historical ledger entries are **not** rewritten — debits
  were correct. Only how existing numbers are *labeled* changes; no backfill, no migration.
- **Idempotency risk:** none introduced; the change is read-only. We still assert one-debit-per-
  settlement to confirm there was never a duplicate billing path.
- **Customer-facing wording risk:** mitigated by explicit, distinct labels so the QBR audience sees
  both the list-price usage and the discounted amount actually charged.

## 5. Verification evidence

The following are the checks that prove correctness; representative run output is captured in
`solutions/test-evidence.md`.

- **official list-price usage is preserved:** dashboard `Usage (list price)` still equals `$100.00`
  (unchanged aggregate over priced raw usage events).
- **payable prepaid debit is preserved:** wallet ledger debit equals `$40.00` = `100 x 0.4`.
- **provider balance is not touched:** provider settlement store read before/after the change is
  byte-identical (separate store from the customer wallet).
- **load-balancing weight is not touched:** router weights unchanged; the word "balance" in routing
  is a different concept and no routing config is read or written by the dashboard.
- **retry does not double debit:** replaying the same settlement event produces exactly one debit
  (idempotent on settlement id), so `$40.00` is charged once, never `$80.00`.
