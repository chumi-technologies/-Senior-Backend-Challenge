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

## 简短报告

当前状态：Phase 1 已经在 public canary，stable 99 / canary 1，canary 有真实流量，还没有 promoted。

我的判断：先 freeze Phase 1，不要继续放量，也不要直接覆盖现在的 public canary。

Phase 2 基线：紧急修复应该基于 stable image A，也就是 `registry.example.com/gateway:phase0-a17f3d2`。

原因：Phase 1 本身也改了 prepaid usage reporting labels 和 dashboard aggregation，还没验证完，不能把紧急修复叠在它上面。

发布顺序：先把 canary 流量切到 0，再部署 Phase 2 到 canary，smoke check 过了再小流量放出。

回滚目标：每一步都回到 stable image A，保持客户请求不中断。

验证重点：页面文案变清楚，但 ledger 语义不变；official usage 还是 `$100.00`，payable prepaid debit 还是 `$40.00`。

不要做：不要原地覆盖 1% public canary，不要改 ledger，不要新建第二套 billing truth。
