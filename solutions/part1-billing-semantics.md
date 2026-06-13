# Part 1 - Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | prepaid wallet balance derived from customer ledger debits and credits | customer ledger / wallet transaction table | provider balance / load-balancing weight |
| provider balance | upstream provider account or settlement balance | provider account system | customer wallet |
| load balance | routing weight used to distribute traffic | ALB/gateway routing configuration | money |
| official cost / total cost | list-price usage amount for official reporting, here `$100.00` | raw usage event and official usage aggregate | actual payable debit |
| actual cost / payable cost | amount debited from prepaid wallet after multiplier, here `$40.00` | customer ledger debit | official list price |
| raw usage event | immutable metering event from gateway traffic | raw usage event store | ledger entry |
| ledger entry | money movement applied to customer wallet | customer billing ledger | dashboard aggregate |
| team prepaid multiplier | customer contract multiplier `0.4` | billing plan / contract config | provider discount |

## 2. Incident classification

This is a wrong dashboard label / display semantics incident, not a proven wrong debit, wrong aggregate, or double-billing bug.

The arithmetic matches the contract: `$100.00 * 0.4 = $40.00`. The customer-facing problem is that the dashboard label `Total usage cost` is placed next to the official list-price usage amount while customers interpret it as prepaid wallet money deducted. The fix is to label and expose both meanings clearly:

- `Official list-price usage: $100.00`
- `Prepaid wallet debit: $40.00`

## 3. Source-of-truth map

```text
Gateway response
  -> raw usage event records official usage volume
  -> official usage aggregate reports list-price cost ($100.00)
  -> customer billing plan applies prepaid multiplier 0.4
  -> customer ledger records payable prepaid debit ($40.00)
  -> dashboard displays prepaid wallet debit as the customer primary amount and official usage as reporting context
```

Customer balance source of truth is the ledger / wallet transaction record. Official usage reporting source of truth is the raw usage event and official list-price aggregate.

## 4. Fix plan

- Layer to change: customer-facing dashboard cost display helper / read-model formatting.
- Layers explicitly not changed: raw usage events, ledger debit writer, historical ledger rows, provider account balance, provider settlement, routing weights.
- Historical data treatment: do not rewrite ledger entries; existing `$40.00` debit is correct under multiplier `0.4`.
- Idempotency risk: no new debit path is introduced, so retry cannot double debit through this helper.
- Customer-facing wording risk: avoid `Total usage cost` as the primary prepaid amount; show `Prepaid wallet debit` first and `Official list-price usage` as secondary/reporting context.

## 5. Verification evidence

Automated checks added in `apps/legacy-app/test/bug-repro.spec.ts`:

- official list-price usage is preserved: `officialUsageCostCents` remains `10000`.
- payable prepaid debit is preserved: `payablePrepaidDebitCents` is `4000`.
- provider balance is not touched: `providerBalanceCents` remains `250000`.
- load-balancing weight is not touched: `loadBalancingWeight` remains `25`.
- retry does not double debit: the helper is pure formatting/read-model construction and has no ledger write side effect.

Command evidence:

```text
pnpm --filter legacy-app test
tests 2
pass 2
fail 0
```
