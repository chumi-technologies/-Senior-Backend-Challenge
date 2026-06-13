# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | registry.example.com/gateway:phase0-a17f3d2 | ops/current-rollout-state.json |
| canary image | registry.example.com/gateway:phase1-b93c1a8 | ops/current-rollout-state.json |
| stable traffic weight | 99 | ops/current-rollout-state.json |
| canary traffic weight | 1 | ops/current-rollout-state.json |
| canary has public traffic? | yes (`canaryHasPublicTraffic: true`) | ops/current-rollout-state.json |
| rollback target | stable image `phase0-a17f3d2` (the 99% baseline) | ops/current-rollout-state.json |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| 09:40 | Recorded observed rollout state; froze Phase 1 (no weight change, no promote) | rollout state json | none (read-only) |
| 09:45 | Decided the urgent label fix is built on stable image A, not canary B | dependency analysis in part2 | none (build step) |
| 09:55 | Deploy label-fix image as a fresh canary at 1%; rollback target = stable A | release plan | low (1% weighted) |
| 10:05 | Smoke: ledger debit still $40, official usage still $100, dashboard shows both | smoke checks | none if green |
| 10:15 | If green, raise canary weight gradually; else set canary weight to 0 and keep stable A | release plan | controlled |

## Final state

- Stable image: registry.example.com/gateway:phase0-a17f3d2 (unchanged anchor)
- Canary image: label-fix image built on `phase0-a17f3d2` (Phase 1 `b93c1a8` left frozen, not promoted)
- ALB weights: start 99 / 1; raise canary only after a green smoke pass
- Canary desired count: 1
- Tests / smoke checks: ledger-unchanged ($40), official-usage-unchanged ($100), API returns 200s, no provider/credential leakage in dashboard copy
- Rollback target: stable `phase0-a17f3d2` at every step
- Remaining risks: low. Dependency analysis (part2 §3) shows the urgent label fix is INDEPENDENT of Phase 1's aggregation — both numbers ($100 official, $40 debit) already exist on stable A — so building on A needs no Phase 1 re-implementation. Phase 1 stays frozen and is reconciled on its own timeline.
