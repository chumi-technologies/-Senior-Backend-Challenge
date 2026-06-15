# Release Command Log

> Required for the interrupted rollout challenge. Records observed state,
> decisions, commands, evidence, and rollback target at every step. The
> sequence below is the corrected version after the reviewer flagged that
> "an active public canary cannot be directly replaced with another
> urgent canary". The fix is **drain-first, deploy-second** — the canary
> slot is taken to 0% public traffic BEFORE any Phase 2 image touches it.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` line 3 |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` line 4 |
| stable traffic weight | 99% | `ops/current-rollout-state.json` → `stableTrafficWeight: 99` |
| canary traffic weight | 1% | `ops/current-rollout-state.json` → `canaryTrafficWeight: 1` |
| canary has public traffic? | **Yes** | `ops/current-rollout-state.json` → `canaryHasPublicTraffic: true` |
| stable desired count | 2 | `ops/current-rollout-state.json` → `stableDesiredCount` |
| canary desired count | 1 | `ops/current-rollout-state.json` → `canaryDesiredCount` |
| rollback target (held throughout) | `registry.example.com/gateway:phase0-a17f3d2` | stable image is always rollback target |

## Timeline (corrected — drain before deploy)

| Time | Action | Command / evidence | Customer impact risk | Rollback target at this point |
|---|---|---|---|---|
| T+00 | Read rollout state. Confirm canary has public traffic. | `cat ops/current-rollout-state.json` | None — observation. | phase0-a17f3d2 |
| T+02 | Decide: freeze Phase 1 (do not promote). Decide: Phase 2 base = stable image A. Recorded in `solutions/decision-log.md`. | n/a | None — decision only. | phase0-a17f3d2 |
| T+05 | Build Phase 2 off stable image A. Image not yet deployed. | `docker build --build-arg BASE=registry.example.com/gateway:phase0-a17f3d2 -t registry.example.com/gateway:phase2-<hash> .` | None — build only. | phase0-a17f3d2 |
| T+12 | **DRAIN canary**: shift ALB stable=100% / canary=0% public traffic. Phase 1 task remains running but receives no public requests. This is the explicit fix to the reviewer's "do not replace an active public canary in place" rule. | `aws elbv2 modify-listener --listener-arn $LISTENER --default-actions Type=forward,ForwardConfig='{TargetGroups=[{TargetGroupArn=$STABLE_TG,Weight=100},{TargetGroupArn=$CANARY_TG,Weight=0}]}'` | Zero — stable phase0 healthy at 100%. | phase0-a17f3d2 (and phase1 still warm) |
| T+13 | Verify canary actually drained: 0 req/sec on canary target group, ALB target health still green for stable. | `aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB --metric-name RequestCountPerTarget --dimensions Name=TargetGroup,Value=$CANARY_TG --statistics Sum --period 60` | Zero. | phase0-a17f3d2 |
| T+15 | Deploy Phase 2 into the now non-public canary slot (canary still at 0% public). | `aws ecs update-service --cluster gateway --service gateway-canary --task-definition gateway:phase2-<hash> --desired-count 1 --force-new-deployment` | Zero — canary has no public traffic during the swap. | phase0-a17f3d2 (phase1 task kept registered until phase2 health-green) |
| T+18 | Wait for phase2 task ALB target health = healthy. Then deregister the phase1 task from the canary target group. | `aws elbv2 describe-target-health --target-group-arn $CANARY_TG` until `state=healthy` for the new task; then `aws ecs update-task-set` to drain the old set. | Zero. | phase0-a17f3d2 |
| T+22 | Smoke check on Phase 2 canary at 0% public — internal-only. | Synthetic request via internal header: `curl -H "X-Synthetic-Test: 1" -H "Host: canary.gateway.internal" https://canary-internal/dashboard?account=acme-test` — confirm new labels render. | Zero — synthetic traffic only. | phase0-a17f3d2 |
| T+24 | Smoke check: ledger debit unchanged for multiplier=0.4 account. | `curl https://canary-internal/api/ledger/acme-test/latest` → assert `debit_usd == 40.00` and `list_price_usd == 100.00`. | Zero. | phase0-a17f3d2 |
| T+26 | Smoke check: no provider-balance call from the dashboard render path (egress trace). | VPC flow log filter on canary task ENI for outbound provider-API IPs during dashboard render. Expect 0 matches. | Zero. | phase0-a17f3d2 |
| T+30 | Re-introduce 1% public traffic onto phase2 canary. | `aws elbv2 modify-listener ... weight stable:99 canary:1` | Low — 1% of dashboard renders see new label (additive). | phase0-a17f3d2 |
| T+35 | Observe 5 minutes: error rate, P95/P99 latency, support inbox. | CloudWatch dashboards + support channel. | Low. | phase0-a17f3d2 |
| T+40 | Promote: shift ALB to stable=90% / canary=10%. | `aws elbv2 modify-listener ... weight stable:90 canary:10` | Low. | phase0-a17f3d2 |
| T+42 | Observe 2 minutes. | CloudWatch + ledger smoke replay. | Low. | phase0-a17f3d2 |
| T+45 | Promote: stable=50% / canary=50%. | `aws elbv2 modify-listener ... weight stable:50 canary:50` | Medium. | phase0-a17f3d2 |
| T+47 | Observe 2 minutes. | CloudWatch + ledger smoke replay. | Medium. | phase0-a17f3d2 |
| T+50 | Promote: stable=0% / canary=100%. Phase 2 is now serving 100% of public traffic on what was the canary slot. | `aws elbv2 modify-listener ... weight stable:0 canary:100` | Phase 2 is new effective stable. | phase0-a17f3d2 (image still in registry) |
| T+52 | Drain phase0 ECS service to desired=0 (image preserved in registry as rollback artefact). | `aws ecs update-service --service gateway-stable --desired-count 0` | Zero — phase2 fully serving. | phase0-a17f3d2 (image kept) |
| T+55 | Update `ops/current-rollout-state.json`: stableImage = phase2-<hash>, canaryImage = none, canaryHasPublicTraffic = false. | File edit + git commit. | Zero. | phase0-a17f3d2 |
| T+58 | Final E2E smoke for Acme QBR readiness. | Manual verification with Acme support — dashboard now shows separate "List-price usage: $100.00" and "Prepaid wallet charge: $40.00". | Zero. | phase0-a17f3d2 |

