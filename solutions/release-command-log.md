# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` field `stableImage` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` field `canaryImage` |
| stable traffic weight | `99` | `ops/current-rollout-state.json` field `stableTrafficWeight` |
| canary traffic weight | `1` | `ops/current-rollout-state.json` field `canaryTrafficWeight` |
| canary has public traffic? | `true` | `ops/current-rollout-state.json` field `canaryHasPublicTraffic` |
| maintenance jobs enabled on canary? | `false` | `ops/current-rollout-state.json` field `maintenanceJobsEnabledOnCanary` |
| rollback target | `registry.example.com/gateway:phase0-a17f3d2` | Stable image is the known promoted production baseline |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| 2026-06-13 17:48 CST | Observed Phase 1 state before deciding. | Stable 99 / canary 1; canary has public traffic; Phase 1 not promoted. | Existing 1% canary traffic means the canary cannot be treated as an empty staging slot. |
| 2026-06-13 17:48 CST | Decision: freeze Phase 1. | Phase 1 touches prepaid dashboard/reporting and is still observing. | Continuing or promoting Phase 1 would expand an unproven change during an incident. |
| 2026-06-13 17:48 CST | Decision: base urgent Phase 2 on stable A, not canary B. | Stable A is `phase0-a17f3d2`; canary B is `phase1-b93c1a8`. | Keeps the urgent fix single-variable; rollback remains stable A. |
| Planned | Confirm stable A is healthy and has capacity for 100% traffic. | Stable currently serves 99%; check health/error/latency before weight change. | Avoids moving the last 1% onto an unhealthy or saturated stable fleet. |
| Planned | Verify canary side-effect writers are disabled. | Current state proves maintenance jobs are disabled; release checklist must also verify billing jobs, migrations, ledger backfill, and aggregation writers are disabled on canary. | Prevents canary from modifying production billing/reporting state while traffic is 0%. |
| Planned | Set canary public traffic to `0` before replacing canary image. | Would change ALB weights from `99/1` to `100/0`. | Removes public traffic from Phase 1 before mutation. |
| Planned | Deploy Phase 2 patch image C from stable A to canary at `0%` public traffic. | Build provenance should show `phase0-a17f3d2 + display fix only`. | No customer traffic while smoke checks run. |
| Planned | Smoke C, then shift a small canary weight only if checks pass. | Health checks plus billing-display checks listed below. | Controlled exposure with rollback to stable A. |
| Planned | Promote C only after canary checks pass. | Stable image becomes C; old stable A remains rollback target. | Customer-visible risk is bounded by prior canary evidence. |

## Required smoke checks

- API health and dashboard route return successful responses.
- Dashboard no longer labels `$100.00` as prepaid wallet debit.
- Official list-price usage remains `$100.00`.
- Payable prepaid wallet debit remains `$40.00`.
- Prepaid multiplier remains `0.4`.
- Ledger entry id/count is unchanged; replay does not create a duplicate debit.
- Provider account/balance/settlement state is unchanged.
- Load-balancing weights match the planned release step.
- Canary maintenance jobs remain disabled, and release checklist verifies billing jobs, migrations, ledger backfill, and usage aggregation writers are also disabled while validating C.
- Customer-facing response does not expose provider settlement, provider account, or upstream credential metadata.

## Rollback actions by phase

| Phase | Rollback action |
|---|---|
| Before C is deployed | Keep stable A at `100%`; keep canary at `0%`; Phase 1 remains frozen. |
| C deployed at `0%` and smoke fails | Keep stable A at `100%`; keep canary at `0%`; discard or replace C. |
| C receives small canary traffic and fails | Shift canary back to `0%`; stable A returns to `100%`. |
| C promoted and then fails | Roll stable image back to `registry.example.com/gateway:phase0-a17f3d2`. |

## Final state

- Stable image: planned target is Phase 2 patch C after successful canary; until promotion, stable remains `registry.example.com/gateway:phase0-a17f3d2`.
- Canary image: planned target is Phase 2 patch C built from stable A; Phase 1 canary B remains frozen/unpromoted.
- ALB weights: first move to stable `100` / canary `0`; later canary receives traffic only after smoke checks.
- Canary desired count: keep enough capacity for smoke/canary, but no public traffic during replacement.
- Canary side effects: keep maintenance jobs disabled and verify no billing jobs, migrations, ledger backfill, or usage aggregation writers run during validation.
- Tests / smoke checks: see required smoke checks above.
- Rollback target: `registry.example.com/gateway:phase0-a17f3d2` at every step until C is proven and promoted.
- Remaining risks: this is a plan only; no real release command output has been produced in this repository.
