# Release Command Log

> Required for the interrupted rollout challenge. Record observed state, decision points, commands, evidence, and rollback target. Do not invent command output.

## Current rollout snapshot

| Field | Value | Evidence |
|---|---|---|
| stable image | | |
| canary image | | |
| stable traffic weight | | |
| canary traffic weight | | |
| canary has public traffic? | | |
| rollback target | | |

## Timeline

| Time | Action | Evidence | Customer impact risk |
|---|---|---|---|
| | | | |

## Final state

- Stable image:
- Canary image:
- ALB weights:
- Canary desired count:
- Tests / smoke checks:
- Rollback target:
- Remaining risks:

## 2026-06-14 12:16 — 观察和决策记录

- stable image: `registry.example.com/gateway:phase0-a17f3d2`
- canary image: `registry.example.com/gateway:phase1-b93c1a8`
- traffic weight: stable 99 / canary 1
- canary public traffic: yes
- rollback target: stable image A
- 当前动作：先 freeze Phase 1，不继续放量。
- 不安全动作：不要直接覆盖 public canary，因为它已经有真实用户流量。
- Phase 2 基线：用 stable image A 做紧急修复，不叠加未 promoted 的 Phase 1。
- 安全理由：先把 canary 流量切到 0，再部署和 smoke test，可以保留清楚的 rollback target。
- smoke checks: health ok；dashboard 区分 official usage 和 payable debit；ledger debit 不变；provider balance 和 ALB weight 不被业务修复改动。