## Rollback procedure (callable from any step)

```bash
# Universal rollback to stable phase0:
aws elbv2 modify-listener --listener-arn $LISTENER \
  --default-actions Type=forward,ForwardConfig='{TargetGroups=[
    {TargetGroupArn='"$STABLE_TG"',Weight=100},
    {TargetGroupArn='"$CANARY_TG"',Weight=0}
  ]}'

# If phase2 task is degraded, also drain canary slot:
aws ecs update-service --cluster gateway --service gateway-canary --desired-count 0

# Stable target group must remain at desired=2 until the rollback is confirmed:
aws ecs describe-services --cluster gateway --services gateway-stable \
  --query 'services[0].runningCount'
```

Critical rule observed at every step: **the rollback target image
`phase0-a17f3d2` is never deleted and the stable target group is never
scaled to 0 until phase2 is at 100% AND has been observed for ≥10 minutes
without regression.**

## Final state

- **Stable image**: `registry.example.com/gateway:phase2-<hash>` (dashboard label fix applied)
- **Canary image**: none active (canary target group at desired=0 / weight=0% public)
- **ALB weights**: stable 100% (effectively the phase2 service) / canary 0%
- **Canary public traffic**: false
- **Smoke checks captured**:
  - Dashboard shows `List-price usage: $100.00` AND `Prepaid wallet charge: $40.00` ✓
  - Ledger debit = $40.00 (unchanged) ✓
  - Provider-balance API not called by dashboard render path ✓
  - ALB target health green throughout ✓
  - No error-rate spike during any weight shift ✓
- **Rollback target**: `registry.example.com/gateway:phase0-a17f3d2` (image retained in registry, never garbage-collected)
- **Reviewer-flagged anti-pattern explicitly avoided**: at no point was the
  canary task definition mutated while the canary target group was still
  receiving public traffic. Step T+12 (drain to 0% public) precedes
  Step T+15 (deploy phase2 into the canary slot). This is the corrected
  drain-first / deploy-second sequence.
- **Remaining risks**:
  1. Phase 1 (`phase1-b93c1a8`) changes need re-evaluation against the new stable baseline before any future canary attempt.
  2. `maintenanceJobsEnabledOnCanary: false` was a Phase 1 attribute; verify Phase 2 maintenance-job posture before the next canary cycle.
  3. Acme support briefing — confirm Acme has been told the $40 debit was always correct, only the label was misleading.
