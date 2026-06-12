# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` (image A) | `ops/current-rollout-state.json` `.stableImage` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` (image B) | `ops/current-rollout-state.json` `.canaryImage` |
| stable traffic weight | 99 (desired count 2) | `.stableTrafficWeight`, `.stableDesiredCount` |
| canary traffic weight | 1 (desired count 1) | `.canaryTrafficWeight`, `.canaryDesiredCount` |
| canary has public traffic? | **true** | `.canaryHasPublicTraffic` |
| Phase 1 promoted? | No — "public canary observation, not promoted" | `.phase1Status` |

Additional constraints observed: maintenance jobs disabled on canary (`.maintenanceJobsEnabledOnCanary: false`); urgent patch deadline 60 minutes (`.urgentPatchDeadlineMinutes`); Phase 1 changes "team prepaid usage reporting labels and dashboard aggregation" (`.phase1ChangeSummary`) — i.e. **Phase 1 touches the same dashboard surface as the urgent Phase 2 fix.**

## 2. Phase 1 freeze decision

- Decision: **Freeze Phase 1 now and drain its public traffic** (no promotion, no further observation, no in-place modification of image B).
- Reason: Phase 1 is unvalidated (still observing, never promoted) and overlaps the urgent fix's surface (dashboard labels/aggregation). Any sequence that lets Phase 1 ride along puts unvalidated changes in front of customers during an emergency. Draining the 1% also removes the risk that Acme hits the canary during their QBR and sees a third label variant.
- What must not happen next:
  - No in-place update of the canary while `canaryHasPublicTraffic: true` — that deploys an unvalidated image directly into live traffic with no isolated rollback.
  - No promotion of image B "since we're deploying anyway".
  - No image build that layers the urgent fix on top of B.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: **Base on stable image A.** Build image C = A + the minimal label fix from Part 1 (relabel official aggregate + add ledger-read payable line; no money-path changes).
- Dependency evidence: Part 2's fix needs nothing from Phase 1 — it changes label strings and adds a ledger read. Phase 1's aggregation changes are unvalidated and untested against the urgent fix; basing on B would couple an emergency deploy to an unfinished rollout (`.phase1Status` proves B was never promoted).
- Rollback target: image A on the stable target group, reachable at every step by a single ALB weight shift. A's tasks (desired 2) stay running until after the QBR — rollback is a traffic action, not a redeploy.

## 4. High-availability sequence

```text
1. T+0   Record observed rollout state (the table above) into the release log. No mutation.
2. T+5   Freeze Phase 1: shift ALB weights stable 100 / canary 0. Image B keeps running with
         zero public traffic (becomes a private/shadow canary). Connection draining handles
         in-flight canary requests. Rollback: restore weights 99/1.
3. T+10  Build/deploy image C (= stable A + label fix) onto the canary target group, replacing B.
         Safe because the canary group now serves no public traffic.
4. T+20  Private smoke on the canary target group at weight 0 (synthetic requests through the
         target group, health checks): availability, official $100 unchanged, single $40 debit
         unchanged, new label strings render. Failure here = stop; customers never saw C.
5. T+30  Shift 5% public to C (weights 95/5). Watch error rate, latency, dashboard rendering,
         billing smoke (step 6 checks) for ~5 minutes. Rollback: weights 100/0 (back to pure A).
6. T+40  Promote: shift 100% to C (weights 0/100). Justified for a label-only diff with a warm,
         instant rollback: image A still runs desired 2 on the stable target group; rollback is
         one weight shift. Acme's QBR view is now fixed.
7. T+50  Re-run billing smoke on full traffic; brief support/sales with the two-label explanation
         before the QBR.
8. post  Housekeeping after the QBR: redeploy C onto the stable target group, return weights to
         the normal stable/canary topology, then rebase Phase 1 (B' = C + aggregation changes)
         and restart Phase 1's own canary cycle from scratch.
```

## 5. Customer-invisibility proof

- API availability check: every transition is an ALB weight shift between two healthy target groups with connection draining — no in-place restart under load, no DNS change, no dropped in-flight requests. Health checks gate each target group before it takes weight.
- Dashboard/customer-facing check: customers see either the old label (A) or the fixed labels (C) — never an error page and never Phase 1's unvalidated aggregation (B is drained at step 2 before anything else moves).
- Billing semantic check: smoke asserts official aggregate still `$100.00` and payable still a single `$40.00` ledger debit for the incident window, on canary (step 4), at 5% (step 5), and at 100% (step 7).
- Ledger idempotency check: ledger row count over the deploy window grows only by organic traffic; replaying a sampled usage-event id yields no duplicate debit; `debit == official x multiplier` holds on sampled tenants.
- Provider/internal metadata leakage check: response payload diff between A and C is limited to the two label fields; no provider account, settlement price, or routing metadata appears in the new payload.

## 6. Final state

- Stable image: `gateway:phase2-<c-sha>` (image C = A + label fix) serving 100% of traffic.
- Canary image: none active — B was drained and replaced; the canary slot is free for Phase 1's restart.
- ALB weights: 0 (old stable group, image A warm as rollback) / 100 (group serving C); returned to the normal stable/canary topology during post-QBR housekeeping.
- Remaining Phase 1 disposition: frozen, never promoted, zero public exposure after T+5; to be rebased on C as B' and re-run through its own full canary observation cycle.
- Remaining risks: Phase 1's aggregation work is delayed by one rebase cycle (accepted); image A must be kept warm until post-QBR housekeeping completes (tracked); support must field "why did the label change" questions (briefing in step 7).
