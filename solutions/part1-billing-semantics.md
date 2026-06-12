# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | Money remaining in Acme Team's prepaid wallet | prepaid wallet ledger (sum of debits/credits) | provider balance / load-balancing weight |
| provider balance | Our remaining spend/credit at the upstream model provider — company money, never customer-visible | provider billing console / settlement records | customer wallet |
| load balance | ALB traffic weight between stable and canary target groups — release plumbing | ALB listener rule config | money |
| official cost / total cost | List-price valuation of usage: `$100.00`. A reporting number for QBRs, finance exports, and provider reconciliation | metering store x official price table | actual payable debit |
| actual cost / payable cost | What was really deducted from the wallet: `$40.00 = $100.00 x 0.4` | ledger debit entries | official list price |
| raw usage event | One metered gateway call with list-price valuation, append-only | usage metering store | ledger entry |
| ledger entry | One append-only debit/credit against the customer wallet, written once by the billing engine | ledger store | dashboard aggregate |
| team prepaid multiplier | Contractual discount (0.4) applied exactly once, at debit time, by the billing engine | customer contract / billing engine config | provider discount |

## 2. Incident classification

Is this a wrong debit, wrong dashboard label, wrong aggregate, double billing bug, or something else?

**Classification: wrong dashboard label. The money paths are correct.**

Reasoning from the observed numbers:

- `$100.00 (official list-price usage) x 0.4 (team prepaid multiplier) = $40.00 (wallet debit)` — exact, to the cent.
- **Not a wrong debit / undercharge** (Finance's fear): an undercharge means `debit < official x multiplier`. Here the debit equals the contractual amount exactly. Revenue is correct.
- **Not double billing** (Engineering's fear): a duplicate billing path produces *extra* debits ($40+$40, or $40+$100). One debit of $40 was observed. A second path would also rarely land on the exact contractual product by accident.
- **Not a wrong aggregate**: $100.00 is the *correct* official aggregate. The defect is that it is presented under the label `Total usage cost`, which customers read as "amount deducted from my wallet".
- Sales' fear ("customer will think we are inconsistent") is the real incident: a **presentation/labeling defect** on the dashboard.

## 3. Source-of-truth map

```text
Gateway response (metered call)
  -> raw usage event, valued at list price            [metering store — SoT for official usage]
       -> dashboard aggregate "Total usage cost"      [derived READ MODEL — not a SoT, mislabeled today]
  -> billing engine: applies team prepaid multiplier 0.4 exactly once, at debit time
       -> ledger debit entry  $40.00                  [ledger — SoT for payable / actual cost]
            -> wallet balance (sum of ledger entries) [SoT for customer balance]

Unrelated namespaces reusing the same words (must stay untouched):
  provider account balance   — upstream settlement, company money
  load-balancing weight      — ALB stable/canary traffic split
```

- **Source of truth for customer balance:** the prepaid wallet ledger (sum of its append-only entries). Not the dashboard, not the metering store.
- **Source of truth for official usage reporting:** raw usage events at list price in the metering store. Not the ledger, not the dashboard cache.

## 4. Fix plan

- Layer to change: **presentation / dashboard read model only.** Relabel the official aggregate (e.g. `Official usage (list price): $100.00`) and add a second line, read from ledger data, `Prepaid debit (x0.4): $40.00`. The dashboard performs no arithmetic of its own — payable is read from the ledger, never recomputed (a read-time `official x multiplier` would be a second billing source of truth, banned by the ticket).
- Layers explicitly not changed: ledger writes and semantics; raw usage events; multiplier application point (stays in the billing engine, applied once at debit time); provider balances/credentials; load-balancing weights; Phase 1 canary image.
- Historical data treatment: **no rewrite.** Ledger history is an append-only audit record needed for reconciliation; old entries are already correct in meaning. Only the label changes going forward. Support is briefed that old screenshots show the old label.
- Idempotency risk: none added — the fix introduces no new writes. The existing invariant to protect: retrying the same usage event must produce exactly one ledger debit (covered in verification).
- Customer-facing wording risk: the new label exposes the customer's own contract multiplier (0.4) — acceptable, it is their contract. It must not leak provider settlement pricing or internal routing/account metadata.

## 5. Verification evidence

> Honest scope note: this repository contains no billing implementation (no metering store, ledger, or dashboard code), so billing checks cannot be executed here and inventing command output is prohibited (`solutions/release-command-log.md` header). Below is (a) the evidence available from the incident data itself and (b) the exact contract checks that gate the deploy. The runnable evidence this repo does support — characterization/regression tests and `verify:submission` — is captured in `solutions/test-evidence.md`.

- official list-price usage is preserved: dashboard official aggregate before vs after deploy equals `$100.00` for the incident window; metering store row counts/values unchanged (read-only deploy on metering path).
- payable prepaid debit is preserved: wallet history for Acme shows exactly one `$40.00` debit before and after; ledger store row count and checksum identical pre/post deploy (no new writes).
- provider balance is not touched: provider settlement records diff is empty across the deploy window; no code path in the change writes to provider accounts.
- load-balancing weight is not touched by the billing fix itself: ALB listener weights only change via the controlled release sequence in `solutions/release-command-log.md`, never by application code.
- retry does not double debit: replaying the same usage-event id through the billing engine yields one ledger entry (idempotency key = usage-event id); duplicate replay returns the existing entry. Invariant test: `ledger_debit == official_usage x contract_multiplier` and `count(debits per usage-event id) == 1`.
- arithmetic evidence from the incident data: `100.00 x 0.4 = 40.00` — the observed pair (dashboard $100, debit $40) is exactly the correct-behavior signature, not an anomaly signature.
