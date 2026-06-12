# Decision Log

> Required. Record semantic decisions before modifying billing, usage, routing, failover, release, or customer-facing contract behavior.

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | In the incident context: the customer's prepaid wallet balance (money the team can still spend) | prepaid wallet ledger (sum of entries) | provider account balance / load-balancing weight / customer wallet |
| account | In the incident context: the customer (team) account that owns the prepaid wallet | customer account record | customer account / provider account / upstream credential |
| usage | Raw gateway usage events valued at list price; the dashboard number is a derived aggregate of these | usage metering store (raw events) | raw usage event / ledger entry / dashboard aggregate |
| total cost | The official list-price valuation of usage ($100.00) — a reporting number, not a deduction | metering store x official price table | official list price / customer payable amount |
| actual cost | The payable prepaid debit actually deducted from the wallet ($40.00 = official x 0.4) | ledger debit entries | deducted ledger amount / provider settlement amount |
| stable | The ALB stable target group serving weight 99 with image `phase0-a17f3d2` | `ops/current-rollout-state.json` / ALB state | Git branch / ALB stable target group / stable API contract |
| canary | The ALB canary target group at weight 1 serving **public** traffic with image `phase1-b93c1a8` | `ops/current-rollout-state.json` / ALB state | private shadow canary / public traffic canary |
| provider balance | Our remaining spend/credit at the upstream model provider — company money, never customer-visible | provider billing console / provider settlement records | customer wallet balance |
| load balance / load-balancing weight | ALB traffic weight between stable and canary target groups — release plumbing, not money | ALB listener rule config | any monetary "balance" |
| ledger | Append-only record of customer debits/credits; the audit source of truth for customer money | ledger store | dashboard read model |
| prepaid multiplier | Contractual team discount (0.4) applied once by the billing engine at debit time | customer contract / billing engine config | provider discount |

## Decision entries

### 2026-06-12 12:30 — Incident classification: wrong label, not wrong money

- Context: Dashboard shows `Total usage cost: $100.00`; wallet debited `$40.00`; team prepaid multiplier `0.4`. Sales fears inconsistency, Finance fears undercharging, Engineering suspects duplicate billing.
- Decision: Classify as a **customer-facing labeling defect**. The debit path is correct: `$100 (official) x 0.4 (multiplier) = $40 (payable)`. Not an undercharge, not double billing.
- Source of truth: ledger debit entries for payable; metering store for official usage.
- Alternatives rejected: undercharge (contradicted by exact arithmetic), double billing (contradicted by a single observed $40 debit; duplicate paths produce extra debits).
- Risk: if other tenants have different multipliers, the same label confusion exists account-wide — the fix must be generic, not Acme-specific.
- Verification: ledger entry count per usage window == 1; debit/official ratio == contract multiplier for sampled tenants.

### 2026-06-12 12:34 — Payable is read from the ledger, never recomputed in presentation

- Context: The tempting one-line fix is `dashboardValue = official * multiplier` in the display layer.
- Decision: The dashboard must read the payable number from ledger data. Presentation-layer recomputation is forbidden.
- Source of truth: ledger debit entries.
- Alternatives rejected: read-time multiplication (silently double-applies or diverges the day billing logic changes — a second billing source of truth, explicitly banned by the ticket).
- Risk: dashboard needs a ledger read path; if one does not exist it must be added as a read-only query.
- Verification: contract test that dashboard payable equals the sum of ledger debits for the period, byte-for-byte from the same store the wallet uses.

### 2026-06-12 12:37 — Historical ledger entries are immutable

- Context: "Fix this urgently" pressure invites rewriting history so old dashboards match new labels.
- Decision: No historical ledger rewrite. History stays as written; only labels/read-model presentation change.
- Source of truth: append-only ledger.
- Alternatives rejected: backfilling/relabeling stored ledger amounts (corrupts audit trail, breaks reconciliation with provider settlement and finance exports).
- Risk: support must be briefed that old screenshots show the old label.
- Verification: ledger store row counts and checksums identical before/after deploy.

### 2026-06-12 12:40 — Multiplier applies exactly once, at debit time, in the billing engine

- Context: Part 1 asks whether the prepaid multiplier should affect raw usage, ledger debit, dashboard labels, or all of them.
- Decision: The multiplier affects **the ledger debit only**. Raw usage events stay list-price (official reporting and provider reconciliation depend on them). The dashboard displays both numbers with correct labels but applies no math of its own.
- Source of truth: billing engine config (multiplier), metering store (official), ledger (payable).
- Alternatives rejected: discounting raw usage events (destroys official reporting), multiplying in the dashboard (second source of truth).
- Risk: any future "show discounted usage" feature must read derived values from billing output, never re-derive.
- Verification: invariant test `ledger_debit == official_usage x multiplier` on sampled events; raw event values unchanged.

### 2026-06-12 12:44 — Urgent patch bases on stable image A; Phase 1 frozen

- Context: Phase 1 canary (`phase1-b93c1a8`, dashboard label/aggregation changes) is live on 1% public traffic, unpromoted and unvalidated. Urgent Phase 2 (label fix) due in 60 minutes touches the same surface.
- Decision: Freeze Phase 1 (no promotion, no in-place update), drain its public traffic, and build the urgent patch as `stable A + minimal label fix`. Full sequence and rollback targets in `solutions/release-command-log.md`.
- Source of truth: `ops/current-rollout-state.json` for live state.
- Alternatives rejected: patching canary in place (public traffic + unvalidated Phase 1 piggybacks into the urgent change, no isolated rollback); basing Phase 2 on image B (bundles unvalidated aggregation changes into an emergency deploy).
- Risk: Phase 1 must later be rebased on the new stable; tracked as explicit follow-up.
- Verification: smoke checks in release log prove official/payable numbers unchanged and rollback target A reachable at every step.

### 2026-06-12 12:47 — Legacy delayed refresh must never clobber post-PENDING job state (Part 4 scope)

- Context: `AnalysisService.createAnalysis` schedules a 2s fire-and-forget `delayedUpdate` that unconditionally re-writes stale quick demographics; the worker can complete in between, so real results get overwritten (ticket #4521 in `apps/legacy-app/test/bug-repro.spec.ts`).
- Decision: Smallest safe invariant: the delayed refresh may only touch jobs still in `PENDING`, enforced atomically in the database update filter. No deletion of the write path, no event-flow redesign.
- Source of truth: job document `status` field at write time (atomic conditional update).
- Alternatives rejected: deleting the delayed refresh (silently removes an existing write path — bigger behavior change than needed); read-then-check-then-write in the service (keeps a race window).
- Risk: jobs that legitimately linger in PENDING still get refreshed — unchanged behavior, accepted.
- Verification: characterization tests lock creation behavior; regression test proves a COMPLETED job is not overwritten (red before fix, green after) — evidence in `solutions/test-evidence.md`.
