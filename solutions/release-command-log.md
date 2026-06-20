# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` (2 tasks) | `ops/current-rollout-state.json` → `stableImage`, `stableDesiredCount` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` (1 task) | `ops/current-rollout-state.json` → `canaryImage`, `canaryDesiredCount` |
| stable traffic weight | 99% | `ops/current-rollout-state.json` → `stableTrafficWeight` |
| canary traffic weight | 1% (public traffic) | `ops/current-rollout-state.json` → `canaryTrafficWeight`, `canaryHasPublicTraffic: true` |
| canary has public traffic? | yes — 1% of real customers hit Phase 1 | `canaryHasPublicTraffic: true` |
| rollback target | stable image `gateway:phase0-a17f3d2` at 100% weight | last fully-promoted production image |

## Decision: base image for the urgent Phase 2 label fix

Base the urgent fix on **stable image A (`phase0-a17f3d2`)**, not on Phase 1 canary image B.

- Phase 1 (`phase1-b93c1a8`) is **still observing** and unpromoted; it changed the exact subsystem
  in play ("team prepaid usage reporting labels and dashboard aggregation"). Building on B would
  entangle an unvalidated change with an urgent customer-facing fix and make rollback ambiguous.
- Stable A is the known-good, 99%-traffic, fully-promoted image with a clean rollback target.
- Therefore Phase 1 and Phase 2 stay **separate**. Ship Phase 2 as `phase2-<sha>` built from A.

## Candidate-action decision table

| Candidate action | Safe in observed state? | Why |
|---|---|---|
| Update the public canary (B) in place with the label fix | ❌ No | Mutates an image that 1% of real customers are on; mixes two changes; muddies rollback. |
| Promote Phase 1 (B) to 100% to "ship faster" | ❌ No | Promotes an unvalidated, still-observing change to all customers under deadline pressure. |
| Freeze Phase 1 at 1% and build Phase 2 on stable A | ✅ Yes | Isolates the urgent fix on known-good base; rollback target stays `phase0-a17f3d2`. |
| Roll Phase 1 canary back to 0% first, then ship Phase 2 on A | ✅ Yes (preferred) | Removes the confounding variable entirely before the urgent change; cleanest rollback. |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| 14:40 | Snapshot rollout state from `ops/current-rollout-state.json` | values in table above | none (read-only) |
| 14:45 | Freeze Phase 1: hold canary at 1%, do not promote/mutate B | rollout state unchanged | none |
| 14:50 | Shift canary weight 1% → 0% (drain Phase 1 from public traffic); keep B deployed but dark | ALB weights stable 100 / canary 0 | none — stable A serves 100% |
| 15:00 | Build `gateway:phase2-<sha>` from stable A with label-only change; deploy to canary target group | image digest / build log | none — 0% weight |
| 15:10 | Smoke-test Phase 2 canary at 0% public weight (synthetic traffic) | smoke checks below | none |
| 15:20 | Shift canary weight 0% → 1% to Phase 2 image; observe | ALB weights stable 99 / canary 1 | bounded to 1% |
| 15:35 | If healthy, promote Phase 2 to stable (new stable = `phase2-<sha>`), weight 100/0 | ALB weights stable 100 / canary 0 | none if smoke green |
| later | Re-introduce Phase 1 separately on top of the new stable for its own observation | follow-up ticket | deferred |

## Smoke checks (must pass before each weight increase)

- **Availability:** `GET /health` 200 on stable and canary target groups; p99 latency unchanged.
- **Customer-facing label:** dashboard returns two distinct fields — `Usage (list price) = 100.00`
  and `Charged to prepaid wallet = 40.00`.
- **Ledger semantics unchanged:** wallet debit for a settlement = `official x 0.4` = `40.00`; exactly
  one debit per settlement id (no double billing).
- **No metadata leak:** provider settlement / upstream credential values absent from customer
  dashboard payload.

## Final state

- **Stable image:** `registry.example.com/gateway:phase2-<sha>` (label fix, built from A) after
  promotion — or `phase0-a17f3d2` if promotion is deferred past the deadline.
- **Canary image:** drained to 0% during the change; carries Phase 2 during validation.
- **ALB weights:** stable 100 / canary 0 at rest; stable 99 / canary 1 during Phase 2 observation.
- **Canary desired count:** 1.
- **Tests / smoke checks:** availability + label + ledger-idempotency smoke checks above.
- **Rollback target:** `gateway:phase0-a17f3d2` at 100% at every step (single weight shift back).
- **Remaining risks:** Phase 1's reporting change is deferred and must be re-validated on the new
  stable base; ensure its eventual rebase does not silently reintroduce the ambiguous label.
