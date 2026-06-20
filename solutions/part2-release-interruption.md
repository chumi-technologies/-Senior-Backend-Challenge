# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` |
| stable traffic weight | 99% | `ops/current-rollout-state.json` |
| canary traffic weight | 1% | `ops/current-rollout-state.json` |
| canary has public traffic? | yes (`canaryHasPublicTraffic: true`) | `ops/current-rollout-state.json` |
| Phase 1 promoted? | no (`phase1Status: "public canary observation, not promoted"`) | `ops/current-rollout-state.json` |

## 2. Phase 1 freeze decision

- **Decision:** Freeze Phase 1, then **drain it to 0% public traffic** before shipping Phase 2.
  Keep image B deployed but dark; do not promote it.
- **Reason:** Phase 1 touches the same subsystem as the urgent fix (prepaid usage reporting labels
  and dashboard aggregation). Leaving it on live traffic while we ship an urgent label change makes
  causation and rollback ambiguous. Draining to 0% removes the confounding variable with zero
  customer impact (stable A absorbs 100%).
- **What must not happen next:** Do not promote B to 100%; do not edit B in place; do not let the
  urgent fix ride on top of B.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- **Decision:** Base it on **stable image A (`phase0-a17f3d2`)**.
- **Dependency evidence:** B is unvalidated and modifies the exact reporting/labeling code path the
  ticket is about; building Phase 2 on B couples two changes and forfeits a clean rollback. A is the
  fully-promoted, known-good image currently serving 99% of traffic.
- **Rollback target:** `gateway:phase0-a17f3d2` at 100% weight — reachable by a single ALB weight
  shift at every step.

## 4. High-availability sequence

```text
1. Freeze Phase 1; snapshot ALB weights (stable 99 / canary 1).
2. Drain canary 1% -> 0% so stable A serves 100% (customers unaffected).
3. Build gateway:phase2-<sha> from stable A with the label-only fix (two distinct lines:
   "Usage (list price)" and "Charged to prepaid wallet").
4. Deploy phase2 image to the canary target group at 0% weight; run synthetic smoke checks.
5. Shift canary 0% -> 1% to phase2; observe availability + ledger smoke checks.
6. If green, promote phase2 to stable (100/0). New stable = phase2-<sha>.
7. Re-introduce Phase 1 later as its own canary on top of the new stable.
```

## 5. Customer-invisibility proof

- **API availability check:** `GET /health` returns 200 on both target groups throughout; stable A
  serves 100% during the swap so there is no window of degraded capacity.
- **Dashboard/customer-facing check:** after Phase 2, dashboard shows `Usage (list price): $100.00`
  and `Charged to prepaid wallet: $40.00` as separate labeled values.
- **Billing semantic check:** wallet debit = `official x 0.4 = $40.00`; the multiplier is applied
  only to the ledger debit, not to raw usage or the list-price report.
- **Ledger idempotency check:** replaying a settlement event yields exactly one debit (no double
  billing); balance delta = $40.00.
- **Provider/internal metadata leakage check:** provider settlement and upstream credential values
  do not appear in the customer dashboard payload.

## 6. Final state

- **Stable image:** `gateway:phase2-<sha>` after promotion (or `phase0-a17f3d2` if the 60-minute
  deadline forces deferring promotion — the 0% drain + canary-validated fix is still safe to hold).
- **Canary image:** Phase 2 during validation; Phase 1 (B) parked dark for later re-validation.
- **ALB weights:** stable 100 / canary 0 at rest.
- **Remaining Phase 1 disposition:** deferred; must be rebased on the new stable and re-observed,
  with an explicit check that it does not reintroduce the ambiguous single-label aggregation.
- **Remaining risks:** time pressure may tempt promotion before full observation — bound risk by
  keeping canary at 1% until smoke checks are green; rollback is always one weight shift to A.
