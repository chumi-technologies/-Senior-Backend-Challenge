# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` |
| stable traffic weight | `99` | `ops/current-rollout-state.json` |
| canary traffic weight | `1` | `ops/current-rollout-state.json` |
| canary has public traffic? | `true` | `ops/current-rollout-state.json` |
| Phase 1 promoted? | `false`; status is public canary observation, not promoted | `ops/current-rollout-state.json` |

## 2. Phase 1 freeze decision

- Decision: freeze Phase 1 immediately and do not increase public canary weight.
- Reason: Phase 1 is already receiving 1% real customer traffic and has not been promoted. Continuing the rollout during an urgent customer-facing semantic fix would mix unrelated changes.
- What must not happen next: do not promote Phase 1, do not increase canary traffic, and do not overwrite the active public canary with an urgent image without first recording rollback and customer impact.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: base urgent Phase 2 on stable image A, `registry.example.com/gateway:phase0-a17f3d2`.
- Dependency evidence: the urgent fix is a dashboard wording / aggregate semantic fix. The current evidence does not prove it depends on unpromoted Phase 1 behavior.
- Rollback target: stable image A remains the rollback target at every step until a Phase 2 image passes smoke checks and is promoted.

## 4. High-availability sequence

```text
1. Record current rollout state: stable image, canary image, stable/canary weights, public canary status, and rollback target.
2. Freeze Phase 1 and shift public traffic back to stable 100 / canary 0, keeping stable image A as rollback target.
3. Build urgent Phase 2 from stable image A with only the dashboard semantic fix.
4. Deploy Phase 2 to canary capacity at 0% public traffic and run private smoke checks.
5. Shift Phase 2 canary to 1% public traffic only after health and billing semantic checks pass.
6. Observe errors, dashboard payload, ledger invariants, and support-visible behavior.
7. Promote gradually only if stable; otherwise shift canary back to 0% and keep stable image A serving customers.
```

## 5. Customer-invisibility proof

- API availability check: health endpoint and key dashboard read endpoint return successful responses before and after each traffic shift.
- Dashboard/customer-facing check: Acme payload displays list-price usage and prepaid wallet debit as distinct values; no ambiguous `Total usage cost` field points at `$100.00` as if it were wallet debit.
- Billing semantic check: official usage remains `$100.00`; payable prepaid debit remains `$40.00`; prepaid multiplier remains `0.4`.
- Ledger idempotency check: no historical ledger rewrite and no duplicate debit on retry/replay.
- Provider/internal metadata leakage check: customer payload does not expose provider settlement cost, provider account balance, upstream credential, load-balancing weight, or canary metadata.

## 6. Final state

- Stable image: `registry.example.com/gateway:phase0-a17f3d2` remains rollback target.
- Canary image: Phase 1 image `registry.example.com/gateway:phase1-b93c1a8` should be removed from public traffic before urgent Phase 2; Phase 2 tag is not present in this repo and should not be invented.
- ALB weights: safest first target is stable 100 / canary 0, then Phase 2 canary 1% only after private smoke checks.
- Remaining Phase 1 disposition: paused/unwound; re-evaluate separately after urgent Phase 2 is resolved.
- Remaining risks: actual infrastructure commands and live smoke outputs are not available in this repository, so this plan records the safe release sequence rather than claiming execution.
