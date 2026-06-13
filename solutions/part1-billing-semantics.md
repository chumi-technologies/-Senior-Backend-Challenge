# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | Acme prepaid wallet balance. | Customer wallet ledger. | Provider balance / load-balancing weight. |
| provider balance | Upstream provider account balance, quota, or settlement state. | Provider billing/account system. | Customer wallet. |
| load balance | Routing or traffic weight. | Routing/load balancer config. | Money. |
| official cost / total cost | List-price usage before customer multiplier; here `$100.00`. | Raw usage plus official rate card. | Actual payable debit. |
| actual cost / payable cost | Customer wallet debit after contract terms; here `$40.00`. | Customer wallet ledger. | Official list price. |
| raw usage event | Immutable metering fact. | Gateway metering stream. | Ledger entry. |
| ledger entry | Financial debit or credit. | Customer wallet ledger. | Dashboard aggregate. |
| dashboard aggregate | Derived display value. | Reporting/read projection. | Billing source of truth. |
| team prepaid multiplier | Customer package multiplier; here `0.4`. | Customer contract/package config. | Provider discount. |

## 2. Incident classification

This is primarily a dashboard label / presentation-semantics issue.

The wallet debit is consistent with the prompt: `$100.00 * 0.4 = $40.00`. The `$100.00` value can still be correct as official list-price usage. The prompt does not show a duplicate debit or a second billing path.

The customer-facing problem is that `Total usage cost: $100.00` appears where a customer expects the prepaid wallet debit. The dashboard should distinguish:

- `Official list-price usage: $100.00`
- `Prepaid wallet debit: $40.00`

## 3. Source-of-truth map

```text
Raw usage event
  -> official rate-card calculation
  -> official usage reporting: $100.00

Customer package multiplier: 0.4
  -> payable debit calculation
  -> wallet ledger debit: $40.00
  -> wallet balance

Dashboard
  -> reads these projections
  -> labels each value by meaning
```

Customer balance source of truth: customer wallet ledger.

Official usage reporting source of truth: raw usage events plus official rate card.

The prepaid multiplier should affect payable debit and wallet-impact displays. It should not alter raw usage events or official list-price reporting.

## 4. Fix plan

- Layer to change: dashboard read model / customer-facing label.
- Layers not changed: raw usage, official reporting, wallet ledger writes, provider balances, upstream credentials, routing weights.
- Historical data: do not rewrite ledger entries. Re-render or relabel dashboard history if needed.
- Idempotency risk: do not add another debit path.
- Wording risk: avoid unqualified `Total usage cost` in prepaid-wallet context.

## 5. Verification evidence

Repository inspection shows no concrete billing, wallet, ledger, provider-balance, or routing-weight implementation in the app code; these are challenge-domain concepts rather than existing code paths.

Source inspection command:

```text
rg -n "balance|usage|cost|ledger|prepaid|provider|route|weight|billing|wallet|official|actual" -S . -g '!node_modules' -g '!dist'
```

Expected production checks:

| Check | Expected result |
|---|---|
| Official usage reporting | `$100.00` remains list-price usage. |
| Wallet ledger debit | `$40.00` remains the prepaid debit. |
| Customer balance | Decreases by `$40.00`, not `$100.00`. |
| Dashboard | Labels `$100.00` and `$40.00` by meaning. |
| Provider balance | No provider account or settlement write. |
| Load-balancing weight | Routing weights unchanged. |
| Retry | Same usage event does not create another debit. |
