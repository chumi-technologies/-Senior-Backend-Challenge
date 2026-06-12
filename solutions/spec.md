# Spec — High Availability Urgent Change

> Complete this before modifying code.

## 1. Current-state understanding

- Customer-facing symptom:
- Affected customer / surface:
- Current release state:
- Known constraints:

## 2. Source-of-truth map

```text
Request / usage event
  -> ...
```

| Concept | Source of truth | Read path | Write path | Must not be confused with |
|---|---|---|---|---|
| customer wallet balance | | | | provider balance / load-balancing weight |
| official usage cost | | | | payable debit |
| payable prepaid debit | | | | official list price |
| release stable | | | | Git branch named stable |
| canary | | | | private shadow canary vs public canary |

## 3. Root-cause hypotheses before code

1. 
2. 
3. 

## 4. Non-goals

- 
- 
- 

## 5. Blast radius

- Affected endpoints:
- Affected customer-facing display:
- Affected billing / ledger behavior:
- Affected provider / routing behavior:
- Affected release state:
- Metadata leakage risk:

## 6. Validation plan

- Characterization tests:
- Contract tests:
- Smoke checks:
- Release checks:
- Evidence to paste into final report:

## 7. AI recommendation review

| AI suggestion | Accepted / rejected / modified | Human reasoning |
|---|---|---|
| | | |
