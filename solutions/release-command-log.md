# Release Command Log

> Required for the interrupted rollout challenge. Records observed state, decision points, commands, evidence, and rollback target. Command output is described, not invented.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | registry.example.com/gateway:phase0-a17f3d2 | ops/current-rollout-state.json `stableImage` |
| canary image | registry.example.com/gateway:phase1-b93c1a8 | ops/current-rollout-state.json `canaryImage` |
| stable traffic weight | 99 | ops/current-rollout-state.json `stableTrafficWeight` |
| canary traffic weight | 1 | ops/current-rollout-state.json `canaryTrafficWeight` |
| canary has public traffic? | yes (true) | ops/current-rollout-state.json `canaryHasPublicTraffic` |
| rollback target | registry.example.com/gateway:phase0-a17f3d2 (stable image A, already serving 99%) | ops/current-rollout-state.json |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| 10:00 | Read rollout state; confirm canary has public traffic at weight 1, Phase 1 not promoted | ops/current-rollout-state.json | none (read-only) |
| 10:05 | Freeze Phase 1: stop promotion; shift canary traffic weight 1 → 0 and drain | ALB weight change; stable image A serves 100% | none (stable A unaffected) |
| 10:15 | Build Phase 2 from stable image A with presentation-only label fix; deploy to new canary target group at weight 0 | new image built FROM rollback target A | none (weight 0, no public traffic) |
| 10:30 | Private smoke at weight 0; assert officialCost $100.00 and payableAmount $40.00 unchanged | billing-semantics smoke checks green | none (no public traffic) |
| 10:40 | Ramp public traffic weight 0 → 5%; observe error rate and billing smoke | metrics 200s; ledger debit still single $40.00 | low (5%, rollback target A warm) |
| 10:50 | Promote Phase 2 to stable (weight 100); keep image A warm | promotion complete | low (one-action rollback to A available) |

## Final state

- Stable image: registry.example.com/gateway:phase2-<built-from-A> (promoted)
- Canary image: drained to weight 0; Phase 1 image phase1-b93c1a8 parked, not promoted
- ALB weights: stable 100 / canary 0 (during ramp: stable 95 / canary 5)
- Canary desired count: 0 after promote
- Tests / smoke checks: official usage $100.00 preserved; payable debit $40.00 preserved; provider balance untouched; load-balancing weights restored to stable 100; no double debit on retry
- Rollback target: registry.example.com/gateway:phase0-a17f3d2 (stable image A) at every step — single-action weight revert
- Remaining risks: Phase 1 dashboard-aggregation change still unshipped; must be rebased on promoted Phase 2 and re-canaried separately
