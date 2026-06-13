# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` |
| stable traffic weight | `99` | `ops/current-rollout-state.json` |
| canary traffic weight | `1` | `ops/current-rollout-state.json` |
| canary has public traffic? | `true` | `ops/current-rollout-state.json` |
| maintenance jobs enabled on canary? | `false` | `ops/current-rollout-state.json` |
| Phase 1 promoted? | No; status is `public canary observation, not promoted` | `ops/current-rollout-state.json` |

## 2. Phase 1 freeze decision

- Decision: freeze Phase 1 and stop increasing its public traffic.
- Reason: Phase 1 is already receiving 1% public traffic but is not promoted. It also touches prepaid usage labels/dashboard aggregation, the same business area as the urgent Phase 2 fix.
- What must not happen next: do not promote Phase 1, do not increase canary weight, and do not replace the public canary image while it still has traffic.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: base Phase 2 on stable A: `registry.example.com/gateway:phase0-a17f3d2`.
- Dependency evidence: Phase 2 is a display fix for Part 1 billing semantics. It does not require Phase 1's unpromoted dashboard aggregation work. Keeping it based on stable A keeps one variable in the release result.
- Rollback target: stable A remains the rollback target until the Phase 2 patch C is proven and promoted.

## 4. High-availability sequence

```text
1. Freeze Phase 1; record current stable/canary images and traffic weights.
2. Confirm stable A is healthy and has capacity for 100% traffic.
3. Keep canary maintenance jobs disabled and verify no billing jobs, migrations, ledger backfill, or aggregation writers run on canary.
4. Shift public canary traffic from 1% to 0% so Phase 1 no longer serves customers.
5. Build Phase 2 patch C from stable image A with only the display/label fix.
6. Deploy C to the canary target at 0% public traffic.
7. Run availability and billing-semantics smoke checks.
8. If checks pass, shift a small public canary percentage to C.
9. Promote C only after canary checks stay healthy; keep A as rollback target.
```

If any step fails before promotion, return traffic to stable A `100%` and keep canary at `0%`.

Rollback detail:

| Phase | Rollback action |
|---|---|
| C fails at 0% canary | Keep stable A `100%`, canary `0%`; discard C. |
| C fails after small canary traffic | Shift canary back to `0%`; stable A serves `100%`. |
| C fails after promotion | Roll stable image back to `registry.example.com/gateway:phase0-a17f3d2`. |

## 5. Customer-invisibility proof

- API availability check: health and dashboard routes pass before and after each traffic shift.
- Dashboard/customer-facing check: Acme no longer sees `$100.00` labeled as the prepaid wallet debit; `$40.00` is labeled as amount deducted / wallet debit.
- Billing semantic check: official list-price usage remains `$100.00`; payable prepaid debit remains `$40.00`; prepaid multiplier remains `0.4`.
- Ledger idempotency check: ledger entry id/count is unchanged, and replaying the usage event does not create another debit.
- Canary side-effect check: `maintenanceJobsEnabledOnCanary` remains `false`, and the release checklist verifies no billing jobs, migrations, ledger backfill, or usage aggregation writers run while validating C.
- Provider/internal metadata leakage check: response does not expose provider settlement, provider account balance, upstream credential, or routing metadata.

## 6. Final state

- Stable image: remains stable A until Phase 2 patch C passes canary and is promoted.
- Canary image: Phase 1 canary B is frozen; Phase 2 patch C should replace it only after canary traffic is zero.
- ALB weights: planned first state is stable `100` / canary `0`; later canary weight increases only after smoke checks.
- Canary side effects: verify production-writing jobs remain disabled during validation.
- Remaining Phase 1 disposition: keep Phase 1 separate. Revisit it after the urgent Phase 2 customer-facing fix is complete.
- Remaining risks: this repository records the release plan, not real command output; actual release tooling must capture command results and metrics.
