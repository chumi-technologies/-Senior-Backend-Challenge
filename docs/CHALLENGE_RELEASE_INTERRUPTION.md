# Part 7: Interrupted Rollout — Urgent Fix Without Customer Impact

## Why this part exists

This part tests release-command judgment under pressure. The correct behavior is not just writing a patch; it is preserving customer-visible high availability while Phase 1 is already in public canary.

## Starting state

Read `ops/current-rollout-state.json` before making any release decision.

Important facts:

- Phase 1 is already in public canary.
- Canary has non-zero public traffic.
- Phase 1 has not been promoted.
- Phase 2 urgent patch has a 60-minute deadline.

## Urgent ticket

Read `ops/urgent-phase2-ticket.md`.

The urgent change is customer-facing and semantically ambiguous: the dashboard label mixes official list-price usage and payable prepaid debit. The candidate must preserve billing semantics while fixing the customer-facing confusion.

## Required work order

1. Record the current rollout state in `solutions/release-command-log.md`.
2. Freeze Phase 1 rollout; do not increase public canary weight.
3. Decide whether Phase 2 is based on stable image A or Phase 1 canary image B.
4. If public canary traffic is non-zero, explain why directly updating the canary service is unsafe.
5. Provide a high-availability release sequence with rollback target.
6. Run or describe smoke checks that prove customer-visible behavior and ledger semantics.
7. Record final state in `solutions/release-command-log.md`.

## Correctness signals

Strong answers usually include this order:

```text
inspect current rollout
freeze Phase 1 rollout
return public traffic to stable 100 / canary 0 if the canary must be replaced
verify stable health
choose urgent patch base by dependency analysis
deploy urgent image to private shadow canary
run customer-key smoke and billing semantic checks
optionally move public canary to 1% after explicit decision
promote stable only after evidence
stop or reset canary
record final ALB weights and rollback target
```

## AI trap

AI tools often recommend one of these unsafe shortcuts:

- directly update a public canary task
- merge the urgent patch straight to stable without a shadow check
- combine Phase 1 and Phase 2 without dependency analysis
- change ledger debit logic to make a dashboard label look consistent
- skip ALB weight inspection

The candidate is expected to catch and correct those recommendations.
