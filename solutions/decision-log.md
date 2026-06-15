# Decision Log

> Required. Record semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | **Customer wallet balance**: the remaining prepaid credit in the customer's ledger account (e.g. Acme Team's prepaid wallet after $40 debit) | Ledger (append-only debit/credit entries) | provider account balance (funds in upstream API provider account) / load-balancing weight (ALB traffic percentage) |
| account | **Customer account**: the tenant/team record owning the wallet and usage history (e.g. Acme Team) | Customer account database | provider account (upstream API credentials) / upstream credential (API key stored in secrets manager) |
| usage | **Raw usage event**: a single API call with its official list-price cost recorded at gateway | Usage event log / gateway records | ledger entry (the multiplied debit written to ledger) / dashboard aggregate (sum of ledger entries displayed to user) |
| total cost | **Official list-price cost**: the undiscounted provider rate for the usage, e.g. $100.00 | Provider usage report / gateway raw event | customer payable debit (what customer actually owes after multiplier) |
| actual cost | **Customer payable debit**: the amount deducted from the customer's prepaid wallet after applying the team prepaid multiplier (e.g. 0.4 × $100 = $40) | Ledger debit entry | official list-price ($100) / provider settlement amount (what we owe the provider) |
| stable | **ALB stable target group**: the production-serving image currently receiving 99% of public traffic (`phase0-a17f3d2`) | `ops/current-rollout-state.json` → `stableImage` | Git branch named `stable` / stable API contract / semantically stable behavior |
| canary | **Public traffic canary**: the ALB target group receiving 1% of real user traffic (`phase1-b93c1a8`), currently in observation and not promoted | `ops/current-rollout-state.json` → `canaryImage` | private shadow canary (receives copied traffic, zero public exposure) |

## Decision entries

### 2026-06-14 20:24 — Billing incident root cause: dashboard label, not wrong debit

- **Context**: Acme Team (prepaid multiplier 0.4) sees `Total usage cost: $100.00` on dashboard but wallet was debited $40.00. Sales worries about undercharge; Finance worries about wrong report.
- **Decision**: This is a **wrong dashboard label** incident, not a wrong debit. The $40 debit is correct — ledger correctly applies multiplier (0.4 × $100). The label `Total usage cost` displays the official list-price which is correct for usage reporting, but the label is semantically misleading to customers who interpret it as the amount owed.
- **Source of truth**: Ledger is the source of truth for customer balance. The ledger entry shows $40 debit which is correct. Raw usage event shows $100 which is the official list-price for provider reporting.
- **Alternatives rejected**: (a) Rewrite ledger to store multiplied amount as "total cost" — rejected because it would destroy the official usage record needed for provider reconciliation. (b) Change the multiplier application logic — rejected because billing math is correct.
- **Risk**: Renaming the dashboard label from `Total usage cost` to `Prepaid cost (after discount)` or similar must be done via Phase 2 canary, not by directly mutating the stable deployment.
- **Verification**: After label fix, assert that `official_list_price_usd = 100` and `payable_debit_usd = 40` remain separate fields in usage event and ledger respectively.

### 2026-06-14 20:24 — Phase 2 must be based on stable image A, not Phase 1 canary

- **Context**: Phase 1 canary (`phase1-b93c1a8`) is at 1% public traffic but not promoted. Phase 2 urgent fix needed within 60 minutes.
- **Decision**: Phase 2 patch is based on **stable image A** (`phase0-a17f3d2`). Phase 1 is frozen (not rolled back, not promoted) during Phase 2 deployment.
- **Source of truth**: `ops/current-rollout-state.json` — `phase1Status: "public canary observation, not promoted"`.
- **Alternatives rejected**: Basing Phase 2 on Phase 1 canary — rejected because (a) Phase 1 has not been validated/promoted, (b) it would create a compound unverified image with two sets of changes, (c) rollback target would become unclear (must roll back through Phase 1 to reach stable).
- **Risk**: Phase 1 and Phase 2 will eventually need to be merged. After Phase 2 is promoted to stable, Phase 1 must be re-evaluated against the new stable baseline before promotion.
- **Verification**: Phase 2 image build log must reference `phase0-a17f3d2` as base. Rollback target is always `phase0-a17f3d2`.

### 2026-06-15 11:00 — Race condition fix: ATOMIC conditional update, not read-then-write

