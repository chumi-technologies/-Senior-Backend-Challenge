# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` |
| stable traffic weight | `99` | `ops/current-rollout-state.json` |
| canary traffic weight | `1` | `ops/current-rollout-state.json` |
| canary has public traffic? | `true` | `ops/current-rollout-state.json` |
| rollback target | Stable image A until urgent patch image C is proven safe | `ops/current-rollout-state.json` plus urgent patch constraints |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| 2026-06-13 12:55 | Observed current rollout state: public canary is live and not promoted | `ops/current-rollout-state.json` | Medium if ignored; low for observation itself |
| 2026-06-13 12:57 | Decision: freeze Phase 1 and stop public traffic to canary image B before urgent release work | `ops/current-rollout-state.json`, `docs/CHALLENGE_RELEASE_INTERRUPTION.md`, `ops/urgent-phase2-ticket.md` | Low if traffic is shifted back to stable A first; high if B remains public while being mutated |
| 2026-06-13 12:59 | Rejected action: patch canary image B in place | Canary has real public traffic and Phase 1 is not promoted | High because rollback becomes unclear and customers may see mixed Phase 1 + Phase 2 semantics |
| 2026-06-13 13:02 | Decision: build urgent patch image C from stable image A, not from canary B | No repository evidence proves the urgent fix depends on all Phase 1 changes | Low because rollback target stays clear |
| 2026-06-13 13:05 | Planned rollout sequence: 99/1 A/B -> 100/0 A/B -> deploy C -> 99/1 A/C after smoke checks | Part 2 rollout plan and urgent ticket constraints | Low if stable A remains primary and C is canaried only after checks |
| 2026-06-13 13:08 | Required smoke checks: API availability, prepaid wording correctness, official usage vs payable debit unchanged, no duplicate debit, no provider metadata leakage | `ops/urgent-phase2-ticket.md`, billing semantics report | Medium if skipped because semantic regressions may be customer-visible |

## Final state

- Stable image: `registry.example.com/gateway:phase0-a17f3d2` until urgent patch image C is proven
- Canary image: Phase 1 image B removed from public traffic; urgent patch image C introduced separately
- ALB weights: Freeze B by moving to `100/0` for A/B, then reintroduce canary as `99/1` for A/C
- Canary desired count: Keep enough canary capacity for isolated validation only after B is frozen; current snapshot shows canary desired count `1`
- Tests / smoke checks: Verify API availability, corrected customer-facing cost wording, official usage `$100.00` preserved, payable debit `$40.00` preserved, and no duplicate debit on retry/replay
- Rollback target: Immediate rollback to stable image A at full traffic
- Remaining risks: No live cluster commands were executed from this repository, so final operator execution still depends on environment-specific deploy commands and real prepaid-account smoke data
