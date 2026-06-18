# Decision Log

> 先定语义，再改 billing、usage、routing、release 相关东西。

## Business glossary

| Term | Meaning in this task | Source of truth | Must not be confused with |
|---|---|---|---|
| balance | 这里要说清楚是哪种余额 | customer ledger / provider system / ALB config | provider account balance / load-balancing weight / customer wallet |
| account | 这里分客户账号、供应商账号、上游凭证 | 对应业务系统 | customer account / provider account / upstream credential |
| usage | 原始用量、账本记录、dashboard 聚合不是一回事 | raw usage event / ledger / dashboard query | raw usage event / ledger entry / dashboard aggregate |
| total cost | 这里更像 official list-price usage | raw usage + official price | customer payable amount |
| actual cost | 客户语境下指实际扣款 | ledger debit | provider settlement amount |
| prepaid | 客户 prepaid multiplier `0.4` | customer contract / billing config | provider discount |
| stable | 当前线上稳定镜像 | rollout state | Git branch / stable API contract |
| canary | 已有真实流量的 public canary | rollout state | private shadow canary |

## Decision entries

### 2026-06-14 11:59 — Billing display semantics

- Context: Acme 看到 `$100.00`，prepaid wallet 实际扣 `$40.00`。
- Decision: 先判断为 dashboard label / aggregate 语义问题，不先改 ledger。
- Source of truth: 客户余额看 ledger，官方用量看 raw usage + official price。
- Alternatives rejected: 不把 `$40.00` 改成 `$100.00`，也不把 `$100.00` 改成 `$40.00`。
- Risk: 如果 dashboard 继续只写 `Total usage cost`，客户会以为这是实际扣款。
- Verification: 检查 official usage、ledger debit、provider balance、load-balancing weight 都保持各自口径。
