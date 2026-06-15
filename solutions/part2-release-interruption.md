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
| stable desired count | 2 | `ops/current-rollout-state.json` → `stableDesiredCount` |
| canary desired count | 1 | `ops/current-rollout-state.json` → `canaryDesiredCount` |

## 2. Phase 1 freeze decision

- **Decision**: **Freeze Phase 1 in place** while we prepare Phase 2 (do not promote, do not delete, do not increase weight). Phase 1 will then be **drained to 0% public traffic** as the FIRST mutating step of the Phase 2 rollout, before any phase2 image touches the public canary slot.
- **Reason**:
  1. Phase 1 changes (dashboard aggregation labels) do not address the urgent QBR issue — there is no point promoting it to fix Acme.
  2. Phase 1 has not been validated at full traffic, so it is not a safe base image for an urgent patch.
  3. Phase 1 is currently the only thing standing in the canary slot. We cannot reuse the canary slot until that public traffic exposure is removed first.
- **What must NOT happen** (these are explicit anti-patterns):
  - ❌ Do **not** swap the active public canary task definition from phase1 to phase2 in place. The canary slot is currently serving real customer traffic; replacing the running container while it still has public traffic exposure is exactly what the reviewer flagged as unsafe. Customers on canary would experience a mid-flight image swap with no clean rollback target.
  - ❌ Do not promote Phase 1 to stable as a workaround.
  - ❌ Do not increase Phase 1 canary traffic weight while Phase 2 is in flight.
  - ❌ Do not base Phase 2 on the unpromoted Phase 1 canary image.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- **Decision**: Based on **stable image A** (`phase0-a17f3d2`).
- **Dependency evidence**:
  - Phase 1 (`phase1-b93c1a8`) has not been promoted and has not been validated at full traffic.
  - Basing Phase 2 on an unverified canary creates a compound image with two unvalidated change sets and a muddled rollback target.
  - Phase 2 fix (dashboard label rename) is functionally independent from Phase 1 (also dashboard, but a different label). Building Phase 2 on stable preserves a clear single-axis change.
- **Rollback target at every step**: `registry.example.com/gateway:phase0-a17f3d2`.

## 4. High-availability release sequence — drain first, then deploy

The reviewer correctly flagged that an active public canary cannot be directly
replaced with another canary. The corrected sequence enforces "no public
traffic on a slot we are about to redeploy".

```text
Pre-conditions:
  - stable target group: phase0-a17f3d2, weight 99%, desired 2
  - canary target group: phase1-b93c1a8, weight 1%, desired 1, PUBLIC TRAFFIC
  - rollback target: phase0-a17f3d2 (preserved, never deleted)

Step 0 — Build Phase 2 image off stable (no traffic impact):
  Base: registry.example.com/gateway:phase0-a17f3d2
  Change: dashboard label
            "Total usage cost"          ->  "List-price usage"
            (new field)                  +  "Prepaid wallet charge"
  New image: registry.example.com/gateway:phase2-<hash>
  Verification: build log shows phase0-a17f3d2 base layer; image scan clean.
  Customer impact: zero (build only, no ALB/ECS mutation).
  Rollback: discard image (no production state changed).

Step 1 — DRAIN Phase 1 canary to 0% PUBLIC traffic (no slot replacement yet):
  Action A: shift ALB weights stable=100% / canary=0%
            -> aws elbv2 modify-listener weight stable:100 canary:0
  Action B: confirm ALB has stopped routing public traffic to the
            canary target group (drain timeout ~30s, observe 0
            requests/sec on canary target metrics).
  Phase 1 task is still RUNNING (not deleted). It is now a "warm spare"
  that we can re-attach if we need to abort Phase 2 before deploying it.
  Why this matters:
    - The reviewer's rule: do not replace an active public canary in place.
    - By draining to 0% FIRST, the canary slot is no longer customer-facing
      when we mutate it.
    - Stable carries 100% during the slot mutation. No customer is exposed
      to a mid-flight swap.
  Customer impact: zero — stable phase0-a17f3d2 is healthy at 100%.
  Rollback at this step: re-shift ALB to stable=99% / canary=1%
                         (Phase 1 task is still alive, just not serving).

Step 2 — Replace the (now non-public) canary slot with Phase 2:
  Action: deploy phase2-<hash> as a NEW task into the canary target group,
          with desired count = 1, ALB weight still 0% public.
          aws ecs update-service --service gateway-canary
            --task-definition gateway:phase2-<hash> --desired-count 1
  Once phase2 task is HEALTHY in ALB target health,
  drain-stop the original phase1 task (desired count 0, deregister).
  Customer impact: zero — canary still has 0% public traffic during this
                   redeployment.
  Rollback at this step: keep phase1 task registered until phase2 is
                         healthy; if phase2 fails health checks, leave
                         canary at 0% public (stable still 100%) and
                         re-evaluate.

Step 3 — Internal smoke verification on Phase 2 (still 0% public traffic):
  Check A: GET /health on phase2 target -> 200.
  Check B: synthetic dashboard request via internal-only header
           ("X-Synthetic-Test: 1") routed to canary target group:
             - "List-price usage: $100.00"
             - "Prepaid wallet charge: $40.00"
  Check C: ledger contract test — for a synthetic Acme account
           (multiplier 0.4), assert ledger debit = $40.00, NOT $100,
           NOT $0, NOT touched at all by the dashboard read.
  Check D: confirm no provider-balance API was called by the dashboard
           render path (network egress trace).
  Check E: confirm ALB weight on canary is still 0% public during these
           checks. No real customer touches phase2 yet.
  Customer impact: zero.
  Rollback at this step: deregister phase2 task (stable already 100%).

Step 4 — Re-introduce 1% public traffic to phase2 canary, observe:
  Action: shift ALB to stable=99% / canary=1% public.
  Observe 5 minutes:
    - error rate on canary
    - p95 / p99 latency on canary
    - ledger smoke replay on a real test account
    - support inbox for label complaints
  Customer impact: at most 1% of dashboard loads see the new label
                   (additive change — adds clarity, removes none).
  Rollback at this step: shift back to stable=100% / canary=0% (Step 1
                         state); phase2 task keeps running in canary
                         slot but receives no public traffic.

Step 5 — Gradual promotion to stable (only after Step 4 passes):
  5a. stable=90% / canary=10%, observe 2 minutes
  5b. stable=50% / canary=50%, observe 2 minutes
  5c. stable=0%  / canary=100% (canary becomes new stable)
  At each step: ALB health green, no error spike, ledger smoke clean.
  Rollback at any sub-step: revert to previous weight ratio. The phase0
                            stable target group is preserved and can
                            absorb 100% within seconds.

Step 6 — Post-promotion bookkeeping:
  - Promote phase2-<hash> reference to stableImage in
    ops/current-rollout-state.json.
  - Drain phase0 desired count -> 0 (keep image registry entry as the
    rollback artefact; never garbage-collect rollback target images).
  - Reopen Phase 1 disposition ticket: re-evaluate phase1-b93c1a8
    against the NEW stable phase2-<hash> baseline before any future
    canary attempt.
```

