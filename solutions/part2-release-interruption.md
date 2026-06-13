# Part 2 — Interrupted Rollout Plan

> Terms per [decision-log.md](decision-log.md). Command-level detail and timeline in [release-command-log.md](release-command-log.md).

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` `stableImage` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` `canaryImage` |
| stable traffic weight | 99 | `ops/current-rollout-state.json` `stableTrafficWeight` |
| canary traffic weight | 1 | `ops/current-rollout-state.json` `canaryTrafficWeight` |
| canary has public traffic? | yes — real customers | `ops/current-rollout-state.json` `canaryHasPublicTraffic: true` |
| Phase 1 promoted? | no — "public canary observation, not promoted" | `ops/current-rollout-state.json` `phase1Status` |

## 2. Phase 1 freeze decision

- Decision: **Freeze Phase 1.** Stop the observation/promotion clock, drain its public traffic (canary weight → 0, stable → 100), and do **not** promote and do **not** mutate the Phase 1 canary in place.
- Reason: the Phase 1 canary carries real customer traffic and contains unverified changes to "team prepaid usage reporting labels and dashboard aggregation" — the very area the urgent ticket touches. Promoting it ships unverified work to 100%; mutating it in place destroys its meaning as a clean experiment and its rollback target.
- What must not happen next: no `promote` of `phase1-b93c1a8`; no rebuild on top of it; no leaving 1% of customers on a canary that is being changed underneath them.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: **Base it on stable image A (`phase0-a17f3d2`)** → produce a new image C containing only the display-only label fix.
- Dependency evidence: image B (`phase1-b93c1a8`) bundles unverified Phase 1 reporting/aggregation changes. Building C on B would couple the 60-minute urgent fix to those unverified changes, enlarge the blast radius, and make rollback ambiguous (rolling back C would also move Phase 1 state). Building on A keeps C minimal and independently revertible. Phase 1 and Phase 2 therefore stay **separate**.
- Rollback target: stable image A `phase0-a17f3d2` at weight 100 — already serving 99% of traffic, so reverting C to 0% is instant and customer-invisible.

## 4. High-availability sequence

```text
Step 1. Snapshot rollout state; FREEZE Phase 1 (no promote).
Step 2. Drain Phase 1 canary: ALB weights stable=100 / canary=0  (1% returns to trusted stable A).
Step 3. Build image C from stable A + display-only label fix (official $100 / charged $40 split).
Step 4. Deploy C as canary target group, desired=1, weight=0; smoke-check at 0% traffic.
Step 5. Shift 1% to C (stable=99 / C=1); observe error rate, latency, label correctness.
Step 6. Ramp C 1 -> 10 -> 50 -> 100 with smoke checks between each step.
Rollback (any step): ALB weights stable=100 / C=0; stable A image never mutated.
```

## 5. Customer-invisibility proof

- API availability check: 2xx/5xx ratio and p95 latency on C within noise of stable A; no connection resets during weight shifts (ALB weighted target groups shift gracefully).
- Dashboard/customer-facing check: dashboard renders `Official usage (list price): $100.00` and `Charged to prepaid wallet: $40.00` — two clear labels, no ambiguous single "Total usage cost".
- Billing semantic check: wallet debit remains `$40.00` (= `$100 × 0.4`); official usage remains `$100.00`; the change is display-only.
- Ledger idempotency check: the fix adds no debit/write; replaying a render is read-only, so retries cannot double-charge; `sum(debits)` unchanged.
- Provider/internal metadata leakage check: no provider account, settlement figures, or auth-slot usernames (`slaveN@test.com`) appear in customer-facing output.

## 6. Final state

- Stable image: `phase0-a17f3d2` (unchanged; remains the rollback target throughout).
- Canary image: `phase2-cXXXX` (= stable A + display-only label fix), ramped only if smoke checks pass.
- ALB weights: stable A held at 100 until C proves healthy, then C ramped 1→100 (or C promoted to the stable target group).
- Remaining Phase 1 disposition: drained and held; re-validated and re-released **separately** later — never silently folded into C.
- Remaining risks: Phase 1's reporting/aggregation changes are still unverified; the urgent label wording must be reconciled with Phase 1's intent before Phase 1 resumes, to avoid a second relabel.
