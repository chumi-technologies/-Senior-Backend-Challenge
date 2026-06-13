# Spec — High Availability Urgent Change

> Initialized from the Part 1 billing incident. Release-command details are handled separately in the Part 2 files.

## 1. Current-state understanding

- Customer-facing symptom: Acme sees `Total usage cost: $100.00`; prepaid wallet debit is `$40.00`.
- Affected surface: customer dashboard / prepaid wallet cost display.
- Current release state: no release action for this Part 1 analysis.
- Known facts: prepaid multiplier is `0.4`; `$100.00 * 0.4 = $40.00`; no evidence yet of duplicate debit, provider-balance change, or routing change.

Current interpretation:

```text
official list-price usage = $100.00
prepaid multiplier = 0.4
wallet debit = $40.00
```

## 2. Source-of-truth map

```text
Raw usage event
  -> official rate card
  -> official usage reporting: $100.00

Customer package multiplier
  -> payable debit calculation
  -> wallet ledger debit: $40.00

Dashboard
  -> derived read model
  -> must label each value by meaning
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | Wallet ledger | Wallet projection | Ledger credit/debit writer | Provider balance / load-balancing weight |
| official usage cost | Raw usage plus official rate card | Usage reporting aggregate | Metering/rating pipeline | Payable debit |
| payable prepaid debit | Wallet ledger debit | Wallet ledger/projection | Billing debit writer | Official list price |
| prepaid multiplier | Customer package config | Package lookup | Contract/package system | Provider discount |
| dashboard aggregate | Derived projection | Dashboard API | Projection rebuild | Ledger/source event |
| release stable | Promoted deployment when release work is in scope | Rollout state | Release command | Git branch named stable |
| canary | Candidate deployment receiving traffic | Rollout state | Release command | Private shadow canary |

## 3. Root-cause hypotheses before code

1. Most likely: ambiguous dashboard wording. `Total usage cost` shows list-price usage where the customer expects wallet debit.
2. Possible: dashboard aggregate reads the wrong semantic field for the prepaid-wallet panel.
3. Less likely from current evidence: wrong debit, wrong official aggregate, or double billing.

## 4. Non-goals

- Do not rewrite historical ledger entries.
- Do not change official usage reporting from `$100.00` to `$40.00`.
- Do not change wallet debit from `$40.00` to `$100.00`.
- Do not apply the prepaid multiplier to raw usage events.
- Do not create another billing source of truth.
- Do not touch provider balances, credentials, settlement, or routing weights.

## 5. Blast radius

- Affected endpoints: production dashboard/read-model endpoints, not present in this repo.
- Affected display: prepaid wallet / usage-cost copy and field mapping.
- Ledger behavior: should not change.
- Provider/routing behavior: should not change.
- Release state: no action for Part 1.
- Metadata risk: do not expose provider settlement or credential details in customer-facing copy.

## 6. Validation plan

- Characterization: Acme sample remains `$100.00` official usage, `0.4` multiplier, `$40.00` wallet debit.
- Contract checks: wallet balance changes by `$40.00`; official reporting remains `$100.00`; retry does not double debit.
- Smoke checks: dashboard labels `$40.00` as wallet debit and `$100.00`, if shown, as official list-price usage.
- Release checks: before any release, Part 2 must record images, traffic weights, public-canary state, and rollback target.
- Evidence: source inspection plus Part 1 semantic decision log.

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| AI stated that `$100.00` is likely official usage, `$40.00` is likely wallet debit, and the issue is likely dashboard wording. | Accepted | Human reviewed this interpretation and agreed. |
| AI noted that changing the ledger, official reporting, or adding a second billing path would be unsafe. | Accepted | Human agreed to preserve billing semantics and focus on display semantics. |
