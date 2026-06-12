# Part 2 — Interrupted Rollout Plan

## 1. Current state evidence

| Field | Observed value | Evidence source |
|---|---|---|
| stable image | | |
| canary image | | |
| stable traffic weight | | |
| canary traffic weight | | |
| canary has public traffic? | | |
| Phase 1 promoted? | | |

## 2. Phase 1 freeze decision

- Decision:
- Reason:
- What must not happen next:

## 3. Phase 2 base decision

Should the urgent patch be based on stable image A or Phase 1 canary image B?

- Decision:
- Dependency evidence:
- Rollback target:

## 4. High-availability sequence

```text
1. 
2. 
3. 
```

## 5. Customer-invisibility proof

- API availability check:
- Dashboard/customer-facing check:
- Billing semantic check:
- Ledger idempotency check:
- Provider/internal metadata leakage check:

## 6. Final state

- Stable image:
- Canary image:
- ALB weights:
- Remaining Phase 1 disposition:
- Remaining risks:
