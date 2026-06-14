# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` → `stableImage` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` → `canaryImage` |
| stable traffic weight | 99% | `ops/current-rollout-state.json` → `stableTrafficWeight: 99` |
| canary traffic weight | 1% | `ops/current-rollout-state.json` → `canaryTrafficWeight: 1` |
| canary has public traffic? | **Yes** — 1% of real user traffic is served by canary | `ops/current-rollout-state.json` → `canaryHasPublicTraffic: true` |
| Phase 1 promoted? | **No** — still in observation phase | `ops/current-rollout-state.json` → `phase1Status: "public canary observation, not promoted"` |

## 2. Phase 1 freeze decision

- **Decision**: **Freeze Phase 1** — keep canary at 1% weight, do not promote, do not roll back during Phase 2 deployment.
- **Reason**: 
  1. Phase 1 is in observation — rolling back now interrupts an already-running canary without evidence of harm.
  2. Phase 1 changes only dashboard labels (prepaid usage reporting aggregation) — it does not affect the urgent customer-facing issue (the $100 vs $40 label problem is present in stable too).
  3. Freezing allows Phase 1 to continue collecting canary data while Phase 2 is built and deployed independently.
  4. Phase 1 desired count remains 1 instance — minimal blast radius during freeze.
- **What must not happen next**:
  - Do NOT promote Phase 1 to stable during Phase 2 deployment window.
  - Do NOT increase Phase 1 canary traffic weight while Phase 2 is being built.
  - Do NOT use Phase 1 canary image as base for Phase 2 patch.
  - Do NOT drain Phase 1 canary traffic to 0% (would create availability gap without reducing risk).

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- **Decision**: Based on **stable image A** (`phase0-a17f3d2`).
- **Dependency evidence**:
  - Phase 1 (`phase1-b93c1a8`) has not been promoted and has not been validated at full traffic.
  - Basing Phase 2 on an unverified canary creates a compound image containing two unvalidated change sets.
  - If Phase 2 based on Phase 1 requires rollback, the rollback target becomes ambiguous — would rolling back take customers to Phase 0 (correct stable) or to a state between Phase 0 and Phase 1?
  - Phase 2 fix (dashboard label rename) is independent from Phase 1 changes (dashboard aggregation labels). No technical dependency exists.
  - Building on stable image A gives a clean, audited rollback target.
- **Rollback target**: `registry.example.com/gateway:phase0-a17f3d2` — always.

## 4. High-availability release sequence

```text
Pre-conditions: Phase 1 canary frozen at 1%, stable at 99%, rollback target = phase0-a17f3d2

Step 1 — Build Phase 2 image on top of stable:
  Base: registry.example.com/gateway:phase0-a17f3d2
  Change: rename dashboard label "Total usage cost" → "List-price usage"
          add separate "Prepaid wallet charge" field showing multiplied debit
  New image: registry.example.com/gateway:phase2-<hash>
  Verification: image build log shows phase0-a17f3d2 as base layer

Step 2 — Deploy Phase 2 as new canary (replace Phase 1 canary):
  Action: update ALB canary target group to phase2-<hash>
  Weight: 1% (same as Phase 1 canary)
  Phase 1 image: retired from ALB (desired count → 0 after traffic drained)
  Stable: remains at phase0-a17f3d2, 99% — no changes
  Customer impact: zero (canary traffic was already 1%, same users affected)
  Rollback: set ALB canary back to phase1-b93c1a8 or remove canary entirely → 100% stable

Step 3 — Smoke check Phase 2 canary (5 minutes):
  Check A: GET /health on phase2 instance returns 200
  Check B: Dashboard shows "List-price usage: $100.00" and "Prepaid wallet charge: $40.00" for test account with multiplier 0.4
  Check C: Ledger debit amount unchanged — assert $40.00 debit in ledger (not $100, not $0)
  Check D: No new ledger entries created by dashboard page load
  Check E: ALB health check passes for phase2 instance

Step 4 — Promote Phase 2 to stable (HA shift):
  Action: gradual weight shift phase2 canary → stable
    4a. Shift to 10% phase2 / 90% phase0 → observe 2 min
    4b. Shift to 50% / 50% → observe 2 min
    4c. Shift to 100% phase2 → phase0 desired count → 0
  At each step: confirm ALB health, no error rate spike, ledger smoke check passes
  Rollback at any step: revert ALB weights to previous ratio → phase0 back to 99%
  Final: phase2-<hash> is new stable at 100%

Step 5 — Post-promotion cleanup:
  Record new stable image in deployment record
  Update ops/current-rollout-state.json → stableImage = phase2-<hash>
  Schedule Phase 1 disposition decision (merge into next release or close as superseded)
```

## 5. Customer-invisibility proof

- **API availability check**: Stable image (`phase0-a17f3d2`) serves 99% of traffic at all times during Steps 1-3. Traffic is never fully shifted away from a healthy target group without first confirming the new target is healthy.
- **Dashboard/customer-facing check**: Phase 2 canary at 1% means at most 1% of dashboard page loads show the new label. The new label is additive (adds `Prepaid wallet charge` field) — customers see more information, not less. No breaking UI change.
- **Billing semantic check**: Dashboard label rename is a read-path change only. No write to ledger or usage event log occurs during the deployment. Ledger debit amount ($40) is unchanged before and after Phase 2.
- **Ledger idempotency check**: Dashboard page load has no write path to ledger. Re-loading the dashboard multiple times does not create additional debit entries. Ledger entries are keyed by usage event ID — no new event created by label rename.
- **Provider/internal metadata leakage check**: Phase 2 change is a frontend label rename. No provider credentials, API keys, routing configuration, or internal system metadata is exposed or modified. ALB routing rules change only target group reference — no provider-facing change.

## 6. Final state

- **Stable image**: `registry.example.com/gateway:phase2-<hash>` (Phase 2 promoted)
- **Canary image**: None (Phase 1 canary retired; no new canary during steady state)
- **ALB weights**: stable 100% / canary 0%
- **Remaining Phase 1 disposition**: Phase 1 (`phase1-b93c1a8`) changes (dashboard aggregation label changes) must be reviewed against Phase 2 stable baseline. If Phase 1 changes are compatible with Phase 2, they can be merged into Phase 3 release. Phase 1 canary instance desired count set to 0 (retired).
- **Remaining risks**: 
  1. Phase 1 and Phase 2 label changes may interact if Phase 1 was changing the same dashboard field — requires dependency analysis before Phase 3.
  2. If Phase 1 smoke data showed issues during its canary period, those must be resolved before reintroducing Phase 1 changes.
  3. `maintenanceJobsEnabledOnCanary: false` on Phase 1 — confirm Phase 2 canary has maintenance jobs enabled if needed.
