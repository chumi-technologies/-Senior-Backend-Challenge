# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` line 3 |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` line 4 |
| stable traffic weight | 99% | `ops/current-rollout-state.json` → `stableTrafficWeight: 99` |
| canary traffic weight | 1% | `ops/current-rollout-state.json` → `canaryTrafficWeight: 1` |
| canary has public traffic? | **Yes** | `ops/current-rollout-state.json` → `canaryHasPublicTraffic: true` |
| rollback target | `registry.example.com/gateway:phase0-a17f3d2` | stable image is always rollback target |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| T+00 | Observed rollout state: Phase 1 canary at 1% public traffic, not promoted | Read `ops/current-rollout-state.json` | None — observation only |
| T+02 | Decision: freeze Phase 1 canary at 1%; do not promote, do not rollback | `solutions/decision-log.md` entry | None — no config change |
| T+05 | Decision: Phase 2 based on stable image A (`phase0-a17f3d2`) | `solutions/decision-log.md` entry | None — decision only |
| T+10 | Build Phase 2 image: apply dashboard label fix on top of `phase0-a17f3d2` | `docker build --build-arg BASE=phase0-a17f3d2 -t gateway:phase2-<hash> .` | None — build only |
| T+15 | Smoke test Phase 2 image locally: verify label renders correctly, ledger unchanged | `docker run gateway:phase2-<hash>; curl localhost/dashboard?account=acme` | None — local only |
| T+20 | Deploy Phase 2 as new ALB canary; retire Phase 1 canary (desired count → 0) | `aws ecs update-service --service gateway-canary --task-definition gateway:phase2-<hash>` | Minimal: 1% traffic shifts from Phase 1 canary to Phase 2 canary |
| T+22 | Health check: Phase 2 canary ALB target healthy | `aws elbv2 describe-target-health --target-group-arn <phase2-tg-arn>` | None |
| T+25 | Smoke check A: dashboard shows new labels for test account | `curl -H "X-Account: acme-test" https://canary.gateway.internal/dashboard` | 1% of real traffic |
| T+27 | Smoke check B: ledger debit unchanged ($40.00 for $100 list-price, multiplier 0.4) | `curl https://canary.gateway.internal/api/ledger/acme-test/latest` | None |
| T+30 | Promote: shift ALB to 10% phase2 / 90% phase0 | `aws elbv2 modify-rule --rule-arn <rule> --conditions weight:10:90` | Low — 10% canary exposure |
| T+32 | Observe: error rate, latency P99, dashboard label complaints | CloudWatch metrics dashboard | None expected |
| T+35 | Promote: shift ALB to 50% phase2 / 50% phase0 | `aws elbv2 modify-rule --rule-arn <rule> --conditions weight:50:50` | Medium — 50% canary exposure |
| T+37 | Observe: no error spike, ledger double-check clean | CloudWatch + ledger audit query | None expected |
| T+40 | Promote: shift ALB to 100% phase2 | `aws elbv2 modify-rule --rule-arn <rule> --conditions weight:100:0` | Phase 2 is now 100% stable |
| T+42 | Drain phase0 stable instances (desired count → 0) | `aws ecs update-service --service gateway-stable --desired-count 0` | None — phase2 fully serving |
| T+45 | Update deployment record; update `ops/current-rollout-state.json` | File edit + git commit | None |
| T+50 | Final smoke: end-to-end dashboard check for Acme Team QBR readiness | Manual verification with Acme Team support | None |

**Rollback procedure at any step:**
```
# If phase2 shows issues at any promotion step:
aws elbv2 modify-rule --rule-arn <rule> --conditions weight:0:100
# → 100% traffic back to phase0-a17f3d2 (stable)
# Phase2 canary desired count → 0
# Phase0 desired count → 2 (restore original stable count)
```

## Final state

- **Stable image**: `registry.example.com/gateway:phase2-<hash>` (dashboard label fix applied)
- **Canary image**: None active (Phase 1 `phase1-b93c1a8` desired count = 0, Phase 2 promoted to stable)
- **ALB weights**: stable 100% / canary 0%
- **Canary desired count**: 0
- **Tests / smoke checks**: 
  - Dashboard label shows `List-price usage: $100.00` and `Prepaid wallet charge: $40.00` ✓
  - Ledger debit = $40.00 (unchanged) ✓
  - ALB health check passes ✓
  - No error rate spike during promotion ✓
- **Rollback target**: `registry.example.com/gateway:phase0-a17f3d2` (retained, not deleted)
- **Remaining risks**:
  1. Phase 1 (`phase1-b93c1a8`) changes need re-evaluation against Phase 2 stable before reintroduction.
  2. `maintenanceJobsEnabledOnCanary: false` on Phase 1 — verify Phase 2 maintenance job behavior.
  3. Acme Team QBR: confirm support has briefed Acme that the $40 debit was always correct — only the label was misleading.
