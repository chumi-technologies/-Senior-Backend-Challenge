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
| rollback target | stable image `registry.example.com/gateway:phase0-a17f3d2` at stable 100 / canary 0 | Current stable image remains serving 99% and should remain rollback target |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| 2026-06-14 19:14 CST | Observed rollout state before any release action. | `cat ops/current-rollout-state.json` shows Phase 1 public canary observing, stable 99 / canary 1. | Existing risk: 1% of customers see unpromoted Phase 1. No new action taken. |
| 2026-06-14 19:14 CST | Decision: freeze Phase 1 and do not increase canary weight. | `ops/urgent-phase2-ticket.md` says Phase 1 is unpromoted and urgent patch has separate constraints. | Safe because no additional customers are exposed to Phase 1. |
| 2026-06-14 19:14 CST | Decision: urgent Phase 2 should branch from stable image A, `phase0-a17f3d2`. | `solutions/spec.md` and `solutions/decision-log.md` source-of-truth rules. | Reduces blast radius by excluding unpromoted Phase 1 behavior. |
| 2026-06-14 19:14 CST | Proposed next release action: drain/unwind Phase 1 public canary to stable 100 / canary 0 before deploying Phase 2. | No production command executed in this repository. | Low if ALB weight shift is supported and health checks pass; rollback target is already stable. |
| 2026-06-14 19:14 CST | Proposed Phase 2 rollout: deploy stable-based urgent image to canary at 0%, smoke privately, then shift 1%, observe, then continue controlled rollout. | Planned action only. | Low if smoke checks prove dashboard labels changed and ledger semantics did not. |

## Candidate release action assessment

| Candidate action | Safe? | Reason | Rollback target |
|---|---|---|---|
| Continue Phase 1 rollout while preparing Phase 2 | No | Phase 1 is unpromoted and already has public traffic; increasing exposure during an urgent semantic fix mixes risks. | Stable `phase0-a17f3d2` |
| Directly overwrite active public canary with Phase 2 | No | Existing canary traffic would abruptly switch from Phase 1 to Phase 2, making attribution and rollback unclear. | Stable `phase0-a17f3d2` |
| Base Phase 2 on Phase 1 canary image B | No by default | Phase 1 is not promoted; urgent fix should not carry unrelated unverified changes. | Stable `phase0-a17f3d2` |
| Base Phase 2 on stable image A | Yes | Keeps urgent dashboard semantic fix separate from Phase 1 changes. | Stable `phase0-a17f3d2` |
| Drain Phase 1 canary to stable before Phase 2 | Yes | Removes public exposure to unpromoted Phase 1 before introducing urgent fix. | Stable `phase0-a17f3d2` |

## Final state

- Stable image: proposed final stable remains `registry.example.com/gateway:phase0-a17f3d2` until Phase 2 passes canary smoke checks and is promoted.
- Canary image: proposed Phase 2 image should be built from stable image A; exact image tag is not available in this repo and should not be invented.
- ALB weights: proposed first safe state is stable 100 / canary 0 after unwinding Phase 1; proposed Phase 2 observation starts at stable 99 / canary 1 only after private smoke passes.
- Canary desired count: keep enough capacity for health checks; do not enable customer traffic until smoke checks pass.
- Tests / smoke checks: health endpoint, dashboard label payload, official usage `$100.00`, payable debit `$40.00`, no provider balance change, no load-balancing weight change except intentional release weights.
- Rollback target: stable image `registry.example.com/gateway:phase0-a17f3d2`.
- Remaining risks: no real release command was executed in this repository; this is the audited release plan and command log for the simulated challenge.
