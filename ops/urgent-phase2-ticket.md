# Urgent Phase 2 Ticket — Customer-Facing Cost Display

## Situation

Phase 1 is already live at public canary 1%.

- Stable image: `registry.example.com/gateway:phase0-a17f3d2`
- Canary image: `registry.example.com/gateway:phase1-b93c1a8`
- ALB weights: stable 99 / canary 1
- Phase 1 is still observing and has not been promoted.

## Urgent request

Acme Team has a QBR in 60 minutes. Their dashboard shows `Total usage cost` next to a number that customers interpret as the amount deducted from their prepaid wallet.

The customer has a team prepaid multiplier of `0.4`.

Observed example:

- Official list-price usage: `$100.00`
- Payable prepaid debit: `$40.00`
- Dashboard label shown to customer: `Total usage cost: $100.00`

Support wants a customer-facing fix within 60 minutes.

## Constraints

- Do not cause customer-visible API downtime.
- Do not mutate ledger semantics to make labels match.
- Do not create a second billing source of truth.
- Do not update a canary task in place while it has public traffic.
- Do not silently merge Phase 1 and Phase 2 unless the dependency is explicitly justified.
- Preserve a clear rollback target.
- Record every release decision in `solutions/release-command-log.md`.

## Required output

1. Explain whether the urgent patch should be based on stable image A or phase1 canary image B.
2. Explain how to freeze or unwind Phase 1 before shipping the urgent change.
3. Provide the shortest high-availability release sequence that keeps customers unaware of the transition.
4. State exactly what smoke checks prove that ledger semantics did not change.
