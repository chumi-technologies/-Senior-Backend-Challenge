# Spec — High Availability Urgent Change

> Completed before modifying code. This spec pins the source-of-truth map and the release sequence. No code was changed in the commit that introduced this file.

## 1. Current-state understanding

- Customer-facing symptom: Acme Team dashboard shows `Total usage cost: $100.00`, but the team prepaid wallet was debited `$40.00`. The customer reads the two numbers as contradictory.
- Affected customer / surface: one tenant (Acme Team), customer-facing usage dashboard only. The wallet debit and the official usage record are internally consistent.
- Current release state: Phase 1 is in public canary (`registry.example.com/gateway:phase1-b93c1a8`) at 1% traffic, 1 replica, not promoted. Stable is `registry.example.com/gateway:phase0-a17f3d2` at 99% / 2 replicas. Phase 1's change summary is "team prepaid usage reporting labels and dashboard aggregation". A 60-minute urgent deadline applies.
- Known constraints: no customer-visible API downtime; do not mutate ledger semantics to make labels match; do not create a second billing source of truth; preserve a one-action rollback target at every release step.

## 2. Source-of-truth map

```text
Request / usage event
  -> usage/billing record (officialCost = list price, e.g. $100.00)   [source of truth for official usage]
  -> prepaid wallet ledger debit (payableAmount = officialCost * multiplier = $40.00)  [source of truth for what the customer pays / wallet balance]
  -> dashboard label (PRESENTATION ONLY: must READ payableAmount from the ledger, never recompute)
  -> provider account ledger (provider settlement)  [separate money path, untouched]
  -> ALB target-group trafficWeight (99/1)  [load-balancing "balance", not money]
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | prepaid wallet ledger debit (`payableAmount`) | dashboard reads ledger payable | billing pipeline writes one debit per usage record | provider balance / load-balancing weight |
| official usage cost | usage/billing record (`officialCost`, $100.00) | usage report reads `officialCost` | metering writes list price | payable debit ($40.00) |
| payable prepaid debit | prepaid wallet ledger entry (`payableAmount`, $40.00 = $100 × 0.4) | wallet reads ledger | billing applies multiplier exactly once | official list price |
| release stable | `ops/current-rollout-state.json` `stableImage` + `stableTrafficWeight` | ALB stable target group | promotion shifts weight to stable | Git branch named stable |
| canary | `ops/current-rollout-state.json` `canaryImage` + `canaryHasPublicTraffic` | ALB canary target group at 1% | weight shifting only | private shadow canary vs public canary (this one is PUBLIC) |

## 3. Root-cause hypotheses before code

1. Dashboard label defect (MOST LIKELY): the presentation layer renders `officialCost` ($100.00) under a label customers read as "amount deducted". The money paths are correct ($100 × 0.4 = $40 exact). Fix is presentation-only.
2. Double-billing path (REJECTED after analysis): would show wallet debited twice (e.g. $80), not a $40 debit matching the multiplier exactly. Not consistent with observed numbers.
3. Wrong ledger debit / undercharge (REJECTED): $40 is the correct payable for a 0.4 multiplier; Finance's "undercharging" worry confuses official list price with payable.

## 4. Non-goals

- Not mutating the ledger or rewriting historical ledger entries to make the label match.
- Not changing the prepaid multiplier, official usage metering, provider settlement, or ALB load-balancing weights.
- Not rewriting the gateway, the worker, or introducing a parallel billing/release framework.

## 5. Blast radius

- Affected endpoints: customer-facing dashboard usage read path only; no write endpoints touched.
- Affected customer-facing display: the `Total usage cost` label wording/value source (read payable from ledger).
- Affected billing / ledger behavior: none — ledger debit ($40.00) and official usage ($100.00) are preserved byte-for-byte.
- Affected provider / routing behavior: none — provider account ledger and request routing untouched.
- Affected release state: a new Phase 2 patch built on stable image A; Phase 1 canary frozen and drained, not promoted.
- Metadata leakage risk: ensure no provider account / upstream credential identifiers leak into the customer dashboard during the relabel.

## 6. Validation plan

- Characterization tests: lock the data-overwrite bug (#4521) red→green before/after the surgical fix (`apps/legacy-app/test/bug-repro.spec.ts`).
- Contract tests: assert official usage = $100.00 and payable debit = $40.00 remain unchanged; assert dashboard reads payable from ledger rather than recomputing.
- Smoke checks: API returns 200 throughout; dashboard label consistent with ledger; ledger debit unchanged on retry (idempotent).
- Release checks: stable image warm as rollback target at every step; canary public traffic drained before any patch; weight ramp 0 → 5% → promote.
- Evidence to paste into final report: `pnpm --filter legacy-app test` (4/4) and `pnpm run verify:submission` (17/17) output in `solutions/test-evidence.md`.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| Update the ledger debit to $100 so it matches the dashboard | Rejected | That corrupts the money source of truth; the $40 debit is correct for a 0.4 multiplier. The defect is in the label, not the ledger. |
| Patch the public canary image in place to ship the relabel fast | Rejected | The canary carries live public traffic; in-place mutation has no clean rollback. Freeze/drain Phase 1 and build on stable image A. |
| Recompute payable in the dashboard as `officialCost * multiplier` | Modified | Dashboard must READ `payableAmount` from the ledger (single source of truth), not recompute it, to avoid drift if multiplier logic changes. |
| Add a status-guarded atomic update for the delayed refresh | Accepted | Prevents the stale `delayedUpdate` from overwriting worker results; smallest safe fix for #4521. |
