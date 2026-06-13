# Part 2 - Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` |
| stable traffic weight | `99` | `ops/current-rollout-state.json` |
| canary traffic weight | `1` | `ops/current-rollout-state.json` |
| canary has public traffic? | `true` | `ops/current-rollout-state.json` |
| Phase 1 promoted? | no, status is `public canary observation, not promoted` | `ops/current-rollout-state.json` |

## 2. Phase 1 freeze decision

- Decision: freeze Phase 1 immediately, then unwind public canary traffic before shipping urgent Phase 2.
- Reason: Phase 1 already changes team prepaid usage reporting labels and dashboard aggregation; the urgent ticket is in the same semantic area. Because canary has public traffic and is not promoted, updating it in place would combine two unproven changes and weaken rollback.
- What must not happen next: do not promote Phase 1, do not patch image B in place, and do not let maintenance jobs run on canary while billing semantics are under review.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: base urgent Phase 2 on stable image A: `registry.example.com/gateway:phase0-a17f3d2`.
- Dependency evidence: Phase 1 summary is `team prepaid usage reporting labels and dashboard aggregation`, which overlaps the incident; it is not promoted and has only 1% public traffic.
- Rollback target: stable image A at 100% traffic before urgent patch promotion; after urgent patch promotion, rollback to the last healthy stable deployment.

## 4. High-availability sequence

```text
1. Freeze Phase 1: stop promotion, stop traffic increases, and mark canary image B unpromoted.
2. Shift ALB weights from 99/1 to 100/0 after health checks confirm stable image A is healthy.
3. Build urgent Phase 2 image from stable image A with only the customer-facing cost display label/read-model change.
4. Deploy urgent Phase 2 as a fresh canary with desired count 1 and ALB weight 1%.
5. Run smoke checks: health, dashboard label, official usage $100.00, prepaid debit $40.00, provider balance unchanged, load-balancing weight unchanged.
6. Increase urgent Phase 2 traffic gradually, keeping previous healthy stable as rollback target at each step.
7. Promote urgent Phase 2 only after smoke checks stay green; keep Phase 1 image B out of production until separately reviewed.
```

## 5. Customer-invisibility proof

- API availability check: stable desired count remains 2 while any canary desired count is 1; traffic shifts use ALB weights rather than stopping all targets.
- Dashboard/customer-facing check: Acme display uses `Prepaid wallet debit: $40.00` as the customer primary amount and `Official list-price usage: $100.00` as reporting context.
- Billing semantic check: raw usage and official usage reporting remain `$100.00`; prepaid multiplier affects only payable debit.
- Ledger idempotency check: no ledger writer or retry path is touched; helper is pure display construction.
- Provider/internal metadata leakage check: provider balance and load-balancing weight are internal invariants and are not customer labels.

## 6. Final state

- Stable image: urgent Phase 2 image based on `registry.example.com/gateway:phase0-a17f3d2`.
- Canary image: original Phase 1 `registry.example.com/gateway:phase1-b93c1a8` remains frozen/unpromoted.
- ALB weights: target 100/0 after urgent patch promotion; during validation use 99/1 with clear rollback.
- Remaining Phase 1 disposition: return to product/engineering review after Acme QBR risk is resolved.
- Remaining risks: dashboard consumers may have cached the old label; support should communicate the new wording and confirm QBR screenshot freshness.
