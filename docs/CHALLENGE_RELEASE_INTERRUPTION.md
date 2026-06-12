# Part 2: Interrupted Rollout — Urgent Fix Without Customer Impact

## Context

This part tests release-command judgment under pressure. Your answer must preserve customer-visible availability while Phase 1 is already in public canary.

## Starting state

Read `ops/current-rollout-state.json` before making any release decision.

Important facts:

- Phase 1 is already in public canary.
- Canary has non-zero public traffic.
- Phase 1 has not been promoted.
- Phase 2 urgent patch has a 60-minute deadline.

## Urgent ticket

Read `ops/urgent-phase2-ticket.md`.

The urgent change is customer-facing and semantically ambiguous. Preserve the intended billing semantics while addressing the customer-facing issue.

## Required work order

1. Record the current rollout state in `solutions/release-command-log.md`.
2. Decide whether Phase 1 rollout should continue, pause, or be unwound.
3. Decide whether Phase 2 is based on stable image A or Phase 1 canary image B.
4. Evaluate each release action against the observed traffic state.
5. Provide a high-availability release sequence with rollback target.
6. Run or describe smoke checks that prove customer-visible behavior and ledger semantics.
7. Record final state in `solutions/release-command-log.md`.

## Submission evidence

- Observed state before action.
- Decision table for candidate release actions.
- Dependency analysis between Phase 1 and Phase 2.
- Rollback target for every step.
- Smoke and verification evidence.
