# Decision Log

> Required. Record semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

This log is the **single semantic source of truth** for the whole submission. Every other
document (`spec.md`, `part1-billing-semantics.md`, `part2-release-interruption.md`,
`release-command-log.md`) must use these definitions and must not silently redefine a term.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | Three distinct concepts collapsed onto one word: (1) **customer wallet balance** = prepaid money the team still has; (2) **provider account balance** = funds/credit on the upstream AI provider account; (3) **load balance** = traffic/credential distribution weight. | (1) customer wallet ledger; (2) provider account statement; (3) ALB target-group weight / `MockAuthPool` round-robin index | A wallet debit must never read or write a provider balance or a load-balancing weight, and vice-versa. |
| account | (1) **customer account** = the paying team/tenant; (2) **provider account** = our account with the upstream AI vendor; (3) **upstream credential** = a single auth slot used to call the provider. | (1) customer/tenant record; (2) provider billing account; (3) `MockAuthPool` `AuthConfig` slot | A customer account is the payer; a provider account is a payee; a credential is just an API key/login, not money. |
| usage | A three-layer pipeline, not one number: (1) **raw usage event** = metered units of real consumption; (2) **ledger entry** = the money movement derived from usage; (3) **dashboard aggregate** = a rolled-up display number. | (1) raw usage event store; (2) wallet ledger; (3) read-model / dashboard projection | The dashboard aggregate is a *view*; it is never the source of truth and must never be written back into raw usage or the ledger. |
| total cost | **Official list-price cost** of the consumed usage, before any prepaid discount. In the incident this is `$100.00`. | official usage report (raw usage × list price) | the customer-payable amount; the amount actually debited from the wallet. |
| actual cost | **Customer-payable debit** = money actually deducted from the prepaid wallet, after the prepaid multiplier. In the incident this is `$40.00` = `$100.00 × 0.4`. | wallet ledger entry | the official list price; the provider settlement amount. |
| official cost | Synonym for **total cost / official list price** (`$100.00`), kept separate from `actual cost` on purpose. | official usage report | payable debit / provider settlement. |
| provider settlement | What **we** owe the upstream AI provider. Internal, never shown to the customer. | provider invoice / provider account | customer payable debit (`actual cost`). |
| credit / prepaid | **Customer prepaid package** = money paid in advance, drawn down by debits. The **team prepaid multiplier `0.4`** is a customer discount applied only when computing the payable debit. | wallet ledger (prepaid balance + multiplier on the package record) | a provider-side discount; a free credit grant. |
| ledger | The **append-only record of money movements** against the customer wallet; source of truth for "how much was charged / how much remains". | wallet ledger store | the dashboard aggregate (a view) or the raw usage events (consumption, not money). |
| load (load balancing) | Distribution of **traffic or credentials**, expressed as a **weight/index**; carries no monetary meaning. | ALB stable/canary target-group weights; `MockAuthPool` round-robin | any `balance` that means money. |
| stable | (1) **stable ALB target group** = production fleet serving most traffic (image `phase0-a17f3d2`, weight 99); (2) **stable API contract**; (3) a Git branch literally named `stable`. | (1) `ops/current-rollout-state.json` → `stableImage`/`stableTrafficWeight`; (2) shared-types contract; (3) git | The deploy target "stable" is not the Git branch and not the contract. |
| canary | (1) **public canary** = canary target group already receiving real customer traffic (image `phase1-b93c1a8`, weight 1); (2) **private/shadow canary** = mirrored/zero public traffic. Here the canary is **public** (`canaryHasPublicTraffic: true`). | `ops/current-rollout-state.json` → `canaryImage`/`canaryTrafficWeight`/`canaryHasPublicTraffic` | A public canary is customer-facing; treating it as a private shadow would be unsafe. |
| route / fallback | **route** = which fleet/credential a request is sent to; **fallback** = the safe target to revert to. | ALB routing config / rollback target | not a billing concept. |

