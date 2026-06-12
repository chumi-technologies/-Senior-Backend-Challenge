# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | registry.example.com/gateway:phase0-a17f3d2 | ops/current-rollout-state.json `stableImage` |
| canary image | registry.example.com/gateway:phase1-b93c1a8 | ops/current-rollout-state.json `canaryImage` |
| stable traffic weight | 99 (2 replicas) | ops/current-rollout-state.json `stableTrafficWeight` / `stableDesiredCount` |
| canary traffic weight | 1 (1 replica) | ops/current-rollout-state.json `canaryTrafficWeight` / `canaryDesiredCount` |
| canary has public traffic? | yes (true) | ops/current-rollout-state.json `canaryHasPublicTraffic` |
| Phase 1 promoted? | no — public canary observation, not promoted | ops/current-rollout-state.json `phase1Status` |

## 2. Phase 1 freeze decision

- Decision: freeze Phase 1 and drain its public traffic (shift canary weight 1 → 0) before shipping anything. Phase 1 is parked, not promoted, not deleted.
- Reason: the canary carries live public traffic; you cannot safely mutate or promote it under a 60-minute deadline without risking customer-visible impact. The urgent label fix is unrelated to Phase 1's "dashboard aggregation" change.
- What must not happen next: do not patch the public canary image in place; do not promote Phase 1 to stable as a shortcut to ship the label fix; do not lose the ability to roll back in one action.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: base Phase 2 on **stable image A** (`phase0-a17f3d2`).
- Dependency evidence: the urgent change is a customer-facing dashboard label fix, independent of Phase 1's unpromoted "usage reporting labels and dashboard aggregation" change. Building on canary image B would inherit B's unobserved, not-yet-promoted changes and couple two releases under deadline pressure.
- Rollback target: stable image A itself — it is already serving 99% of traffic, so reverting weight to 100% stable is a single action with zero new image to roll back to.

## 4. High-availability sequence

```text
1. Freeze Phase 1: stop promotion; shift ALB canary weight 1 -> 0 and drain; keep stable image A at 100% serving public traffic (no customer impact).
2. Build Phase 2 from stable image A with the presentation-only label fix; deploy to a new canary target group with weight 0 (private smoke / internal host only, no public traffic).
3. Smoke-test Phase 2 at weight 0; if green, ramp public weight 0 -> 5%, observe billing-semantics smoke checks, then promote to stable (100%). Image A stays warm as the one-action rollback at every step.
```

## 5. Customer-invisibility proof

- API availability check: stable image A serves 100% during freeze and during the 0→5% ramp; the gateway returns 200 throughout; no maintenance window.
- Dashboard/customer-facing check: after promote, `Total usage cost` reads the official figure clearly distinguished from the $40.00 payable debit read from the ledger.
- Billing semantic check: `officialCost` = $100.00 and `payableAmount` = $40.00 unchanged before and after; no ledger writes from the relabel.
- Ledger idempotency check: a single $40.00 debit per usage record; retried delayed-updates are no-ops (status-guarded), so no double debit during the transition.
- Provider/internal metadata leakage check: confirm no provider account / upstream credential identifiers are rendered into the customer dashboard by the relabel.

## 6. Final state

- Stable image: registry.example.com/gateway:phase2-<built-from-A> (promoted), rollback target registry.example.com/gateway:phase0-a17f3d2.
- Canary image: drained to weight 0; Phase 1 image phase1-b93c1a8 parked, not promoted.
- ALB weights: stable 100 / canary 0 after promote (during ramp: stable 95 / canary 5).
- Remaining Phase 1 disposition: re-introduce the dashboard-aggregation change as a fresh canary after the urgent fix lands; it was never promoted and carries no customer commitment.
- Remaining risks: Phase 1 and Phase 2 both touch dashboard display; sequence them so Phase 1 re-canary is rebased on the promoted Phase 2 stable to avoid relabel conflicts.
