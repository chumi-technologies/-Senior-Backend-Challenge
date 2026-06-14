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

### 2026-06-14 20:24 — Race condition fix: version guard, not full removal of delayedUpdate

- **Context**: `AnalysisService.delayedUpdate()` fires 2 seconds after job creation and unconditionally overwrites demographics. Worker completes full analysis in ~500ms-1500ms (API simulation). Race condition: if Worker completes before 2s, delayedUpdate overwrites the high-confidence result with low-confidence quick-demographics.
- **Decision**: Fix by adding a **status guard** — `delayedUpdate` only writes if the job status is still `PENDING`. If Worker has already set status to `COMPLETED`, the update is skipped.
- **Source of truth**: `AnalysisJob.status` field in MongoDB is the write-ordering indicator.
- **Alternatives rejected**: Full removal of delayedUpdate — rejected because for jobs where Worker hasn't started yet (queue backlog), the quick-demographics initial write is the only data available; removing delayedUpdate changes behavior for slow-worker scenarios. Using MongoDB `version` field with optimistic locking — this is the correct long-term approach but requires schema migration; status guard achieves the same safety with minimal code change.
- **Risk**: Status guard relies on atomic read of `status` field. If Worker sets PROCESSING before delayedUpdate fires, the guard correctly allows the update (Worker hasn't completed yet). Only COMPLETED status prevents overwrite.
- **Verification**: `bug-repro.spec.ts` must show that a simulated Worker COMPLETED update is NOT overwritten by subsequent delayedUpdate.