## Key semantic rulings (referenced by every part)

1. **`$100` and `$40` are both correct and both required.** `$100` is the *official list-price usage* (`total cost`); `$40` is the *customer-payable debit* (`actual cost = $100 × 0.4`). Different concepts, not a discrepancy.
2. **The prepaid multiplier `0.4` affects only the payable debit.** It must not scale raw usage events, must not change the official usage report, and must not be baked into a stored "total cost".
3. **The dashboard is a view, never a source of truth.** Fixing the customer-facing problem means changing a *label/aggregate*, not money.
4. **Customer wallet, provider account, and load-balancing weight are three separate `balance`s.** No change in this submission touches provider balances or load-balancing / credential-rotation weights.
5. **Ledger history is not rewritten.** Historical debits are already correct; rewriting them would create a second source of truth and destroy auditability. See [part1-billing-semantics.md](part1-billing-semantics.md).

## Decision entries

### 2026-06-13 — Classify the billing incident before touching money

- Context: Ticket reports dashboard `Total usage cost: $100` vs wallet debit `$40`, multiplier `0.4`. Sales fears undercharge, Finance fears wrong report, Eng fears double billing.
- Decision: Classify as a **dashboard label / aggregate-naming defect**, not a wrong debit, not double billing. `$40 = $100 × 0.4` is the correct payable debit.
- Source of truth: customer wallet ledger for the debit; official usage report for the `$100`.
- Alternatives rejected: (a) "increase the debit to $100 to match the label" — would overcharge and corrupt the ledger; (b) "rewrite the label's number to $40" — hides the real official usage and breaks Finance's report.
- Risk: changing financial behavior to make a label consistent. Mitigated by display-only fix.
- Verification: tests/assertions that wallet debit and official usage are unchanged; only the display string changes. See [part1-billing-semantics.md](part1-billing-semantics.md).

### 2026-06-13 — Release base for the urgent customer-facing fix

- Context: Phase 1 is in **public** canary (weight 1) and not promoted. Urgent label fix has a 60-minute deadline.
- Decision: Base the urgent patch on **stable image A (`phase0-a17f3d2`)**, ship as a *new* canary; keep Phase 1 and Phase 2 separate; do not promote or in-place mutate the public Phase 1 canary.
- Source of truth: `ops/current-rollout-state.json`.
- Alternatives rejected: basing on canary image B (`phase1-b93c1a8`) — stacks the urgent fix on unverified Phase 1 changes and yields an unclean rollback target.
- Risk: customer-visible regression on a public canary. Mitigated by rollback target = stable A at weight 100 at every step.
- Verification: smoke checks prove ledger semantics unchanged. See [release-command-log.md](release-command-log.md) and [part2-release-interruption.md](part2-release-interruption.md).

### 2026-06-13 — Scope of the code change (analysis-overwrite bug)

- Context: `analysis.service.ts` schedules a `setTimeout` `delayedUpdate` that overwrites the worker's real demographics with stale random pre-compute data (ticket #4521 "data overwrite").
- Decision: **Surgical removal** of the delayed overwrite; lock old behavior with a characterization test first. Optimistic-locking via the existing `version?` field is *considered but deferred* to keep the change minimal.
- Source of truth: `analysis_jobs` document; the worker's COMPLETED result is authoritative over the pre-compute.
- Alternatives rejected: rewriting the service / introducing a state machine — out of scope per challenge rules.
- Risk: removing logic that some caller relies on. Mitigated by characterization test before/after. See [refactor-plan.md](refactor-plan.md).
- Verification: `bug-repro.spec.ts` red before, green after.

## Human corrections / decisions

- 2026-06-13 — Human directed "fix with the most correct answers" and approved the rulings above, explicitly endorsing the **surgical, display-only** treatment of the billing incident (no money/ledger change) and the **minimal code fix** for the unrelated analysis-overwrite bug. Recorded in [ai-collaboration-log.md](ai-collaboration-log.md).
