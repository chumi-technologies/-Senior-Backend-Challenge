# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | The prepaid wallet amount remaining for the customer team after ledger debits are applied | Customer wallet / ledger-backed prepaid balance, inferred from the incident language "wallet was debited" | provider balance / load-balancing weight |
| provider balance | The upstream provider's own account balance or settlement state | Provider account records outside the customer wallet domain | customer wallet |
| load balance | Traffic distribution weight between stable and canary or other routing targets | Release/routing configuration such as ALB traffic weights | money |
| official cost / total cost | Official list-price usage produced from raw usage reporting before prepaid discounts are applied | Usage-reporting aggregate derived from raw usage events | actual payable debit |
| actual cost / payable cost | The amount actually deducted from the customer's prepaid wallet after multiplier rules are applied | Ledger debit / wallet deduction | official list price |
| raw usage event | The underlying record of customer gateway usage before billing transformation or dashboard wording | Usage event stream / canonical usage record | ledger entry |
| ledger entry | The accounting record that applies billing semantics, including prepaid multiplier effects, to customer balance | Customer debit history / wallet ledger | dashboard aggregate |
| team prepaid multiplier | Customer-specific discounting factor applied when converting official usage into wallet debit | Customer prepaid plan terms from billing rules in the incident description | provider discount |

## 2. Incident classification

Is this a wrong debit, wrong dashboard label, wrong aggregate, double billing bug, or something else?

Answer: Based on the available evidence, this is most likely a wrong dashboard label or dashboard semantic mismatch, not a wrong debit and not yet a proven double-billing bug. The key evidence is that the observed values are mathematically consistent with the stated prepaid multiplier: official list-price usage is `$100.00`, multiplier is `0.4`, and wallet debit is `$40.00`. That ratio strongly suggests the debit path preserved prepaid semantics while the customer-facing phrase `Total usage cost` exposed the list-price aggregate in a place customers interpret as payable debit.

I would classify the incident as:

- Primary issue: wrong customer-facing label and possibly wrong aggregate selection for prepaid display
- Not yet supported by evidence: wrong debit
- Not yet supported by evidence: double billing
- Secondary risk: support/finance confusion because one screen mixes official usage semantics with payable debit expectations

## 3. Source-of-truth map

```text
Gateway response
  -> raw usage event (canonical usage fact)
  -> official usage reporting aggregate at list price
  -> prepaid multiplier application
  -> ledger debit written to customer wallet
  -> dashboard chooses which number and label to show

Unrelated domains that must stay separate
  -> provider balance / settlement state
  -> load-balancing weights for stable/canary rollout
```

| Concept | Source of truth | Why |
|---|---|---|
| customer balance | Ledger-backed customer wallet state | The ticket asks whether the wallet was correctly debited; wallet balance must therefore be governed by ledger semantics, not dashboard text. |
| official usage reporting | Raw usage events aggregated at official list price | The ticket explicitly distinguishes `Official list-price usage: $100.00` from the payable debit. |
| payable prepaid debit | Ledger entry after applying the team prepaid multiplier | The debit amount tracks the multiplier and is the customer-payable amount. |
| customer-facing dashboard wording | Display layer / aggregate selection | The likely defect is that the dashboard is surfacing official usage under wording customers read as payable debit. |
| provider balance | Provider-side records only | No evidence shows provider account money should change in this incident. |
| load-balancing behavior | Rollout/routing configuration only | `balance` is overloaded in the repo; traffic weights must not be changed to solve a billing-display issue. |

## 4. Fix plan

- Layer to change: Customer-facing dashboard label or the dashboard aggregate selection for prepaid accounts. The smallest safe fix is to either relabel `$100.00` as official/list-price usage or show the payable wallet debit under wording that clearly means customer-paid amount.
- Layers explicitly not changed: Raw usage-event semantics, customer ledger-debit semantics, provider balance handling, routing/load-balancing weights, and historical ledger records.
- Historical data treatment: Do not rewrite historical ledger entries. If historical dashboard labels were misleading, correct presentation and add an explanatory note or support guidance rather than mutating accounting history.
- Idempotency risk: If implementation later touches debit logic by mistake, retries could create duplicate ledger entries. The fix should stay in the display/reporting layer unless new evidence proves the debit path is wrong.
- Customer-facing wording risk: High. The phrase `Total usage cost` currently invites customers to read official usage as actual prepaid debit. Replacement wording must explicitly distinguish `Official usage cost` from `Prepaid wallet debit`, or choose one concept and present it consistently.

## 5. Verification evidence

Paste command output or test evidence showing:

- official list-price usage is preserved
- payable prepaid debit is preserved
- provider balance is not touched
- load-balancing weight is not touched
- retry does not double debit

Current evidence before code changes:

```text
ops/urgent-phase2-ticket.md
- Official list-price usage: $100.00
- Payable prepaid debit: $40.00
- Dashboard label shown to customer: Total usage cost: $100.00
```

This is direct evidence that the prompt distinguishes official usage from payable debit.

```text
ops/current-rollout-state.json
"phase1ChangeSummary": "team prepaid usage reporting labels and dashboard aggregation"
```

This supports the hypothesis that the customer-visible issue is in reporting labels/aggregation, not necessarily in the debit path.

```text
rg -n "multiplier|wallet|ledger|prepaid|usage cost|official|actual cost|total usage cost|billing|debit" .
```

Observed result:

- Matches are concentrated in `README.md`, `docs/CHALLENGE_BILLING_SEMANTICS.md`, `ops/urgent-phase2-ticket.md`, `ops/current-rollout-state.json`, and solution templates.
- No billing-specific implementation was found in the inspected legacy application code that would justify rewriting wallet or provider-balance behavior at this stage.

Interpretation of verification status:

- official list-price usage is preserved: supported by the urgent ticket wording
- payable prepaid debit is preserved: supported by the `$100 * 0.4 = $40` relationship
- provider balance is not touched: no evidence in the prompt or inspected code links this incident to provider account records
- load-balancing weight is not touched: rollout state exists as a separate domain in `ops/current-rollout-state.json`
- retry does not double debit: not yet proven by executable test in the current repository; this remains a required follow-up check if code is changed
