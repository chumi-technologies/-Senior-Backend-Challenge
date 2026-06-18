# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

All commands below are **proposed/dry-run**: this environment has no live ALB/registry, so no real command output is fabricated. Each step states the command shape, the expected guard, and the rollback target. Terms per [decision-log.md](decision-log.md).

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` → `stableImage` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` → `canaryImage` |
| stable traffic weight | 99 | `ops/current-rollout-state.json` → `stableTrafficWeight` |
| canary traffic weight | 1 | `ops/current-rollout-state.json` → `canaryTrafficWeight` |
| canary has public traffic? | yes (real customer traffic) | `ops/current-rollout-state.json` → `canaryHasPublicTraffic: true` |
| rollback target | stable image A `phase0-a17f3d2` at weight 100 | `ops/current-rollout-state.json` (stable serves 99% already) |

Additional observed state: `phase1Status = "public canary observation, not promoted"`, `canaryDesiredCount = 1`, `stableDesiredCount = 2`, `maintenanceJobsEnabledOnCanary = false`, `urgentPatchDeadlineMinutes = 60`.

## Decision summary (see part2 for full rationale)

- Urgent patch is built from **stable image A**, not canary image B. → new image C.
- Phase 1 is **frozen** (held at weight 1 or drained to 0), **not promoted**, **not mutated in place**.
- Phase 1 and Phase 2 stay **separate** releases with independent rollback targets.

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| T+0 | Snapshot rollout state; freeze Phase 1 (stop the canary observation clock, no promote). `aws elbv2 describe-rules` / read `current-rollout-state.json`. | snapshot table above | none (read-only) |
| T+5 | Drain public traffic off Phase 1 canary: set ALB weights stable=100 / canary=0. `aws elbv2 modify-listener ... weight stable=100 canary=0`. | weights after = 100/0 | low — moves the 1% back onto already-trusted stable A |
| T+10 | Build urgent image **C** from stable A + display-only label fix (official `$100` / charged `$40` split). `docker build --build-arg BASE=phase0-a17f3d2 -t gateway:phase2-cXXXX`. | build SHA, diff is display-only | none (not yet routed) |
| T+20 | Deploy C as the canary target group, desired count 1, weight 0. `aws ecs update-service --task-def gateway:phase2-cXXXX`; weights stable=100 / canaryC=0. | task healthy, 0% traffic | none (0% traffic) |
| T+25 | Smoke check C at 0% via direct/synthetic request (see Smoke checks). | smoke results | none |
| T+30 | Shift 1% to C: weights stable=99 / canaryC=1. `aws elbv2 modify-listener ... canaryC=1`. | weights 99/1 | low — 1% blast radius, instant rollback |
| T+40 | Observe error rate, latency, dashboard label correctness. | dashboards | low |
| T+50 | If healthy, ramp 1→10→50→100 with checks between; else rollback to stable A weight 100. | weight history | controlled |
| any | **Rollback**: set ALB weights stable=100 / canaryC=0 (instant); stable A `phase0-a17f3d2` never changed. | rollback target constant | none |

## Final state (target after a successful ramp)

- Stable image: `phase0-a17f3d2` (unchanged throughout; the trusted fallback).
- Canary image: `phase2-cXXXX` (stable A + display-only label fix), ramped 1→100 only if smoke checks pass.
- ALB weights: end at stable=0 / canaryC=100 *or* promote C to the stable target group; until then stable A remains the rollback target.
- Canary desired count: 1 during canary, scaled with traffic on ramp.
- Tests / smoke checks: availability + ledger-semantics smoke checks below all green.
- Rollback target: stable image A `phase0-a17f3d2` at weight 100, available at every step.
- Remaining risks: Phase 1 (`phase1-b93c1a8`) still unverified and now drained — it must be re-validated and re-released **separately** later; it must not be silently bundled into C.

## Smoke checks (proving ledger semantics did not change)

- API: 2xx/5xx ratio and p95 latency on C equal to stable A within noise.
- Customer dashboard: shows two labelled lines — `Official usage (list price): $100.00` and `Charged to prepaid wallet: $40.00`.
- Billing semantic: wallet debit still `$40.00` (= `$100 × 0.4`); official usage still `$100.00`; no new debit created (read-only display change).
- Ledger idempotency: replaying a dashboard render performs no write; `sum(debits)` unchanged before/after.
- Metadata leakage: no provider account / settlement / `slaveN@test.com` auth-slot strings in customer-facing output.
