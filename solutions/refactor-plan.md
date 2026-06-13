# Surgical Refactor Plan

## 1. Target

- File: `apps/legacy-app/src/billing/dashboard-cost-display.ts`
- Function / class: `buildDashboardCostDisplay`
- Why this is in scope: the incident is a customer-facing billing display semantics bug. A small helper isolates overloaded `cost` meanings without changing ledger, provider, routing, or release framework code.

## 2. Current responsibility leak

The previous dashboard concept used one phrase, `Total usage cost`, for two meanings: official list-price usage and customer prepaid wallet debit. That leaks billing semantics into display wording and invites fixes that mutate the wrong source of truth.

## 3. Characterization test

- Existing behavior to lock: official list-price usage `$100.00` and payable prepaid debit `$40.00` are both valid and must remain distinct.
- Test file: `apps/legacy-app/test/bug-repro.spec.ts`
- Expected failure mode if behavior changes accidentally: official usage becomes `4000`, provider balance changes from `250000`, or load-balancing weight changes from `25`.

## 4. Extraction boundary

- Extracted helper / function: `buildDashboardCostDisplay`
- Inputs: `officialUsageCostCents`, `prepaidMultiplier`, `providerBalanceCents`, `loadBalancingWeight`
- Outputs: official usage cents, payable prepaid debit cents, customer primary label/amount, official usage label, provider/routing pass-through invariants
- Side effects: none; no database writes, no ledger writes, no provider calls, no routing mutations
- Why this is the smallest safe boundary: it fixes the display contract in one pure helper and gives tests a stable seam without rewriting the legacy service.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Build a full billing domain model with ledger, rating, provider settlement, and routing services. | Too broad for a 60-minute urgent customer-facing fix; would increase blast radius. |
| Rewrite historical ledger rows so the dashboard number matches. | Ledger is source-of-truth for customer balance and should not be rewritten for label ambiguity. |
| Apply prepaid multiplier inside raw usage ingestion. | Corrupts official usage reporting and breaks finance/reporting semantics. |
| Patch the public Phase 1 canary image in place. | Canary has public traffic and is not promoted, so rollback would be unclear. |

## 6. Verification

- Tests run: `pnpm --filter legacy-app test`
- Command output: 2 tests passed, 0 failed.
- Remaining risk: this repository does not include a real dashboard endpoint or ledger database, so the helper is a focused contract demonstration rather than a full production integration.
