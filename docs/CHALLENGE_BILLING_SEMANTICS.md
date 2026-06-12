# Part 1: The “Balance” Incident — Semantic Debugging

## Why this part exists

This part is designed to expose candidates who let AI collapse overloaded business terms into one meaning. The codebase and ticket intentionally use ambiguous words such as `balance`, `usage`, `cost`, `official`, `actual`, `account`, and `prepaid`.

A correct solution starts with semantic clarification, not code.

## Incident ticket

```text
#finance

Acme Team purchased a team prepaid package with multiplier 0.4.

Yesterday the dashboard showed:
  Total usage cost: $100.00

But the team prepaid wallet was only debited:
  $40.00

Sales is worried we undercharged the customer.
Finance is worried the usage report is wrong.
Engineering says there may be two billing paths.

Please fix this urgently.
```

## Required work order

Before editing code, create or update `solutions/decision-log.md` with a glossary that distinguishes at least these concepts:

| Ambiguous term | Required distinction |
|---|---|
| `balance` | customer wallet balance vs provider account balance vs load-balancing weight |
| `usage` | raw usage event vs ledger entry vs dashboard aggregate |
| `cost` | official list-price cost vs customer payable debit vs provider settlement |
| `account` | customer account vs provider account vs upstream credential |
| `prepaid` | customer package multiplier vs provider discount |

Then answer in `solutions/part1-billing-semantics.md`:

1. Is the incident a wrong debit, a wrong dashboard label, a wrong aggregate, or a real double-billing bug?
2. Which storage object is the source of truth for customer balance?
3. Which storage object is the source of truth for official usage reporting?
4. Should team prepaid multiplier affect raw usage events, ledger debits, dashboard labels, or all of them?
5. Should historical ledger entries be rewritten? Why or why not?
6. What tests prove provider balances and load-balancing weights were not touched?

## AI trap

A weak AI-driven solution will often force `TotalCost` and deducted balance to match by changing ledger debit logic. That is usually wrong. The senior signal is noticing that `$100` can be the official list-price usage while `$40` is the correct customer payable debit under a `0.4` package multiplier.

## Acceptance criteria

- The candidate defines overloaded terms before code changes.
- The candidate does not create a second billing source of truth.
- The candidate does not hard-code Acme-specific logic.
- The candidate preserves idempotent ledger behavior.
- The candidate can explain why matching labels by changing debits is dangerous.
