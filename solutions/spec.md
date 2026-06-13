# Spec — High Availability Urgent Change

> Completed before modifying code (inside the 35-minute no-code window).

## 1. Current-state understanding

- Customer-facing symptom: Acme Team's dashboard shows `Total usage cost: $100.00`, but their team prepaid wallet was debited `$40.00`. The customer reads the `$100` label as "money taken from my wallet" and believes billing is inconsistent. QBR in 60 minutes.
- Affected customer / surface: Acme Team (team prepaid package, multiplier `0.4`). The affected surface is the usage dashboard label and the aggregation that feeds it. The request path and the ledger debit path are not themselves symptomatic.
- Current release state: stable `phase0-a17f3d2` @ 99% and canary `phase1-b93c1a8` @ 1% with real public traffic; Phase 1 ("team prepaid usage reporting labels and dashboard aggregation") is still observing and not promoted; maintenance jobs disabled on canary.
- Known constraints: no customer-visible API downtime; do not mutate ledger semantics to make labels match; do not create a second billing source of truth; 60-minute deadline; keep a clear rollback target.

## 2. Source-of-truth map

```text
Request / usage event (raw gateway usage, official list price = $100)
  -> usage ledger entry (payable debit = official x prepaid multiplier = $100 x 0.4 = $40)   [SOURCE OF TRUTH: customer balance]
  -> wallet balance decremented by $40                                                        [derived from ledger]
  -> dashboard aggregate (a VIEW; currently mislabels the $100 figure as "Total usage cost")  [NOT a source of truth]
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | wallet ledger (sum of debits) | wallet/ledger read API | ledger append per debit | provider balance / load-balancing weight |
| official usage cost | raw usage event at list price | usage/reporting store | metering per request | payable debit |
| payable prepaid debit | ledger entry (official x multiplier) | ledger read | ledger append (idempotent per usage event) | official list price |
| release stable | ALB stable target group running stable image | rollout state / ALB | weighted deploy + promote | a Git branch named "stable" |
| canary | ALB canary target group with public weight | rollout state / ALB | weighted deploy | private shadow canary vs public canary |

## 3. Root-cause hypotheses before code

1. Presentation/label defect: the dashboard renders official list-price usage (`$100`) under a label customers read as the wallet debit; the `$40` ledger debit is actually correct. (Most likely.)
2. Aggregation defect: the dashboard surfaces official usage but omits the prepaid-adjusted payable figure, so the two numbers look contradictory.
3. Genuine second write path (lower probability, must be ruled out not assumed): the analysis hot path has a delayed write that overwrites a completed record — the operational analog of "two billing paths."

## 4. Non-goals

- Rewriting ledger history or changing any past debit amount.
- Changing the prepaid multiplier, official metering, or provider settlement.
- Broad architecture cleanup of the legacy app or worker service.

## 5. Blast radius

- Affected endpoints: the dashboard/usage read endpoint only (presentation); no write endpoints in scope.
- Affected customer-facing display: the "Total usage cost" label and the adjacent payable number.
- Affected billing / ledger behavior: none intended; the ledger debit stays `$40` and must be proven unchanged.
- Affected provider / routing behavior: none; provider balance and load-balancing weight (the other meanings of "balance") must be proven untouched.
- Affected release state: a minimal label fix shipped via a fresh canary built on stable A; Phase 1 frozen.
- Metadata leakage risk: ensure provider account / upstream credential identifiers are not surfaced in the corrected dashboard copy.

## 6. Validation plan

- Characterization tests: lock the current analysis hot-path behavior (the delayed stale overwrite) before fixing it, in `apps/legacy-app/test/bug-repro.spec.ts`.
- Contract tests: official usage `$100` and payable debit `$40` remain distinct values after the label fix.
- Smoke checks: the dashboard renders both "official usage cost" and "prepaid wallet debit"; the ledger debit for a sample usage event is still `$40`.
- Release checks: ALB weights, the canary public-traffic flag, and rollback target = stable `phase0-a17f3d2` recorded at every step.
- Evidence to paste into the final report: `pnpm run verify:submission` output, the characterization test output, and the ledger-unchanged assertion.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| "The debit is wrong; update the $40 debit to $100 so it matches the dashboard." | Rejected | Over-charges the customer and corrupts the ledger source of truth; `$40 = $100 x 0.4` is correct. |
| "Change official usage to $40 so the numbers agree." | Rejected | Corrupts official usage reporting (Finance's source of truth); only the label is wrong. |
| "Rewrite historical ledger entries to be consistent." | Rejected | Past debits were correct; rewriting history is destructive and unnecessary. |
| "Hotfix by editing the live canary image in place." | Modified | Build the label fix on stable A and ship a fresh canary; in-place canary mutation destroys the rollback baseline. |
| "Relabel the dashboard to show both official usage and the wallet debit." | Accepted | Smallest safe presentation-layer change; preserves all three sources of truth. |
