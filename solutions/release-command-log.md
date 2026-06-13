# Release Command Log

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` field `stableImage` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` field `canaryImage` |
| stable traffic weight | `99` | `ops/current-rollout-state.json` field `stableTrafficWeight` |
| canary traffic weight | `1` | `ops/current-rollout-state.json` field `canaryTrafficWeight` |
| canary has public traffic? | `true` | `ops/current-rollout-state.json` field `canaryHasPublicTraffic` |
| rollback target | stable image `registry.example.com/gateway:phase0-a17f3d2` at traffic weight 100/0 | derived from current stable image and canary not promoted |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| 2026-06-13 09:00 | Read current rollout state before release decision. | stable image A, canary image B, traffic weight 99/1, public traffic true. | None; read-only. |
| 2026-06-13 09:05 | Freeze Phase 1 promotion and stop increasing canary traffic. | Phase 1 status is public canary observation, not promoted. | Low; customers remain on current 99/1 while decision is made. |
| 2026-06-13 09:10 | Choose urgent Phase 2 base as stable image A, not canary image B. | Phase 1 changes labels/dashboard aggregation and are not promoted. | Lower than combining changes; preserves rollback target. |
| 2026-06-13 09:15 | Unwind Phase 1 public canary to 100/0 before urgent patch rollout. | Canary has public traffic, so in-place update is unsafe. | Low if ALB weight shift is gradual and health checks pass. |
| 2026-06-13 09:25 | Build urgent patch image from stable image A with only customer-facing display helper. | Code change is helper + tests, no ledger writer change. | Low; no billing mutation. |
| 2026-06-13 09:35 | Canary urgent patch at 1% after health and billing smoke checks. | Smoke checks: health, dashboard label, ledger debit, official usage, provider/routing unchanged. | Low; rollback target remains stable image A. |
| 2026-06-13 09:45 | Promote urgent patch gradually only after smoke checks stay green. | Verification commands recorded in `solutions/test-evidence.md`. | Controlled; rollback target at every step is previous healthy stable. |

## Final state

- Stable image: urgent Phase 2 image built from `registry.example.com/gateway:phase0-a17f3d2` after promotion.
- Canary image: original Phase 1 image `registry.example.com/gateway:phase1-b93c1a8` remains unpromoted and separated for later review.
- ALB weights: final target for urgent patch is 100/0 after canary validation; during rollout each step has rollback to previous healthy stable.
- Canary desired count: urgent patch canary desired count 1 during validation, then 0 after promotion.
- Tests / smoke checks: health endpoint, customer dashboard label, ledger debit `$40.00`, official usage `$100.00`, provider balance unchanged, load-balancing weight unchanged.
- Rollback target: before promotion, stable image `registry.example.com/gateway:phase0-a17f3d2`; after promotion, previous healthy stable deployment.
- Remaining risks: Phase 1 must be re-evaluated later because its dashboard aggregation work overlaps the urgent semantic label area.
