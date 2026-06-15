# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | Acme Team's prepaid wallet balance, reduced by payable debits | prepaid wallet ledger | provider balance / load-balancing weight |
| provider balance | upstream provider settlement balance (separate money path) | provider account ledger | customer wallet |
| load balance | ALB traffic split between stable and canary target groups | ops/current-rollout-state.json | money |
| official cost / total cost | list-price usage figure, $100.00, for reporting | usage/billing record `officialCost` | actual payable debit |
| actual cost / payable cost | amount deducted from the wallet, $40.00 | prepaid wallet ledger `payableAmount` | official list price |
| raw usage event | metered usage at list price before any multiplier | metering pipeline | ledger entry |
| ledger entry | append-only debit record (the money source of truth) | prepaid wallet ledger | dashboard aggregate |
| team prepaid multiplier | customer package factor 0.4 applied once to compute payable | customer package config | provider discount |

## 2. Incident classification

This is a **wrong dashboard label (presentation defect)**, not a wrong debit, wrong aggregate, or double-billing bug. The money is internally consistent: `$100.00 (official list price) × 0.4 (team prepaid multiplier) = $40.00 (payable debit)`, exact. The dashboard renders the official list-price figure under a label that customers interpret as "amount deducted from your wallet". Sales' "inconsistent" worry and Finance's "undercharging" worry both stem from conflating official cost with payable cost. Engineering's "duplicate billing path" hypothesis is ruled out because the wallet shows a single $40.00 debit, exactly the multiplier × list price — a double path would show ~$80.00.

## 3. Source-of-truth map

```text
Gateway response
  -> raw usage event (list price)
  -> usage/billing record (officialCost = $100.00)         [source of truth for official usage reporting]
  -> prepaid wallet ledger debit (payableAmount = $40.00)  [source of truth for customer balance / what they pay]
  -> dashboard label (PRESENTATION: must read payableAmount from the ledger; never recompute, never read officialCost as "deducted")
  -> provider account ledger (provider settlement)         [separate money path, not touched]
  -> ALB trafficWeight (99/1)                              [load-balancing "balance", not money]
```

- Source of truth for **customer balance**: the prepaid wallet ledger (`payableAmount` debits). $40.00 is correct.
- Source of truth for **official usage reporting**: the usage/billing record (`officialCost`). $100.00 is correct.

## 4. Fix plan

- Layer to change: presentation/dashboard read path only. It must read `payableAmount` from the ledger for the customer-facing "amount deducted" figure, and label the $100.00 explicitly as "official list-price usage" so the two are not conflated.
- Layers explicitly not changed: metering/raw usage, the `officialCost` record, the ledger debit and its multiplier logic, provider settlement, and ALB load-balancing weights.
- Historical data treatment: none rewritten. The ledger is append-only and the historical $40.00 debits are correct. Only forward-looking display wording changes.
- Idempotency risk: the relabel is read-only; it cannot double-debit. The unrelated delayed-update overwrite (ticket #4521) is fixed separately with a status-guarded atomic update so retries cannot clobber results.
- Customer-facing wording risk: the new label must not imply a price change or refund; it clarifies "list-price usage $100.00" vs "deducted from prepaid wallet $40.00 (0.4 multiplier)".

## 5. Verification evidence

The following are asserted by contract/characterization checks (see `solutions/test-evidence.md`):

- official list-price usage is preserved: `officialCost` remains $100.00, unchanged by the relabel.
- payable prepaid debit is preserved: `payableAmount` remains $40.00, computed once as $100.00 × 0.4.
- provider balance is not touched: provider account ledger is on a separate path and never written by the dashboard fix.
- load-balancing weight is not touched: ALB `trafficWeight` (99/1) is a release concern, never altered by a billing relabel.
- retry does not double debit: the wallet shows exactly one $40.00 debit; the #4521 status-guarded update ensures a retried delayed-refresh is a no-op once the job has progressed.
