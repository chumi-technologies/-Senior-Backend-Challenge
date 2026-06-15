# Spec — High Availability Urgent Change

> Completed before modifying code. All decisions are recorded here first.

## 1. Current-state understanding

- **Customer-facing symptom**: Acme Team dashboard shows `Total usage cost: $100.00`, but their prepaid wallet was only debited `$40.00`. Support ticket claims possible undercharge or billing bug.
- **Affected customer / surface**: Teams with prepaid multiplier < 1.0; dashboard usage-cost label; QBR presentation imminent (60 min deadline).
- **Current release state**: Phase 1 canary `phase1-b93c1a8` at 1% public traffic, not promoted. Stable `phase0-a17f3d2` at 99%. Phase 1 changes dashboard aggregation labels for prepaid usage reporting.
- **Known constraints**: No customer-visible API downtime; no ledger mutation; no second billing source of truth; clear rollback target required at every step.

## 2. Source-of-truth map

```text
API call / usage event
  -> Gateway records raw usage (official list-price, e.g. $100)
  -> Ledger applies prepaid multiplier (0.4 × $100 = $40 debit)
  -> MongoDB persists AnalysisJob with demographics
  -> Dashboard reads from MongoDB aggregate — shows label "Total usage cost"
  -> Customer sees $100 label but wallet shows $40 debit
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | Ledger (append-only debit/credit log) | Dashboard reads ledger balance | Ledger write on usage event with prepaid multiplier applied | provider account balance / load-balancing ALB weight |
| official usage cost | Raw usage event / provider report | Usage reporting pipeline | Gateway on API response | customer payable debit amount |
| payable prepaid debit | Ledger entry (multiplier applied) | Customer billing statement | Ledger service (multiplier × list-price) | official list-price / provider settlement cost |
| release stable | ALB stable target group (`phase0-a17f3d2`) | ALB routing rules | Deployment pipeline on promotion | Git branch named `stable` / stable API contract |
| canary | ALB canary target group (`phase1-b93c1a8`) at 1% public | ALB weighted routing | Deployment pipeline | private shadow canary (0% public traffic) |

## 3. Root-cause hypotheses before code

1. **Dashboard label mismatch (most likely)**: The label `Total usage cost` renders the official list-price ($100) but customers read it as their payable debit. The actual debit ($40) is semantically correct — it is the prepaid-multiplied ledger entry. The label is misleading, not the amount.
2. **Race condition data overwrite (confirmed bug, ticket #4521)**: `AnalysisService.createAnalysis()` fires a `setTimeout(delayedUpdate, 2000)` that overwrites job demographics. The first-attempt fix used a read-then-write status check, which is a TOCTOU race. The corrected fix delegates the write decision to MongoDB via a single atomic conditional update — `updateOne({ jobId, status: { $ne: 'COMPLETED' } }, ...)`. See `solutions/refactor-plan.md` and `solutions/decision-log.md` for the full reasoning.
3. **Worker type coercion bug**: `AnalysisProcessor.transformApiResponse()` casts `data.age as number`, but the API can return `"25+"` (string). `calculateAgeRange(NaN)` falls through to `'55+'` bucket — incorrect age range classification.

## 4. Non-goals

- Do not rewrite historical ledger entries — ledger semantics are correct; only the dashboard label is misleading.
- Do not change the prepaid multiplier application logic — $40 debit is correct behavior.
- Do not perform a broad architectural rewrite of `AnalysisService` — only remove the `delayedUpdate` race condition.
- Do not promote Phase 1 canary before the Phase 2 urgent fix is deployed and verified.
- Do not change provider balance or load-balancing weights.

## 5. Blast radius

- **Affected endpoints**: `POST /analysis` (race condition in createAnalysis), `GET /analysis/:id` (may return stale demographics due to overwrite).
- **Affected customer-facing display**: Dashboard label `Total usage cost` for teams with prepaid multiplier ≠ 1.0.
- **Affected billing / ledger behavior**: None — ledger debits are semantically correct. Only the dashboard label needs renaming.
- **Affected provider / routing behavior**: None — provider balances and ALB weights unchanged.
- **Affected release state**: Phase 1 frozen at 1% canary; Phase 2 patch deployed on top of stable image A.
- **Metadata leakage risk**: None — no provider credentials or internal keys exposed by these changes.

## 6. Validation plan

- **Characterization tests**: Reproduce race condition in `test/bug-repro.spec.ts` — confirm `delayedUpdate` overwrites Worker result when Worker completes before 2s timeout.
- **Contract tests**: Verify ledger debit amount unchanged after dashboard label rename; assert `official_cost ≠ payable_debit` semantics preserved in test output.
- **Smoke checks**: After Phase 2 deploy, confirm `GET /analysis/:id` returns COMPLETED status with Worker demographics (not overwritten). Confirm dashboard shows renamed label with correct prepaid-multiplied amount.
- **Release checks**: ALB health check on stable target group passes before shifting any traffic; canary desired count remains 1 during freeze; rollback target is `phase0-a17f3d2`.
- **Evidence to paste into final report**: `pnpm run verify:submission` output; test run output showing race condition reproduced then fixed.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| Billing incident is a wrong dashboard label, not a wrong debit | **Accepted** | $40 debit = 0.4 × $100 is mathematically correct. Label shows list-price, not payable amount. No ledger rewrite needed. |
| Phase 2 must be based on stable image A (`phase0-a17f3d2`) | **Accepted** | Phase 1 has not been promoted; basing Phase 2 on unverified canary would create an untracked dependency and lose clear rollback target. |
| Replace the active public canary task definition with phase2 in place | **Rejected (corrected by reviewer)** | An active public canary cannot be directly replaced with another urgent canary. Customers in the canary slot would be exposed to a mid-flight image swap. The corrected sequence is **drain-first / deploy-second**: shift ALB to `stable=100% / canary=0%`, only THEN deploy phase2 into the (now non-public) canary slot, run internal-only smoke at 0% public, then re-introduce 1% public traffic. |
| Fix the race condition with a status check (`findJobById` then `updateJob`) | **Rejected (corrected by reviewer)** | This is read-then-write, a TOCTOU race. Between the read and the unconditional write, the Worker can flip the job to COMPLETED and the unconditional write overwrites it. Concurrent write protection MUST be an atomic update, not a read-then-write. The fix is a single `updateOne({ jobId, status: { $ne: 'COMPLETED' } }, ...)` exposed as `DatabaseService.updateJobIfNotCompleted`. |
| Submission must run on a clean clone (`pnpm install` then `pnpm test`) without manual build steps | **Accepted (corrected by reviewer)** | The first attempt depended on a pre-built `dist/` for `@senior-challenge/shared-types`, which is `.gitignore`d. Fixed by pointing `main` and `types` at `src/index.ts` and adding a `prepare` script so pnpm install builds the shared types automatically. A `pnpm run verify:clean-clone` script asserts the structural invariants. |
| Rewrite `AnalysisProcessor` with full error handling and structured logging | **Rejected** | Out of scope for this challenge; surgical refactor only targets the specific responsibility leak (race condition). Broad rewrite introduces risk. |
