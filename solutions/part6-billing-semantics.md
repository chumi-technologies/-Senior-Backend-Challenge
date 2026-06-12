# Part 6: The “Balance” Incident — Semantic Debugging Report

> Complete this before modifying billing, usage, dashboard, or ledger code.

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | | | provider balance / load-balancing weight |
| provider balance | | | customer wallet |
| load balance | | | money |
| official cost / total cost | | | actual payable debit |
| actual cost / payable cost | | | official list price |
| raw usage event | | | ledger entry |
| ledger entry | | | dashboard aggregate |
| team prepaid multiplier | | | provider discount |

## 2. Incident classification

Is this a wrong debit, wrong dashboard label, wrong aggregate, double billing bug, or something else?

```
Your answer:
```

## 3. Source-of-truth map

```text
Gateway response
  -> ...
```

## 4. Fix plan

- Layer to change:
- Layers explicitly not changed:
- Historical data treatment:
- Idempotency risk:
- Customer-facing wording risk:

## 5. Verification evidence

Paste command output or test evidence showing:

- official list-price usage is preserved
- payable prepaid debit is preserved
- provider balance is not touched
- load-balancing weight is not touched
- retry does not double debit
