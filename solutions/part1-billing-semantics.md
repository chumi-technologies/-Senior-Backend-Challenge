# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | Customer prepaid wallet balance derived from append-only ledger entries. | Billing ledger / ledger-derived wallet balance. | Provider balance / load-balancing weight |
| provider balance | Upstream vendor account balance or quota used to call third-party services. | Provider account/configuration system. | Customer wallet |
| load balance | Traffic distribution weight between release target groups. | ALB / release controller rollout state. | Money |
| official cost / total cost | Official list-price usage amount, `$100.00` in the Acme example. | Raw usage metering plus official list-price pricing rules. | Actual payable debit |
| actual cost / payable cost | Customer wallet debit after prepaid multiplier, `$40.00` in the Acme example. | Billing ledger debit. | Official list price |
| raw usage event | Metered gateway or batch activity before pricing and prepaid adjustments. | Usage metering record. | Ledger entry |
| ledger entry | Auditable debit/credit event changing customer wallet balance. | Billing ledger. | Dashboard aggregate |
| team prepaid multiplier | Customer contract multiplier applied to official usage to compute payable debit. | Team prepaid package metadata / billing contract. | Provider discount |

## 2. Incident classification

This is a dashboard/customer-facing semantic mismatch. The facts do not prove wrong debit, wrong raw usage, undercharging, double billing, or a duplicate billing path.

The observed values are internally consistent:

```text
official list-price usage = $100.00
team prepaid multiplier = 0.4
payable prepaid debit = $100.00 * 0.4 = $40.00
```

The customer-facing problem is the label `Total usage cost`. Customers reasonably interpret that label as the wallet amount deducted, but the displayed value is official list-price usage.

## 3. Source-of-truth map

```text
Gateway request / batch item
  -> raw usage metering record
  -> official list-price usage report: $100.00
  -> billing ledger applies team prepaid multiplier 0.4
  -> payable wallet debit ledger entry: $40.00
  -> dashboard reads both values and labels them explicitly
```

- Customer wallet balance source of truth: billing ledger or ledger-derived balance.
- Official usage reporting source of truth: raw usage metering plus official pricing rules.
- Dashboard source of truth: none; it is a presentation/read model and must not create financial state.

## 4. Fix plan

- Layer to change: dashboard aggregation / presentation contract and any API field labels that expose `Total usage cost`.
- Layers explicitly not changed: ledger debit calculation, raw usage metering, official usage reporting, provider balance, provider settlement, load-balancing weights, and release routing.
- Historical data treatment: do not rewrite historical ledger entries. If a true financial correction is later discovered, append an auditable correction / credit / debit event with an idempotency key.
- Idempotency risk: any future correction or refund must be ledger-event idempotent. The current repository has no implemented refund-on-provider-failure mechanism.
- Customer-facing wording risk: replace ambiguous wording with separate display values such as `Usage at list price: $100.00` and `Prepaid wallet debit: $40.00`.

## 5. Verification evidence

Current code-change evidence:

```text
pnpm -r test
apps/legacy-app: 2 tests passed
apps/worker-service: 6 tests passed

pnpm run build
packages/shared-types, apps/legacy-app, and apps/worker-service built successfully
```

Required billing-specific checks before a real dashboard release:

- official list-price usage is preserved as `$100.00`
- payable prepaid debit is preserved as `$40.00`
- provider balance is not touched
- load-balancing weight is not touched
- retry or replay does not double debit
- dashboard/API payload separates list-price usage from prepaid wallet debit
