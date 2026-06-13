# Decision Log

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | customer wallet balance means spendable prepaid funds from ledger entries; provider balance means upstream provider account funds; load balance means traffic routing weight | ledger for customer wallet, provider account system for provider balance, ALB/gateway config for load weight | provider account balance / load-balancing weight / customer wallet |
| account | customer account is the tenant/team; provider account is upstream billing relationship; upstream credential is auth material used to call provider | tenant database, provider integration, secret manager | customer account / provider account / upstream credential |
| usage | raw usage event is immutable gateway meter data; ledger entry is rated customer money movement; dashboard aggregate is a read model | raw event store, ledger, dashboard read model | raw usage event / ledger entry / dashboard aggregate |
| total cost | official list-price usage reporting amount before prepaid multiplier | usage reporting aggregate | customer payable amount |
| actual cost | customer payable debit after prepaid multiplier | ledger debit / wallet transaction | provider settlement amount |
| prepaid | customer package multiplier, here `0.4`, applied to payable debit only | customer contract / billing plan config | provider discount |
| stable | deployment image/target receiving normal production traffic | rollout state / deployment controller | Git branch / stable API contract |
| canary | public production target receiving a small traffic percentage for observation | rollout state / ALB weights | private shadow canary |

## Decision entries

### 2026-06-13 08:42 - Classify the Acme incident as display semantics, not wrong debit

- Context: official usage is `$100.00`, prepaid multiplier is `0.4`, and wallet debit is `$40.00`.
- Decision: treat this as an ambiguous dashboard label / display contract bug unless later evidence shows duplicate ledger entries.
- Source of truth: customer balance is the ledger debit; official reporting is raw usage / list-price aggregate.
- Alternatives rejected: rewriting ledger history, multiplying raw usage, or changing provider settlement.
- Risk: customer support must explain two amounts clearly.
- Verification: test `separates official list-price usage from prepaid wallet debit`.

### 2026-06-13 08:47 - Prepaid multiplier applies only to customer payable debit

- Context: finance worried the company undercharged because `$40.00` is lower than `$100.00`.
- Decision: multiplier `0.4` applies to the customer ledger debit and prepaid wallet display, not raw usage events or official usage reporting.
- Source of truth: customer billing plan plus ledger writer.
- Alternatives rejected: applying multiplier to every `cost` field.
- Risk: dashboard must not imply official usage disappeared.
- Verification: display keeps `officialUsageCostCents = 10000` and `payablePrepaidDebitCents = 4000`.

### 2026-06-13 08:55 - Provider and routing meanings of balance are out of scope

- Context: overloaded `balance` can mean money or load-balancing.
- Decision: urgent fix must pass provider balance and load-balancing weight through unchanged.
- Source of truth: provider account system and ALB/gateway routing config.
- Alternatives rejected: touching provider account state or routing weights in a dashboard-label fix.
- Risk: leaking provider/routing internals to customers.
- Verification: test `does not use prepaid multiplier to change provider balance or routing weight`.

### 2026-06-13 09:05 - Urgent Phase 2 must be based on stable image A

- Context: Phase 1 canary image B has 1% public traffic and is not promoted.
- Decision: freeze/unwind Phase 1 and build urgent customer-facing label patch from stable image `registry.example.com/gateway:phase0-a17f3d2`.
- Source of truth: `ops/current-rollout-state.json`.
- Alternatives rejected: patching public canary image B in place or combining Phase 1 and Phase 2.
- Risk: longer deploy path than in-place canary mutation.
- Verification: release log records stable image, canary image, traffic weight, public traffic, and rollback target.
