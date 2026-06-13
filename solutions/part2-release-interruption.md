# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | registry.example.com/gateway:phase0-a17f3d2 | ops/current-rollout-state.json |
| canary image | registry.example.com/gateway:phase1-b93c1a8 | ops/current-rollout-state.json |
| stable traffic weight | 99 | ops/current-rollout-state.json |
| canary traffic weight | 1 | ops/current-rollout-state.json |
| canary has public traffic? | yes (`canaryHasPublicTraffic: true`) | ops/current-rollout-state.json |
| Phase 1 promoted? | no (public canary observation, not promoted) | ops/current-rollout-state.json |

## 2. Phase 1 freeze decision

- Decision: freeze Phase 1 in place — hold the canary at 1%, do not raise weight, do not promote, do not unwind it abruptly.
- Reason: Phase 1 is still in observation with real public traffic; promoting under deadline pressure is unsafe, and yanking it to 0 mid-observation throws away the baseline and risks a visible blip. Holding is the lowest-risk state.
- What must not happen next: no in-place mutation of the canary image; no promote; no weight increase until the urgent fix is decided and smoke-tested.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: base the urgent label fix on **stable image A** (`phase0-a17f3d2`).
- Dependency evidence: Phase 1's change summary is "team prepaid usage reporting labels and dashboard aggregation" — the SAME surface the urgent fix touches. Building on canary B would couple the urgent customer fix to unpromoted, still-observing code and give a moving rollback target. Building on A keeps a known-good rollback anchor and a label-only diff.
- Rollback target: stable `phase0-a17f3d2` at every step.

### Dependency necessity — does the urgent fix REQUIRE Phase 1's aggregation? (resolved: NO)

Binary question: can the label fix ("show Official usage $100 AND Prepaid wallet debit $40") be built on stable A, or does it depend on Phase 1's new dashboard-aggregation pipeline?

Decisive evidence, from the ticket itself: the wallet WAS debited $40 and usage WAS metered at $100. Both values already exist independently on stable A — ledger entry = $40, usage store = $100 — and predate Phase 1. Phase 1's "aggregation" is a broader reporting refactor; the urgent fix only needs to READ two pre-existing values and label them.

Conclusion: the urgent fix is INDEPENDENT of Phase 1 and is built on stable A with zero re-implementation of Phase 1 work. The only thing that could force a dependency is if the $40 figure were produced solely by Phase 1's pipeline — but the customer was actually debited $40, which proves the value lives in the ledger on stable A today. Dependency: none. Decision stands: build on A, keep Phase 1 frozen.

## 4. High-availability sequence

```text
1. Freeze Phase 1: hold canary b93c1a8 at 1%, no promote, no weight change.
2. Branch the label-only fix from stable A; build image C on top of phase0-a17f3d2 (ledger untouched).
3. Deploy image C as a fresh canary target group at 1%; rollback target = stable A.
4. Smoke C: API 200s, official usage still $100, ledger debit still $40, dashboard shows both numbers.
5. If green, raise C weight in steps (1 -> 5 -> 25 -> ...) watching error rate and ledger invariants.
6. If any check fails, set C weight to 0 (instant fallback to stable A); no customer-visible downtime.
7. After C is stable, reconcile Phase 1 (re-base b93c1a8 on the new stable or retire it) before promoting either.
```

## 5. Customer-invisibility proof

- API availability check: stable A continues serving 99%+; canary C added at 1%; weighted shift means no request is dropped.
- Dashboard/customer-facing check: dashboard now shows "Official usage cost $100" and "Prepaid wallet debit $40" — clearer, no broken state.
- Billing semantic check: ledger debit remains $40; multiplier 0.4 applied only to payable debit.
- Ledger idempotency check: debit keyed by usage event id; no new write path introduced by the label fix.
- Provider/internal metadata leakage check: corrected copy contains no provider account or upstream credential identifiers.

## 6. Final state

- Stable image: registry.example.com/gateway:phase0-a17f3d2 (anchor, unchanged)
- Canary image: label-fix image C built on phase0-a17f3d2
- ALB weights: 99 / 1 initially; raise C only after a green smoke pass
- Remaining Phase 1 disposition: frozen at 1%; re-base on new stable or retire before any promotion
- Remaining risks: low — the urgent fix is independent of Phase 1 (see §3 dependency necessity). Images b93c1a8 and C touch the same surface only at the label layer; reconcile Phase 1 on its own timeline, not on the urgent path.