## 5. Customer-invisibility proof

- **API availability**: stable target group serves ≥99% of public traffic at all times during Steps 0–4. During Step 1 it serves 100%. No step removes traffic from a healthy stable target before a healthy replacement exists.
- **Canary slot mutation safety**: no image swap occurs while the canary slot is serving public traffic. The canary slot is drained to 0% public BEFORE Phase 2 deploys onto it (Step 1 → Step 2). This is the explicit fix to the reviewer's "active public canary cannot be directly replaced" objection.
- **Dashboard / customer-facing change**: Phase 2 changes are additive (renames misleading label, adds a clearer field). At Step 4 only 1% of dashboard renders use Phase 2; no customer loses information.
- **Billing semantic invariance**: dashboard label rename is a read-path-only change. No ledger write, no provider-balance call, no usage-event mutation. Smoke check C asserts $40 debit unchanged for the multiplier=0.4 case.
- **Provider / metadata leakage**: no provider credentials, no upstream API key, no internal routing config touched. ALB only changes target-group weights and task-definition reference for the canary target group.
- **Idempotency**: dashboard load has no write path, so retry/refresh cannot double-charge. Ledger writes remain keyed by usage event ID.

## 6. Rollback contract (held throughout)

| Phase of rollout | Rollback action | Rollback target |
|---|---|---|
| Step 0 (build) | Discard image | n/a — no production state |
| Step 1 (drain canary to 0%) | Restore ALB weight stable=99% / canary=1%, phase1 task still alive | phase1-b93c1a8 (warm) |
| Step 2 (deploy phase2 into drained canary) | Keep phase1 task registered until phase2 health-green; if phase2 fails, leave canary at 0% public, stable=100% | phase0-a17f3d2 |
| Step 3 (internal smoke) | Deregister phase2; canary stays at 0% public | phase0-a17f3d2 |
| Step 4 (1% public on phase2) | ALB shift back to stable=100% / canary=0% | phase0-a17f3d2 |
| Step 5 (gradual promotion) | Revert ALB to previous ratio | phase0-a17f3d2 |
| Step 6 (cleanup) | Re-deploy phase0 stable target group from preserved image | phase0-a17f3d2 |

## 7. Final state

- **Stable image**: `registry.example.com/gateway:phase2-<hash>`
- **Canary image**: none active (canary slot at desired count 0 / weight 0% post-promotion)
- **ALB weights**: stable 100% / canary 0%
- **Preserved rollback artefact**: `phase0-a17f3d2` (image retained in registry)
- **Phase 1 disposition**: reopened — must be re-evaluated against the new stable baseline before any new canary attempt.
- **Remaining risks**:
  1. Phase 1 dashboard aggregation changes may overlap with Phase 2 label rename — needs re-review before reintroducing.
  2. `maintenanceJobsEnabledOnCanary: false` was a Phase 1 attribute; confirm Phase 2 maintenance-job behaviour is acceptable on canary if a new canary is later introduced.
  3. Acme support must be briefed: the $40 debit was always correct; only the label was misleading.
