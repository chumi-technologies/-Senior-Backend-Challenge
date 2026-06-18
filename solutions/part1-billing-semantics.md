# Part 1 — Billing Semantics Incident

> Terms are defined in [decision-log.md](decision-log.md); this report applies them to the incident.

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | Prepaid money Acme Team still has in its wallet, drawn down by debits. | wallet ledger | provider balance / load-balancing weight |
| provider balance | Funds/credit on our upstream AI provider account; internal, not customer-facing. | provider account statement | customer wallet |
| load balance | Traffic/credential distribution weight (ALB stable/canary weights, `MockAuthPool` round-robin). No money meaning. | ALB weights / auth-pool index | money / any wallet or provider balance |
| official cost / total cost | List-price value of consumed usage before discount = `$100.00`. | official usage report (raw usage × list price) | actual payable debit |
| actual cost / payable cost | Money actually debited from the prepaid wallet after the multiplier = `$40.00` = `$100.00 × 0.4`. | wallet ledger entry | official list price |
| raw usage event | Metered units of real consumption; the bottom layer. | raw usage event store | ledger entry |
| ledger entry | Money movement derived from usage (the `$40` debit). | wallet ledger | dashboard aggregate (a view) |
| team prepaid multiplier | Customer discount `0.4` applied only when computing the payable debit. | wallet/package record | a provider-side discount |

## 2. Incident classification

This is a **wrong dashboard label / aggregate-naming defect** — a presentation problem — **not** a wrong debit, **not** a wrong aggregate value, and **not** a double-billing bug.

Reasoning: `$40.00` is exactly `$100.00 × 0.4`, i.e. the correct discounted payable debit. Both numbers are correct and both are needed for different audiences (Finance needs the official `$100`; the customer needs the charged `$40`). The defect is that the dashboard prints the official list price under a label (`Total usage cost`) that customers read as "amount charged to our wallet". Nothing financial is broken; the *wording* is ambiguous. Engineering's "two billing paths" fear is unsupported — there is no second debit, only two distinct concepts sharing the word "cost".

## 3. Answers to the required questions

1. **Wrong debit / label / aggregate / double bill / other?** → A wrong/ambiguous **label** on a correct aggregate. Display layer only.
2. **Source of truth for customer balance?** → The **wallet ledger** (append-only debits/credits). Not the dashboard, not raw usage.
3. **Source of truth for official usage reporting?** → The **raw usage events** rolled into the official usage report (`$100` list price). Not the wallet.
4. **Should the prepaid multiplier affect raw usage, ledger debit, dashboard labels, or all?** → **Only the ledger debit** (`payable = list price × 0.4`). It must not scale raw usage events, must not alter the official usage report, and must not silently rewrite the displayed official number.
5. **Should historical ledger entries be rewritten?** → **No.** The historical debits (`$40`) are already correct. Rewriting them would (a) create a second source of truth, (b) destroy audit trail/idempotency guarantees, and (c) "fix" a label problem by corrupting money. Only the read-model/label changes, going forward and retroactively *in display*, never in the ledger.

## 4. Source-of-truth map

```text
Gateway response
  -> raw usage event store      = OFFICIAL usage ($100 list price)        [source of truth: official report]
  -> wallet ledger debit        = PAYABLE debit ($100 × 0.4 = $40)        [source of truth: customer balance]
  -> dashboard aggregate (VIEW) = reads both layers; renders two labels   [NOT a source of truth]

provider account balance / settlement   = internal, separate, untouched
ALB weights + MockAuthPool rotation      = "load balance" (traffic), untouched
```

## 5. Fix plan

- Layer to change: **dashboard / read-model display only.** Replace the single ambiguous `Total usage cost: $100.00` with two unambiguous lines, e.g. `Official usage (list price): $100.00` and `Charged to prepaid wallet: $40.00`.
- Layers explicitly not changed: raw usage events, wallet ledger debits, the multiplier, provider balance/settlement, ALB/auth-pool load-balancing weights.
- Historical data treatment: ledger untouched; the dashboard *displays* the existing correct numbers with corrected labels. No backfill/rewrite of money.
- Idempotency risk: none introduced — no new write path; the fix adds no debit, so retries cannot double-charge.
- Customer-facing wording risk: ensure internal terms (provider account, settlement, `slaveN@test.com` auth slots) never leak into the customer dashboard.

## 6. Verification evidence

Checks that prove the unrelated balances/weights were not touched (commands/tests to run and paste):

- Official list-price usage preserved: dashboard still surfaces `$100.00` as *official usage* (snapshot/assertion before vs after).
- Payable prepaid debit preserved: wallet ledger debit remains `$40.00`; `sum(debits)` unchanged before/after the label fix.
- Provider balance not touched: no code path in the change reads or writes the provider account; grep shows the diff touches only display/read-model code.
- Load-balancing weight not touched: ALB stable/canary weights and `MockAuthPool` rotation unchanged (diff contains no auth-pool or weight edits).
- Retry does not double debit: the fix introduces no debit write; replaying a dashboard read is read-only.

> Note: this repository contains no billing/ledger implementation code (verified by `grep -ri "ledger|wallet|debit|multiplier"` over `apps/` and `packages/`). Part 1 is therefore resolved at the **spec + semantics** level: the correct intervention is display-only, and the most important deliverable is *not* writing speculative billing code (which would create the very "second source of truth" the ticket forbids). The runnable code fix in this submission is the unrelated analysis-overwrite bug in Part 4.
