# Spec — High Availability Urgent Change

> Complete this before modifying code. Terms used here are defined in [decision-log.md](decision-log.md).

## 1. Current-state understanding

- Customer-facing symptom: Acme Team's dashboard shows `Total usage cost: $100.00` next to a number customers read as "amount taken from our prepaid wallet", while the wallet was debited `$40.00` (= `$100.00 ×` prepaid multiplier `0.4`). QBR in 60 minutes; Sales fears we look inconsistent, Finance fears undercharging, Eng suspects a duplicate billing path.
- Affected customer / surface: Acme Team; the **dashboard usage-cost display only**. No evidence any money moved incorrectly.
- Current release state: Phase 1 (`phase1-b93c1a8`, "team prepaid usage reporting labels and dashboard aggregation") is in **public canary at 1%**, stable is `phase0-a17f3d2` at 99%, Phase 1 **not promoted**. Source: `ops/current-rollout-state.json`.
- Known constraints: no customer-visible API downtime; do not mutate ledger semantics to make labels match; do not create a second billing source of truth; preserve a clear rollback target; 60-minute deadline.

## 2. Source-of-truth map

```text
Request / usage event
  -> raw usage event store        (source of truth for OFFICIAL usage = $100 list price)
  -> ledger entry (wallet debit)  (source of truth for CUSTOMER balance; debit = list price × prepaid multiplier = $40)
  -> dashboard aggregate (VIEW)   (must read from the two sources above; never written back)

provider account balance / settlement   (separate; internal; not customer-facing)
ALB stable/canary weights + auth-pool rotation = "load balance" (traffic, not money)
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | wallet ledger | dashboard reads aggregated ledger | only debit/credit ledger writes | provider balance / load-balancing weight |
| official usage cost | raw usage events × list price | official usage report → dashboard | metering pipeline only | payable debit (`$40`) |
| payable prepaid debit | wallet ledger entry (`list price × 0.4`) | dashboard "charged" line | debit write at billing time | official list price (`$100`) |
| release stable | `ops/current-rollout-state.json` `stableImage` | rollout state file / ALB | deploy + ALB weight change | a Git branch named `stable` |
| canary | `ops/current-rollout-state.json` `canaryImage` (public, weight 1) | rollout state file / ALB | deploy + ALB weight change | private shadow canary vs public canary |

## 3. Root-cause hypotheses before code

1. **(Most likely) Display/label defect.** The dashboard aggregate labels the *official list price* (`$100`) with wording customers read as *amount charged*. The actual debit (`$40`) is correct. Fix is display-only.
2. **Aggregation picks the wrong layer.** The dashboard reads the official-usage layer where it should also surface the payable-debit layer (two numbers, two labels), confirming hypothesis 1 is a naming/aggregation issue, not a money issue.
3. **(Rejected after analysis) Duplicate billing path / wrong debit.** No billing code exists in this repo and `$40 = $100 × 0.4` is arithmetically the intended discounted debit, so there is no evidence of a double charge or under-charge.

## 4. Non-goals

- Changing any debit, credit, multiplier, or ledger entry to make the label "match".
- Rewriting historical ledger entries.
- Touching provider balances, provider settlement, or load-balancing / credential-rotation weights.
- Promoting Phase 1, or rewriting the analysis/worker pipeline beyond the one scoped overwrite bug.

## 5. Blast radius

- Affected endpoints: dashboard usage-cost read path only; no write endpoints in the billing fix.
- Affected customer-facing display: the `Total usage cost` line gains an unambiguous split (official vs charged).
- Affected billing / ledger behavior: **none** (explicit non-goal).
- Affected provider / routing behavior: **none**.
- Affected release state: a new canary built from stable A; Phase 1 canary weight reduced/retired; stable A remains rollback target.
- Metadata leakage risk: ensure no internal terms (provider account, auth slot usernames like `slaveN@test.com`, settlement) leak into the customer dashboard.

## 6. Validation plan

- Characterization tests: lock the current analysis-overwrite behavior (`apps/legacy-app/test/bug-repro.spec.ts`) before fixing it.
- Contract tests: assert dashboard fix changes only display strings — wallet debit (`$40`) and official usage (`$100`) values unchanged; provider balance and load-balancing weights untouched.
- Smoke checks: API 2xx/5xx and latency unchanged on the new canary; dashboard shows official `$100` and charged `$40` as separate labelled lines.
- Release checks: ALB weights observed before/after each step; rollback target confirmed = stable A at weight 100.
- Evidence to paste into final report: `pnpm run verify:submission` output; `jest` run of `bug-repro.spec.ts` (red→green); rollout decision table.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| Treat `$100` vs `$40` as a billing discrepancy and "correct" the debit to `$100` | Rejected | `$40` is the correct discounted debit; raising it would overcharge and corrupt the ledger. |
| Make labels match by overwriting the displayed `$100` with `$40` | Rejected | Hides the official usage Finance needs; the fix is to show *both*, labelled. |
| Base the urgent patch on the Phase 1 canary image B (already deployed) | Rejected | Stacks the fix on unverified Phase 1 changes; rollback target becomes unclean. Build from stable A. |
| Rewrite historical ledger entries for consistency | Rejected | Creates a second source of truth and destroys auditability; history is already correct. |
| For the analysis bug, rewrite the service into a clean state machine | Rejected | Out of scope; surgical removal of the `setTimeout` overwrite is the smallest safe change. |
| Display-only relabel + surgical removal of the overwrite + characterization test | Accepted | Smallest changes that fix the customer-facing issue and the real code bug without touching money or HA. |
