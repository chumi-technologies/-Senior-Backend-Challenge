# Decision Log

> Required. Record semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | Customer prepaid **wallet** balance = remaining prepaid funds for a tenant | prepaid wallet ledger (sum of debit/credit entries) | provider account balance / load-balancing weight / customer wallet |
| account | The **customer** tenant account (Acme Team) | tenant/customer record | customer account / provider account / upstream credential |
| usage | **Raw usage event** (units consumed by a request) | immutable usage-event store | raw usage event / ledger entry / dashboard aggregate |
| total cost | **Official list-price** usage = units x published list price (Finance/reporting view) | priced raw usage events | official list price / customer payable amount |
| actual cost | **Payable prepaid debit** = official cost x prepaid multiplier (0.4); what actually left the wallet | wallet ledger debit entry | deducted ledger amount / provider settlement amount |
| stable | The validated production target group/image (`gateway:phase0-a17f3d2`) serving 99% traffic | ALB stable target group / running image | Git branch / ALB stable target group / stable API contract |
| canary | The ALB canary target group running `gateway:phase1-b93c1a8` at **1% public** traffic | ALB weights describe-services | private shadow canary / public traffic canary |

## Decision entries

### 2026-06-20 14:10 — Define the three meanings of "cost" before touching the dashboard

- **Context:** The ticket conflates `Total usage cost` (dashboard, $100) with the wallet debit
  ($40). Engineering suspected a double-billing path.
- **Decision:** Treat the incident as a **presentation/labeling** problem. `Total usage cost`
  renders **official list-price usage** ($100). The amount that left the wallet is the **payable
  prepaid debit** ($40 = $100 x 0.4). Both are correct and must remain separately visible.
- **Source of truth:** Official usage → priced raw usage events. Payable amount / wallet balance →
  wallet ledger debit entries.
- **Alternatives rejected:** (a) Lower the dashboard number to $40 — corrupts official reporting.
  (b) Rewrite ledger so cost == debit — corrupts immutable financial history.
- **Risk:** A relabel could itself confuse customers if wording is sloppy; mitigated by showing two
  explicit lines ("Usage (list price)" and "Charged to prepaid wallet").
- **Verification:** Smoke check that list-price aggregate = $100 and ledger debit = $40 remain
  distinct; wallet balance delta = $40.

### 2026-06-20 14:25 — The prepaid multiplier applies to the ledger debit only

- **Context:** Need to decide where `0.4` is allowed to act.
- **Decision:** The prepaid multiplier affects **only the payable debit (ledger)**. It must **not**
  scale raw usage events and must **not** scale the official list-price report. Dashboard labels
  must name which number is which.
- **Source of truth:** ledger debit entry.
- **Alternatives rejected:** Applying 0.4 to raw usage events (would understate official usage and
  break Finance's report).
- **Risk:** If any other code path also multiplies by 0.4, we would double-discount — guarded by an
  idempotency/no-double-debit assertion.
- **Verification:** Assert exactly one debit per settlement; assert official usage untouched by 0.4.

### 2026-06-20 14:35 — "balance" must not leak into provider/load-balancing meanings

- **Context:** `balance` is overloaded across customer wallet, provider account, and
  load-balancing weight.
- **Decision:** This incident touches **customer wallet balance only**. Provider account balance
  and load-balancing weight are explicit non-goals and must be proven untouched.
- **Source of truth:** wallet ledger (customer), provider settlement records (provider), router
  config (LB weight) — three different stores.
- **Alternatives rejected:** Treating "balance" as one global concept.
- **Risk:** A careless change to a shared "balance" helper could move routing weights.
- **Verification:** Tests asserting provider balance and load-balancing weight values are unchanged
  by the dashboard fix (see part1-billing-semantics.md §5).

### 2026-06-20 15:05 — Code consistency bug is the demographics race, not billing

- **Context:** Bug-repro ticket #4521 reports "data inconsistency / data overwrite." The repo has
  no billing code; the actual defect is in `analysis.service.ts`.
- **Decision:** Classify ticket #4521 as a **last-writer-wins race**: `createAnalysis` schedules a
  `setTimeout` that re-persists stale *quick* demographics (confidence 0.3) ~2s later, clobbering
  the worker's real `COMPLETED` result. Fix = remove the racing background re-write (see
  refactor-plan.md). This is a code defect, distinct from the billing-label semantics above.
- **Source of truth:** the worker pipeline owns final `demographics`; the request handler only
  seeds preliminary values.
- **Alternatives rejected:** Adding optimistic-locking/version gymnastics around a write that
  should not exist at all.
- **Risk:** Removing the timer must not drop the legitimate initial save (it does not — the initial
  `saveJob` already persists the preliminary record).
- **Verification:** Characterization test in `apps/legacy-app/test/bug-repro.spec.ts`.
