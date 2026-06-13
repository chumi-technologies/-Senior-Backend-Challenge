# Spec — High Availability Urgent Change

> Complete this before modifying code.

## 1. Current-state understanding

- Customer-facing symptom: Acme Team sees `Total usage cost: $100.00` on the dashboard while the prepaid wallet debit is `$40.00` and the team prepaid multiplier is `0.4`. The incident is not simply "numbers do not match"; it is that two different billing concepts appear under customer-visible wording that implies they should match.
- Affected customer / surface: Customer-facing dashboard usage/cost presentation for prepaid teams, plus any support or finance workflow that reads the same aggregate. The ticket does not show evidence of an API outage or provider-side settlement issue.
- Current release state: Phase 1 is already in public canary at 1% (`phase1-b93c1a8`) while stable remains `phase0-a17f3d2` at 99%. Canary has public traffic, Phase 1 is not promoted, and the current rollout state explicitly says Phase 1 touched "team prepaid usage reporting labels and dashboard aggregation."
- Known constraints: No customer-visible downtime, no mutation of ledger semantics to make labels match, no second billing source of truth, preserve a clean rollback target, and prefer a small corrective change over a rewrite. Current repo code contains analysis-service legacy code and challenge scaffolding, but no explicit ledger or wallet module that should be treated as canonical without further evidence.

## 2. Source-of-truth map

```text
Request / usage event
  -> raw gateway usage event recorded at official list-price semantics
  -> official usage reporting aggregate shown to customer/support/finance
  -> prepaid billing calculation applies team multiplier for wallet debit
  -> wallet ledger entry updates customer prepaid balance

Release controller / rollout state
  -> stable image and stable traffic weight
  -> canary image and canary traffic weight
  -> rollback target if urgent patch is separated from Phase 1
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | Ledger-backed customer prepaid wallet state, inferred from the ticket language "wallet was debited" | Wallet balance display and support reconciliation | Debit pipeline that writes customer ledger entries after applying prepaid terms | provider balance / load-balancing weight |
| official usage cost | Raw usage events aggregated at list-price semantics; the ticket calls this "Official list-price usage: $100.00" | Usage reports, finance review, dashboard aggregate if labeled as official/list price | Usage aggregation pipeline, not wallet-debit code | payable debit |
| payable prepaid debit | Customer ledger debit derived from the same usage event after applying the prepaid multiplier | Wallet history, balance reconciliation, customer debit evidence | Ledger write path for prepaid deductions | official list price |
| release stable | Stable image plus stable ALB target group weight from `ops/current-rollout-state.json` | Rollout snapshot, release-command log, production traffic observation | Release automation / ops controls | Git branch named stable |
| canary | Public canary image and its live traffic allocation from `ops/current-rollout-state.json` | Rollout snapshot and public-traffic observation | Release automation / ops controls | private shadow canary vs public canary |

## 3. Root-cause hypotheses before code

1. Highest-probability hypothesis: the dashboard label `Total usage cost` is showing official list-price usage while customers interpret it as the amount deducted from the prepaid wallet. That is a semantic/label mismatch, not necessarily a bad debit.
2. Medium-probability hypothesis: Phase 1 canary changed dashboard aggregation or labeling for prepaid teams, so the customer-visible surface now mixes official usage aggregate with payable debit wording.
3. Lower-probability hypothesis: there is a duplicate or divergent billing path, but the observed `$100 -> $40` ratio exactly matches the `0.4` multiplier, which argues against a random double-debit bug and in favor of preserved debit semantics with confusing presentation.

## 4. Non-goals

- Rewriting billing, release, or dashboard architecture.
- Rewriting historical ledger entries to force past reports to match current wording.
- Changing provider balances, routing weights, or unrelated legacy analysis-service behavior without direct evidence that they are involved.

## 5. Blast radius

- Affected endpoints: Customer-facing usage/cost dashboard reads and any backing endpoint that returns aggregated usage labels for prepaid accounts.
- Affected customer-facing display: The label/value pairing around "Total usage cost" for prepaid customers; potentially support screenshots, QBR exports, and finance-facing summaries if they reuse the same aggregate label.
- Affected billing / ledger behavior: Ledger semantics must remain unchanged unless code evidence proves an actual bad debit. The current incident description suggests preserving debit behavior and fixing wording/aggregation interpretation first.
- Affected provider / routing behavior: Must remain untouched. `balance` in this challenge also refers to provider account balance and load-balancing weight, and neither should change as part of this incident.
- Affected release state: High risk because Phase 1 is already serving public canary traffic. Any urgent fix must account for live canary traffic and maintain a rollback target to stable image A.
- Metadata leakage risk: Customer-facing copy must not expose internal distinctions such as provider settlement, canary image identity, or private rollout terminology.

## 6. Validation plan

- Characterization tests: Lock current semantics around multiplier application so that the same raw usage event can yield `$100` official usage and `$40` payable debit without implying double billing. Add focused tests before changing any messy hot path.
- Contract tests: Verify customer wallet balance reads from ledger-backed debit semantics, official usage reports remain list-price based, and provider-balance/load-balancing concepts are unaffected by the chosen fix.
- Smoke checks: Compare stable vs canary customer-facing dashboard wording for a prepaid account, verify API availability during release steps, and confirm no duplicate debit occurs on retry.
- Release checks: Record stable image, canary image, traffic weights, public traffic status, rollback target, and whether Phase 1 is frozen before Phase 2 ships. Do not update an in-use public canary without explicitly justifying the safety trade-off.
- Evidence to paste into final report: `ops/current-rollout-state.json`, the urgent ticket wording, test output for multiplier semantics, and any command output that proves images/weights/rollback targets during release analysis.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| Treat the incident as a semantic mismatch first and avoid changing ledger debits before defining source-of-truth. | Accepted | The prompt explicitly warns not to change financial behavior until terms are defined, and the observed numbers match the prepaid multiplier. |
| Update the public canary in place because only 1% of traffic is affected. | Rejected | Canary already has real public traffic, so in-place mutation reduces rollback clarity and risks mixing Phase 1 and urgent Phase 2. |
| Assume the analysis-service legacy code is the billing source of truth. | Rejected | The inspected code only covers analysis jobs and queueing; it does not implement wallet, ledger, or release semantics for this incident. |
