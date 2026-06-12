# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

> Evidence honesty note: this repository provides the rollout state as a fixture (`ops/current-rollout-state.json`) and no live ALB/registry to run commands against. "Command" rows therefore record the exact action that would be issued and the artifact that must be captured as evidence; the only output reproduced verbatim here is the fixture itself. No fabricated command output appears in this log.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` (A) | `ops/current-rollout-state.json` `.stableImage` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` (B) | `.canaryImage` |
| stable traffic weight | 99 | `.stableTrafficWeight` |
| canary traffic weight | 1 | `.canaryTrafficWeight` |
| canary has public traffic? | true | `.canaryHasPublicTraffic` |
| rollback target | image A on the stable target group, desired 2, reachable by one weight shift at every step below | `.stableImage` + `.stableDesiredCount` |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| T+0 | Record rollout state; declare decision: freeze Phase 1, base urgent patch on A (decision log 12:44) | snapshot table above (fixture quoted verbatim) | none — read-only |
| T+5 | Freeze Phase 1: set listener weights stable 100 / canary 0 (`elbv2 modify-listener` on the gateway listener); keep B's task running at desired 1 with zero weight | capture: listener describe output showing 100/0 | none — traffic consolidates on known-good A; draining covers in-flight canary requests. Rollback: restore 99/1 |
| T+10 | Deploy image C (= A + label fix) to the canary target group, replacing B (`ecs update-service --service gateway-canary --task-definition gateway:C`) | capture: service deployment id + image digest of C | none — canary group has no public traffic at this point |
| T+20 | Private smoke against canary target group at weight 0: health checks green; official aggregate `$100.00`; single `$40.00` debit; new label strings present | capture: smoke run output (availability + billing assertions) | none — synthetic traffic only; failure stops the release before exposure |
| T+30 | Shift 5% public to C: weights 95/5; observe error rate / latency / rendering for ~5 min | capture: listener describe (95/5) + dashboards | bounded — 5% sees the label fix; rollback = weights 100/0, one action |
| T+40 | Promote: weights 0/100, C serves all traffic; A stays warm (desired 2) as instant rollback | capture: listener describe (0/100) + healthy target count on A | low — label-only diff, validated at weight 0 and 5%; rollback remains one weight shift to A |
| T+50 | Re-run billing smoke at 100%; brief support/sales before the QBR | capture: smoke output at full traffic | none — verification only |
| post-QBR | Housekeeping: redeploy C to the stable target group, restore normal stable/canary topology, then rebase Phase 1 (B' = C + aggregation changes) and restart its canary cycle | capture: final listener + service states | none — standard topology restore with both groups healthy |

## Final state

- Stable image: C (`gateway:phase2-<c-sha>` = A + label fix) serving 100% of public traffic.
- Canary image: none active; slot freed for Phase 1's rebased B' to start a fresh observation cycle.
- ALB weights: 0/100 immediately after promotion (A warm at weight 0 as rollback target); normal stable/canary topology restored in post-QBR housekeeping.
- Canary desired count: 1 throughout (B until T+10, then C); stable desired count 2 untouched.
- Tests / smoke checks: private smoke at weight 0 (T+20), 5% public observation (T+30), full-traffic billing smoke (T+50) — all assert availability plus billing semantics (official `$100.00` unchanged, single `$40.00` debit, `debit == official x multiplier`, no duplicate ledger entries, no provider/internal metadata in payload diff).
- Rollback target: image A, running and healthy for the entire sequence; every step's rollback is a single ALB weight action — no redeploy needed on the rollback path.
- Remaining risks: Phase 1 delayed one rebase cycle; A must stay warm until housekeeping completes; support briefing required for the label change.