- **Context**: `AnalysisService.delayedUpdate()` fires 2 seconds after job creation. The Worker can finish the full analysis in ~500–1500 ms, often before the timer fires. The first-attempt fix used a read-then-write pattern (`findJobById` followed by `updateJob`) with a status check between the two calls.
- **Why the first-attempt fix is wrong**: that pattern is a textbook TOCTOU (time-of-check / time-of-use) race. Between the read returning `status='PENDING'` and the unconditional `updateJob` writing the document, the Worker can flip the document to `status='COMPLETED'`. The unconditional write then overwrites the COMPLETED state. The check provides no protection because the database is not asked to enforce it at write time.
- **Decision**: Replace read-then-write with a single **atomic conditional update**. The application code calls a new `DatabaseService.updateJobIfNotCompleted(jobId, updates)` method, which issues:

  ```
  collection.updateOne(
    { jobId, status: { $ne: 'COMPLETED' } },
    { $set: { ...updates, updatedAt: ... } },
  )
  ```

  The filter `status: { $ne: 'COMPLETED' }` is evaluated by MongoDB at the moment of the write. Either the document is non-COMPLETED at that moment and the write applies, or it is COMPLETED and nothing happens. There is no interleaving window for the application to lose the race.

- **Source of truth**: `AnalysisJob.status` field in MongoDB, evaluated by the database itself, not by the application.
- **Alternatives rejected**:
  - Read-then-write with status check (the previous attempt) — TOCTOU race, rejected.
  - Full removal of `delayedUpdate` — changes observable behaviour for slow-Worker scenarios (jobs still in queue backlog at 2 s).
  - Optimistic locking via a `version` field — correct long-term, but requires schema migration and coordinated changes in Worker write path; out of scope for the urgent fix. The atomic conditional update achieves the same correctness with a single-line filter change.
- **Verification**:
  - `apps/legacy-app/test/bug-repro.spec.ts` adds a TOCTOU regression case that flips the job to COMPLETED *between* a hypothetical read and the write. The test asserts the write is rejected and Worker results are preserved.
  - A structural test asserts that `AnalysisService.delayedUpdate` only ever calls `updateJobIfNotCompleted` and never the unconditional `updateJob`, preventing accidental regression.
  - `pnpm run verify:clean-clone` checks the source files for the atomic-update guard and rejects any reintroduction of the read-then-write pattern.

### 2026-06-15 11:30 — Release sequencing: drain canary BEFORE replacing it

- **Context**: Phase 1 canary (`phase1-b93c1a8`) is at 1% public traffic. Phase 2 needs to ship in 60 minutes. The first-attempt plan replaced the canary task definition in place — i.e. swapped the running container while the canary target group still served customer traffic.
- **Why the first-attempt plan is wrong**: an active public canary cannot be directly replaced with another urgent canary. While the swap is in flight, customers on the canary slot may be served by either the old image, the new image, or by failed health checks. The rollback target also becomes ambiguous because the previous task has been overwritten.
- **Decision**: Adopt a **drain-first / deploy-second** sequence:
  1. Shift ALB weights to `stable=100% / canary=0%` so the canary slot is no longer serving public traffic. Phase 1 task is left running as a warm spare.
  2. Only then deploy `phase2-<hash>` into the canary target group at desired count 1, ALB weight still 0% public.
  3. Verify `phase2` task ALB health = healthy; deregister the old `phase1` task.
  4. Run internal-only smoke checks (synthetic header / contract tests) at 0% public traffic.
  5. Re-introduce 1% public traffic onto `phase2`, observe, then gradually promote.
- **Source of truth**: `ops/current-rollout-state.json` for current weights and image references; ALB listener configuration is the single source of truth for live traffic distribution.
- **Alternatives rejected**:
  - In-place task definition swap on the active public canary — exactly the reviewer-flagged anti-pattern; rejected.
  - Standing up a brand-new third target group in parallel — strictly safer, but adds operational complexity (new TG, new health check, new monitor) within a 60-minute deadline. The drain-then-deploy approach reuses the existing canary slot safely once it is at 0% public traffic.
- **Risk**: while the canary slot is at 0% public, only stable serves real customers. If stable degrades during this window, there is no canary cushion — but the alternative (mid-flight image swap on a public-serving slot) is strictly worse.
- **Verification**: every step in `solutions/release-command-log.md` records the rollback target, and the customer-impact column shows zero customer exposure during the slot mutation (T+12 → T+18). The `Final state → Reviewer-flagged anti-pattern explicitly avoided` line documents the corrected ordering.
