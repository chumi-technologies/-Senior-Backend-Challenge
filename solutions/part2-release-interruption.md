# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | `registry.example.com/gateway:phase0-a17f3d2` | `ops/current-rollout-state.json` |
| canary image | `registry.example.com/gateway:phase1-b93c1a8` | `ops/current-rollout-state.json` |
| stable traffic weight | `99` | `ops/current-rollout-state.json` |
| canary traffic weight | `1` | `ops/current-rollout-state.json` |
| canary has public traffic? | `true` | `ops/current-rollout-state.json` |
| Phase 1 promoted? | `No`; state says `public canary observation, not promoted` | `ops/current-rollout-state.json` |

## 2. Phase 1 freeze decision

- Decision: Freeze Phase 1 immediately and remove its public traffic before shipping the urgent customer-facing fix.
- Reason: Phase 1 is already on a public canary and is not promoted. The urgent fix is semantically sensitive and customer-facing. Continuing or mutating Phase 1 in place would combine two concerns at once: the unfinished Phase 1 experiment and the urgent prepaid-cost wording correction. That makes rollback ambiguous and risks exposing more customers to mixed semantics.
- What must not happen next: Do not patch the existing public canary image B in place, do not continue Phase 1 promotion while the urgent billing-display issue is unresolved, and do not change ledger semantics merely to make labels line up.

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision: Base the urgent patch on stable image A (`phase0-a17f3d2`), producing a new Phase 2 image C that contains only the urgent customer-facing fix.
- Dependency evidence: The observed rollout file says Phase 1 touched "team prepaid usage reporting labels and dashboard aggregation," but no evidence in the repository proves that the urgent fix depends on all Phase 1 changes already inside canary image B. Because B is unfinished and already has public traffic, reusing it would couple the urgent patch to unrelated unpromoted behavior.
- Rollback target: Stable image A remains the rollback anchor at every step until image C is proven safe. If C fails smoke checks, route traffic back to A and keep Phase 1 frozen out of public traffic.

## 4. High-availability sequence

```text
1. Observe and record current rollout state from ops/current-rollout-state.json:
   stable A at 99%, canary B at 1%, canary has public traffic, Phase 1 not promoted.
2. Freeze Phase 1 and unwind its public exposure:
   shift ALB weights from 99/1 to 100/0 so image B stops serving customers.
3. Keep stable A serving all production traffic while preparing a new urgent patch image C
   based on stable A only.
4. Deploy image C to the canary slot with zero public traffic first if the platform allows;
   otherwise deploy C only after B has already been removed from public traffic.
5. Run smoke checks focused on:
   API availability, prepaid dashboard wording, official usage vs payable debit semantics,
   and rollback readiness.
6. Reintroduce public canary gradually for C:
   99/1 with stable A still as primary.
7. If smoke checks pass, either hold at 1% for observation or promote C using the normal
   stable/canary release process.
8. If any check fails, return traffic to stable A immediately and keep both B and C out of
   public traffic until the issue is resolved.
```

## 5. Customer-invisibility proof

- API availability check: Stable A continues serving traffic while B is unwound and before C is exposed. The customer-visible API should remain reachable throughout because there is no step that removes stable capacity first.
- Dashboard/customer-facing check: For a prepaid account with multiplier `0.4`, verify the UI no longer presents official list-price usage under wording customers interpret as wallet debit. Acceptable outcomes are either (a) separate labels for official usage and wallet debit or (b) a single label whose value and semantics clearly match.
- Billing semantic check: Re-run the same example and confirm that official list-price usage remains `$100.00` while payable prepaid debit remains `$40.00`. The urgent patch must change wording or aggregate selection, not mutate ledger semantics.
- Ledger idempotency check: Confirm no duplicate debit is introduced by page refresh, retry, or replay of the same usage event. This remains a must-check before or during rollout if any billing-adjacent code changes are made.
- Provider/internal metadata leakage check: Confirm the customer-facing screen does not expose provider settlement values, rollout terminology such as canary/stable, or internal image identifiers.

## 6. Final state

- Stable image: `registry.example.com/gateway:phase0-a17f3d2` remains the active rollback target until image C is proven.
- Canary image: New urgent patch image C derived from stable A; Phase 1 image B remains frozen and excluded from public traffic.
- ALB weights: During freeze `100/0` for A/B, then `99/1` for A/C when reintroducing the urgent patch canary.
- Remaining Phase 1 disposition: Keep Phase 1 separate from the urgent patch. Re-evaluate it only after the customer-facing billing-display issue is resolved and the urgent patch is stable.
- Remaining risks: The repository does not expose live deployment commands or billing implementation details, so final rollout still requires real-environment smoke checks for no-double-debit behavior and UI wording correctness.
