# Spec — High Availability Urgent Change

> Completed before modifying code. Scope: the customer-facing "Total usage cost" display
> incident for Acme Team, shipped during an in-flight Phase 1 public canary.

## 1. Current-state understanding

- **Customer-facing symptom:** Acme Team's dashboard shows `Total usage cost: $100.00`, but
  their prepaid wallet was debited `$40.00`. The customer reads the `$100.00` label as "amount
  taken from my wallet" and concludes we are inconsistent. The team prepaid multiplier is `0.4`,
  so `100.00 * 0.4 = 40.00` — the **debit is arithmetically correct**; the **label is ambiguous**.
- **Affected customer / surface:** Acme Team (prepaid multiplier 0.4), QBR in ~60 minutes. Surface
  is the usage/cost **dashboard label**, not the billing ledger.
- **Current release state:** `phase1_public_canary_observing`. Stable
  `gateway:phase0-a17f3d2` (2 tasks) at 99% traffic, canary `gateway:phase1-b93c1a8` (1 task) at
  1% public traffic. Phase 1 changed "team prepaid usage reporting labels and dashboard
  aggregation" and has **not** been promoted. Maintenance jobs are disabled on canary.
- **Known constraints:** No customer-visible API downtime; do not mutate ledger semantics to make
  labels match; do not create a second billing source of truth; preserve a clear rollback target;
  60-minute deadline.

## 2. Source-of-truth map

```text
Request / usage event
  -> raw usage event (units consumed)             [immutable fact]
  -> official usage cost = units x list price      [official reporting SoT]
  -> payable prepaid debit = official x 0.4         [ledger SoT, what leaves wallet]
  -> wallet balance -= payable prepaid debit        [customer balance SoT]
  -> dashboard aggregate = read-model over ledger   [presentation only, no SoT]
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | prepaid wallet ledger (sum of debit entries) | dashboard read-model / wallet API | debit on usage settlement | provider balance / load-balancing weight |
| official usage cost | raw usage events priced at list price | usage report / dashboard "list-price" line | written once per usage event | payable debit (what the wallet pays) |
| payable prepaid debit | ledger debit entry (official x multiplier 0.4) | wallet ledger | written once per settlement, idempotent | official list price |
| release stable | ALB stable target group running `phase0-a17f3d2` | ECS/ALB describe | promote = shift weight to validated image | a Git branch named `stable` |
| canary | ALB canary target group with 1% **public** traffic | ALB weights describe | weight shift / image update | a private shadow canary with 0 public traffic |

## 3. Root-cause hypotheses before code

1. **Most likely — ambiguous dashboard label (presentation bug).** The dashboard renders the
   official list-price aggregate under the label `Total usage cost`, which customers interpret as
   "amount deducted." Both numbers are individually correct; only the wording/labeling conflates
   two distinct concepts. Fix lives in the read/presentation layer.
2. **Less likely — wrong aggregate selection.** The dashboard could be summing raw usage events
   (list price) where it intended to show the payable debit. Still a read-model issue, not a debit
   bug.
3. **Ruled out by evidence — double billing / wrong debit.** `100 * 0.4 = 40` exactly; the single
   debit matches the multiplier. No second debit observed. We still add an idempotency assertion to
   *prove* there is no duplicate billing path before closing.

## 4. Non-goals

- Do **not** change the wallet debit amount or the `0.4` multiplier math (the debit is correct).
- Do **not** rewrite historical ledger entries to "match" any label.
- Do **not** rewrite the analysis/worker application or introduce a new billing framework.

## 5. Blast radius

- **Affected endpoints:** usage/cost dashboard read endpoint and its rendered labels only.
- **Affected customer-facing display:** the `Total usage cost` line gains an explicit two-line
  breakdown (official list-price usage vs. amount debited from prepaid wallet).
- **Affected billing / ledger behavior:** none — ledger writes and debit math are untouched.
- **Affected provider / routing behavior:** none — provider balance and load-balancing weight are
  unrelated meanings of "balance" and are explicitly out of scope.
- **Affected release state:** the label change must ship as its own deployable; it must not force
  promotion of the unrelated Phase 1 canary.
- **Metadata leakage risk:** ensure no provider settlement / upstream credential figures leak into
  the customer dashboard while relabeling.

## 6. Validation plan

- **Characterization tests:** lock current ledger debit = `official * multiplier` and lock that the
  dashboard read does not mutate any ledger row.
- **Contract tests:** dashboard response exposes both `officialUsageCost` and `payableDebit` as
  separate fields; the customer label maps to the payable concept.
- **Smoke checks:** GET dashboard for an Acme-like tenant returns list price `100.00` and debit
  `40.00` as distinct values; wallet balance delta equals `40.00`, not `100.00`.
- **Release checks:** confirm ALB weights unchanged by the label deploy; rollback = previous image.
- **Evidence to paste into final report:** `verify:submission` output, characterization-test run,
  and the before/after dashboard field shape.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| "Reduce the dashboard number to $40 so it matches the debit." | Rejected | That would corrupt official list-price usage reporting (Finance's source of truth). The two numbers are different concepts; both must remain visible. |
| "Update historical ledger entries so cost == debit." | Rejected | Ledger is immutable financial truth and the debits are already correct; rewriting history is a worse incident than a label. |
| "Promote Phase 1 canary to ship the label fix quickly." | Modified | Ship the label fix as an independent change on the stable base; do not piggyback on the unpromoted, still-observing Phase 1 canary (see release-command-log.md). |
| "Assume `balance` means wallet balance everywhere." | Corrected | `balance` is overloaded (wallet vs provider vs load-balancing weight); each defined in decision-log.md before touching anything. |
