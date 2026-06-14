# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | The remaining prepaid credit in Acme Team's wallet. After $40 debit, balance decreased by $40. | Ledger (append-only entry) | provider balance (upstream API funds) / load-balancing weight (ALB traffic %) |
| provider balance | The credit/funding held in the upstream AI provider account used to pay for API calls | Provider account management API | customer wallet balance |
| load balance | ALB traffic distribution weight between stable (99%) and canary (1%) target groups | `ops/current-rollout-state.json` | money / monetary balance |
| official cost / total cost | The undiscounted official list-price for the API call: **$100.00**. This is what appears on provider invoices and usage reports for provider reconciliation. | Raw usage event log / gateway record | actual payable debit ($40) |
| actual cost / payable cost | The amount actually debited from the customer prepaid wallet after applying the team multiplier: 0.4 × $100 = **$40.00**. This is the correct charge to the customer. | Ledger debit entry | official list-price ($100) |
| raw usage event | A single gateway-recorded API invocation carrying the official list-price. No multiplier applied at this layer. | Gateway usage event log | ledger entry (multiplied amount) |
| ledger entry | The append-only financial record showing the debit applied to the customer wallet. Amount = multiplier × list-price. | Ledger database (append-only) | dashboard aggregate (display-only sum) |
| team prepaid multiplier | The discount factor (0.4 for Acme Team) applied when converting list-price usage into ledger debits. Defined at team account level. | Customer account configuration | provider discount (separate upstream discount negotiated with provider) |

## 2. Incident classification

Is this a wrong debit, wrong dashboard label, wrong aggregate, double billing bug, or something else?

**Classification: Wrong dashboard label — not a wrong debit, not double billing, not a wrong aggregate.**

Root cause analysis:

- The ledger debit of **$40.00** is **mathematically correct**: Acme Team prepaid multiplier is 0.4, and 0.4 × $100.00 = $40.00.
- The official usage cost of **$100.00** is **correctly recorded** as the list-price in the usage event log for provider reconciliation.
- The dashboard label `Total usage cost: $100.00` is **semantically misleading** — it displays the official list-price (raw usage event amount) but customers with prepaid packages interpret this label as "the amount charged to my wallet."
- There is **no double-billing**: the customer wallet was debited exactly once, for the correct prepaid amount.
- There is **no wrong aggregate**: the $100 figure is an accurate sum of list-price usage; the $40 figure is an accurate sum of ledger debits.
- The incident is purely a **labeling/semantic mismatch** on the dashboard display layer.

## 3. Source-of-truth map

```text
Gateway API call
  -> Raw usage event recorded: official list-price = $100.00
     (Source of truth for usage reporting / provider reconciliation)
  -> Ledger service applies prepaid multiplier:
       debit = 0.4 × $100.00 = $40.00
     (Source of truth for customer wallet balance)
  -> Dashboard reads from ledger for wallet display: -$40.00 (correct)
  -> Dashboard reads from usage event log for "Total usage cost": $100.00
     (PROBLEM: label implies this is what customer owes, but it is the list-price)
  -> Customer interprets "Total usage cost: $100.00" as amount charged
     -> Confusion: "I was charged $100 but wallet only shows $40 deducted"
```

**Source of truth for customer balance**: Ledger (append-only debit entries).

**Source of truth for official usage reporting**: Raw usage event log (list-price, pre-multiplier).

## 4. Fix plan

- **Layer to change**: Dashboard display layer only — rename or annotate the label `Total usage cost` to clearly distinguish list-price from payable amount. Suggested: show both fields with clear labels:
  - `List-price usage: $100.00`
  - `Prepaid wallet charge (×0.4 discount): $40.00`
- **Layers explicitly not changed**:
  - Ledger — semantics are correct, no mutation
  - Raw usage event log — must preserve official list-price for provider reconciliation
  - Prepaid multiplier configuration — 0.4 is correct for Acme Team
  - Historical data — no rewrite of historical ledger entries
- **Historical data treatment**: Do not rewrite. Historical ledger entries correctly record $40 debits. Historical usage events correctly record $100 list-price. The confusion is in the display layer, not in stored data.
- **Idempotency risk**: Dashboard label rename has no idempotency concern — it is a read-path display change only, no write to ledger or usage log.
- **Customer-facing wording risk**: New label must not create a new source of confusion. Wording "Prepaid wallet charge" or "Charged to wallet" unambiguously refers to the deducted amount. Avoid "actual cost" (overloaded term) or "discounted cost" (implies provider discount, not team multiplier).

## 5. Verification evidence

The following assertions prove correctness after the dashboard label fix:

**official list-price usage is preserved:**
```
Assertion: raw_usage_event.list_price_usd == 100.00
Source: usage event log (unchanged by this fix)
Evidence: provider reconciliation report shows $100 per API call — unchanged.
```

**payable prepaid debit is preserved:**
```
Assertion: ledger_entry.debit_usd == 0.4 × raw_usage_event.list_price_usd == 40.00
Source: ledger database (unchanged by this fix)
Evidence: customer wallet balance decreased by $40, not $100 — semantically correct.
```

**provider balance is not touched:**
```
Provider account balance is managed entirely by the upstream AI provider.
This fix changes only the dashboard display label — no API calls to provider.
No code path between dashboard label rename and provider account management.
```

**load-balancing weight is not touched:**
```
ALB weights: stable 99% / canary 1% — unchanged.
This fix is a dashboard display change deployed as Phase 2 canary patch.
Phase 1 ALB configuration is frozen (not promoted, not rolled back) during Phase 2.
```

**retry does not double debit:**
```
Ledger write is idempotent per usage event ID.
Dashboard label rename has no write path to ledger.
Re-requesting the dashboard page does not trigger any billing write.
No new debit is created by viewing or refreshing the dashboard.
```
