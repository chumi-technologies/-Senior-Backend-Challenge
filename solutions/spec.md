# Spec - High Availability Urgent Change

## 1. Current-state understanding

- Customer-facing symptom: Acme Team sees `Total usage cost: $100.00` beside a value they interpret as prepaid wallet money already deducted, while the actual prepaid wallet debit is `$40.00`.
- Affected customer / surface: customer dashboard wording and aggregate presentation for prepaid teams; the QBR risk is trust and explanation risk, not proven money movement corruption.
- Current release state: `ops/current-rollout-state.json` says Phase 1 is public canary observing, stable image `registry.example.com/gateway:phase0-a17f3d2`, canary image `registry.example.com/gateway:phase1-b93c1a8`, traffic weight 99/1, canary has public traffic, Phase 1 not promoted.
- Known constraints: do not cause customer-visible API downtime, do not mutate ledger semantics to make labels match, do not create a second billing source of truth, and keep Phase 1 and urgent Phase 2 rollback targets clear.

## 2. Source-of-truth map

```text
Gateway request / raw usage event
  -> official usage reporting aggregate at list price ($100.00)
  -> customer ledger / prepaid wallet debit using team multiplier 0.4 ($40.00)
  -> dashboard display that must label both meanings without treating them as the same balance
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | ledger debit / wallet transaction record | customer billing ledger read model | billing debit writer after rated usage | provider balance / load-balancing weight |
| official usage cost | raw usage event and official list-price usage aggregate | usage reporting aggregate | gateway usage recorder / usage aggregator | payable debit |
| payable prepaid debit | customer ledger entry after prepaid multiplier | wallet ledger read model | billing debit writer applying team multiplier | official list price |
| provider balance | provider account / settlement state | provider account integration | provider settlement process | customer wallet balance |
| load-balancing weight | routing configuration | ALB or gateway routing config | release / routing controller | money balance |
| release stable | ALB stable target group image A | rollout state file / deploy system | deployment promotion command | Git branch named stable |
| canary | public traffic target group image B at 1% | rollout state file / ALB weights | canary deployment command | private shadow canary vs public canary |

## 3. Root-cause hypotheses before code

1. Most likely: wrong dashboard label / presentation contract. `$100.00` is official list-price usage, while `$40.00` is payable prepaid wallet debit.
2. Possible but not yet proven: dashboard aggregate uses the correct official usage source but does not expose the customer payable debit next to it.
3. Less likely: duplicate billing path. The given numbers exactly match `100.00 * 0.4 = 40.00`, so there is no evidence of double debit.

## 4. Non-goals

- Do not rewrite historical ledger entries; they are the customer balance source of truth.
- Do not apply prepaid multiplier to raw usage events or official usage reporting.
- Do not change provider balances, provider settlement, upstream credentials, or load-balancing weights.
- Do not merge unpromoted Phase 1 canary behavior into the urgent Phase 2 fix.
- Do not rewrite the legacy application or create a parallel billing framework.

## 5. Blast radius

- Affected endpoints: only the customer-facing dashboard cost display contract / helper; no database schema or ledger writer changes in this submission.
- Affected customer-facing display: label changes from ambiguous `Total usage cost` as the primary customer amount to explicit `Prepaid wallet debit`, with official list-price usage preserved as secondary/reporting context.
- Affected billing / ledger behavior: ledger debit remains `$40.00`; no historical ledger mutation.
- Affected provider / routing behavior: provider balance and load-balancing weight must be pass-through unchanged.
- Affected release state: Phase 1 public canary must be paused or unwound before urgent Phase 2 is shipped from stable image A.
- Metadata leakage risk: do not expose provider account balance or routing weight to customers; tests use them only as internal invariants.

## 6. Validation plan

- Characterization tests: lock that official list-price usage `$100.00` and payable prepaid debit `$40.00` can coexist and are not the same semantic field.
- Contract tests: prove customer primary display amount is prepaid wallet debit, while official usage label remains available for reporting.
- Smoke checks: health endpoint, dashboard label check, official usage unchanged, ledger debit unchanged, provider/routing values unchanged.
- Release checks: record stable image, canary image, traffic weight, public traffic, and rollback target before any release sequence.
- Evidence to paste into final report: `pnpm --filter legacy-app test`, `pnpm run test`, `pnpm run verify:submission`, and the initial failing test output showing the helper was absent before implementation.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| Multiply all usage/cost fields by prepaid multiplier so dashboard and ledger match. | Rejected. | This would corrupt official usage reporting and hide the distinction between list price and payable debit. |
| Rewrite historical ledger entries from `$40.00` to `$100.00`. | Rejected. | Ledger is customer balance source-of-truth; the numbers already match the prepaid contract. |
| Update the public canary image in place to save time. | Rejected. | Canary has public traffic and Phase 1 is not promoted, so in-place mutation would remove a clean rollback target. |
| Extract one dashboard display helper and test pass-through provider/routing invariants. | Accepted. | It is the smallest verified intervention that fixes customer-facing semantics without touching billing writers. |
