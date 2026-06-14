# Spec — High Availability Urgent Change

> Complete this before modifying code.

## 1. Current-state understanding

- Customer-facing symptom: Acme Team sees `Total usage cost: $100.00` on the dashboard while its team prepaid wallet was debited `$40.00`.
- Affected customer / surface: Acme Team dashboard cost wording and support-facing explanation for the QBR; no current evidence proves that the underlying ledger debit is wrong.
- Current release state: Phase 1 is already in public canary observation. Stable image is `registry.example.com/gateway:phase0-a17f3d2`, canary image is `registry.example.com/gateway:phase1-b93c1a8`, traffic weights are stable 99 / canary 1, and canary has public traffic.
- Known constraints: do not cause customer-visible downtime, do not mutate ledger semantics to make labels match, do not create a second billing source of truth, keep Phase 1 / urgent Phase 2 rollback targets clear, and require test coverage for every code change.

## 2. Source-of-truth map

```text
Request / usage event
  -> raw usage metering record
  -> official list-price usage report: $100.00
  -> billing ledger applies team prepaid multiplier 0.4
  -> payable prepaid wallet debit: $40.00
  -> dashboard must label both values according to their actual meaning
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | Append-only customer billing ledger, or wallet balance derived from that ledger | Customer account, billing dashboard, support tooling | Debit / credit ledger events only | Provider account balance / load-balancing weight |
| official usage cost | Raw usage metering plus official list-price pricing rules | Finance usage reporting, official usage dashboard aggregate | Gateway metering / usage reporting path | Payable prepaid debit |
| payable prepaid debit | Billing ledger entry after applying team prepaid multiplier | Wallet balance, customer payable amount display, invoice support view | Billing ledger debit calculation: official usage cost multiplied by prepaid multiplier | Official list-price usage |
| dashboard displayed cost | Presentation view model assembled from official usage and ledger debit fields | Customer-facing dashboard | Dashboard aggregation / label mapping | Source-of-truth ledger or raw usage record |
| release stable | Current production stable target group/image: `registry.example.com/gateway:phase0-a17f3d2` | ALB / rollout state | Release controller / deployment action | Git branch named stable or stable API contract |
| canary | Public traffic canary target group/image: `registry.example.com/gateway:phase1-b93c1a8` at 1% traffic | ALB / rollout state | Release controller / deployment action | Private shadow canary |

## 3. Root-cause hypotheses before code

1. Most likely: dashboard label / aggregate conflates official list-price usage cost with actual payable prepaid wallet debit.
2. The phrase `Total usage cost` is customer-facing ambiguous wording; customers reasonably interpret it as the amount deducted from the prepaid wallet.
3. Current facts do not prove wrong debit, undercharging, duplicate billing, or a second billing path. Those remain risks to verify, not conclusions.

## 4. Non-goals

- Do not rewrite historical ledger entries to make the dashboard label appear consistent.
- Do not change raw usage metering or official list-price usage reporting from `$100.00` to `$40.00`.
- Do not change provider balances, provider settlement logic, load-balancing weights, routing, or failover behavior.
- Do not combine the unpromoted Phase 1 canary change with the urgent Phase 2 fix unless dependency analysis proves it is required.
- Do not add a parallel billing source of truth or local dashboard-only financial calculation that can diverge from the ledger.

## 5. Blast radius

- Affected endpoints: customer dashboard cost / usage read path and any API response field that exposes the same `Total usage cost` label or aggregate.
- Affected customer-facing display: Acme Team sees official list-price usage under wording that implies payable debit; fix should distinguish `Usage at list price: $100.00` from `Prepaid wallet debit: $40.00`.
- Affected billing / ledger behavior: intended ledger debit remains `$40.00`; no ledger mutation is required for the current semantic fix.
- Affected provider / routing behavior: none intended. Provider account balance, upstream credentials, and load-balancing weights must be verified untouched.
- Affected release state: urgent fix must account for Phase 1 already receiving 1% public canary traffic; rollback target should remain stable image `phase0-a17f3d2` unless a separate release decision changes it.
- Metadata leakage risk: dashboard must not expose provider settlement cost, provider account balance, upstream credential names, internal route weights, or canary metadata to customers.

## 6. Validation plan

- Characterization tests: lock current ledger semantics with the example official usage `$100.00`, prepaid multiplier `0.4`, and payable debit `$40.00`.
- Contract tests: dashboard response should expose / label official usage and prepaid wallet debit as separate concepts; `Total usage cost` must not be used for the wallet debit-facing value unless the value is actually `$40.00`.
- Smoke checks: for Acme Team, dashboard shows a clear list-price usage value and a clear prepaid wallet debit value; wallet balance changes still equal `$40.00`.
- Unit tests: every code change must be covered by focused unit tests for the changed function, helper, service, or state transition. No behavior change is accepted without a failing-or-protective test that would catch a regression.
- End-to-end simulation tests: required when a change crosses API, queue, worker, database, provider facade, billing ledger semantics, release routing, or batch-processing boundaries. The simulation should exercise the full path with controlled fake dependencies rather than relying on production services.
- Release checks: before any rollout action, record stable image, canary image, traffic weights, whether canary has public traffic, exact action, rollback target, and why the action is safe.
- Evidence to paste into final report: command output for unit tests, any required end-to-end simulation tests, sample dashboard/API payload before and after label change, release state snapshot, and checks showing provider balance and load-balancing weights did not change.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| Treat `$100.00` vs `$40.00` as a dashboard semantic mismatch, not proven wrong debit | Accepted | The prepaid multiplier of `0.4` makes a `$40.00` debit consistent with a `$100.00` official list-price usage amount. |
| Change ledger history so the displayed number and debit match | Rejected | Historical ledger is the customer balance source of truth; rewriting it would risk financial corruption and audit gaps. |
| Change raw usage / official usage reporting from `$100.00` to `$40.00` | Rejected | The prepaid multiplier should affect payable ledger debit, not erase official list-price usage. |
| Add a second dashboard-only billing calculation | Rejected | A parallel billing source of truth would drift from the ledger and make future incidents harder to debug. |
| Ship the urgent fix without considering the active public canary | Rejected | Canary already has public traffic, so release action must preserve rollback clarity and customer-visible availability. |

## 8. Fact standards and issue resolutions

These rules are the baseline for the remaining solution documents and any later code changes.

| Area | Fact / problem | Required resolution |
|---|---|---|
| Billing classification | The `$100.00` dashboard value and `$40.00` wallet debit are semantically different values. | Classify the incident as a customer-facing dashboard wording / aggregate mismatch, not as a proven wrong debit, undercharge, or double-billing bug. |
| Official usage | `$100.00` represents official list-price usage for reporting. | Preserve raw usage metering and official usage reporting at `$100.00`; do not rewrite them to `$40.00`. |
| Payable debit | `$40.00` is the payable prepaid wallet debit after applying multiplier `0.4`. | Preserve the ledger debit semantics; prepaid multiplier affects payable debit only. |
| Dashboard wording | `Total usage cost` is ambiguous because customers interpret it as wallet debit. | Split or relabel the customer-facing display, for example `Usage at list price: $100.00` and `Prepaid wallet debit: $40.00`. |
| Customer balance | Customer wallet balance is financial state. | Use the billing ledger or ledger-derived balance as source of truth; dashboard presentation is never the source of truth. |
| Historical ledger | Historical ledger entries are audit records. | Do not rewrite historical ledger rows; if correction is needed, append a correction / credit / debit event with an idempotency key. |
| Provider balance | Provider account balance is upstream/vendor state. | Keep provider balance separate from customer wallet balance and verify provider balances are untouched by dashboard fixes. |
| Load balance | Load-balancing weight is release/routing state, not money. | Keep load-balancing weight separate from financial balance and verify routing weights are unchanged by billing fixes. |
| Refund on provider failure | Current repository has no implemented wallet refund, hold, capture, or reversal-ledger mechanism. | Do not claim refund behavior exists. Future production design should use hold/capture or append-only reversal ledger entries with idempotency. |
| Worker failure handling | Current worker marks jobs `FAILED`; it does not perform financial compensation. | Treat failure-state handling and financial compensation as separate concerns. Any future failure-compensation code needs unit tests and an end-to-end simulation. |
| Queue model | Current local file queue is a development simulation and is unsafe for multiple concurrent workers. | Production scaling must use a queue with leases / visibility timeout, retry policy, dead-letter handling, and idempotent processing. |
| Message deletion | A worker failure must not silently drop a retriable message. | Processing code must clearly communicate success vs retriable failure vs permanent failure before a queue message is acknowledged or deleted. |
| Async overwrite risk | Preliminary `delayedUpdate` can race with worker completion and overwrite more authoritative results. | If code is touched, add characterization/unit tests first and preserve completed worker results from stale preliminary writes. |
| Third-party response drift | Provider response formats can differ across versions, such as standard `data.audience` vs legacy structures. | Provider facade changes must normalize supported formats behind one contract and include unit tests with representative payloads. |
| Error visibility | Generic `Error happened` logs are insufficient for production debugging. | Include job id, batch id, provider, stage, retryability, and error bucket in new or modified error paths. |
| Release state | Phase 1 is already public canary at 1% and is not promoted. | Freeze or unwind Phase 1 before shipping urgent Phase 2 unless dependency analysis proves otherwise. |
| Phase 2 base | Urgent Phase 2 should avoid carrying unpromoted Phase 1 behavior. | Base the urgent patch on stable image `registry.example.com/gateway:phase0-a17f3d2`, not on Phase 1 canary image `registry.example.com/gateway:phase1-b93c1a8`, unless a documented dependency forces a different decision. |
| Canary safety | Public canary traffic means real customers are exposed. | Do not directly overwrite the active public canary without recording current state, rollback target, customer impact risk, and smoke checks. |
| Release rollback | Rollback target must be known at every step. | Record stable image, canary image, traffic weights, public-traffic status, exact action, and rollback target in `release-command-log.md` before action. |
| Batch scale target | 5 million rows in 2 hours requires about 695 rows/sec before safety margin. | Design for at least 1,000 rows/sec, preferably 1,500 rows/sec if provider quotas and DB capacity allow. |
| Batch architecture | Directly scaling the current single local-file worker is unsafe. | Use object storage upload, streaming CSV split, chunk jobs, real queue, independent worker replicas, idempotent chunk writes, and incremental report summary. |
| Batch queue granularity | One queue message per CSV row would create 5 million messages and operational noise. | Enqueue chunk-level jobs, initially around 2,000-10,000 rows per chunk, with 5,000 rows as the first planning value. |
| Provider throughput | Horizontal workers only help until provider quotas, database writes, or queue overhead become bottlenecks. | Use per-provider global concurrency limits, token-bucket rate limiting, backpressure, and load tests before promising the 2-hour SLA. |
| Partial failure | Batch jobs should not become all-or-nothing black boxes. | Track batch, chunk, and row summary status; retry bounded failures; route permanent failures to DLQ; preserve representative failed records. |
| Alerting | Per-row alerts would overwhelm operators. | Group errors by bucket and threshold; alert on failure rate, stuck chunks, backlog age, and SLA risk rather than each bad row. |
| Degrade mode | The system needs a customer-safe fallback when the batch falls behind. | Provide partial reports, ETA, deferred non-critical dimensions, and an explicit rollback / pause path if billing or usage confidence is low. |
| Refactor scope | Broad rewrites are out of scope. | Extract at most one focused helper/module after tests prove the existing behavior and the intended fix. |
| Test standard | All code changes require regression protection. | Add unit tests for every changed behavior. Add end-to-end simulation tests whenever the change crosses service, queue, worker, provider, ledger, release-routing, or batch boundaries. |
| Submission verification | The local submission verifier requires installed dependencies. | Run `pnpm install` before `pnpm run verify:submission`, then paste meaningful command output evidence. |
