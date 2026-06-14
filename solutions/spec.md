# 紧急计费展示修复规范

> 这一步先把话说清楚，不急着改代码。现在最怕的是把账本、报表、页面展示混成一件事，然后为了赶时间把线上 canary 也一起弄乱。

## 1. 当前情况

Acme 页面上看到的是 `Total usage cost: $100.00`，但他们的 prepaid wallet 实际只扣了 `$40.00`。他们的 prepaid multiplier 是 `0.4`。

这个数字先别急着判错，因为 `$100.00 * 0.4 = $40.00` 正好对上。我的第一反应是：钱包扣款可能没错，问题更像是 dashboard 上的文案让客户误会了。客户看到 `Total usage cost`，很容易理解成“我实际花了多少钱”，但系统里它可能只是官方标价口径。

当前还有一个发布风险：Phase 1 已经在 public canary 上了，流量是 stable 99%、canary 1%。这个 canary 已经有真实用户流量，不能当成没人用的测试环境直接覆盖。

## 2. 数据以谁为准，source-of-truth

我先按这个口径理解数据链路：

```text
原始用量事件
  -> 官方标价用量成本，比如 $100.00
  -> 客户 prepaid multiplier，比如 0.4
  -> 钱包账本扣款，比如 $40.00
  -> dashboard 展示给客户看的文案
```

| 概念 | 以谁为准 | 简单解释 |
|---|---|---|
| 客户钱包余额 | ledger entries | 钱包余额看账本，不看 dashboard 聚合 |
| 官方用量成本 | raw usage 和 official price | 财务、官方报表里的 `$100.00` |
| 客户实际扣款 | ledger debit | prepaid wallet 里真正扣掉的 `$40.00` |
| provider balance | provider account system | 上游供应商余额，别和客户钱包混了 |
| load-balancing weight | release / ALB config | 流量权重，跟钱没关系 |

## 3. 术语先说清楚

- `balance` 不能裸用。要说清楚是客户钱包余额、供应商余额，还是流量权重。
- `usage` 也不能混着说。原始用量、账本记录、dashboard 聚合是三件事。
- `cost` 至少有三种意思：官方标价、客户实际扣款、供应商结算成本。
- `prepaid` 在这个问题里指客户的 `0.4` 折扣系数，不是供应商折扣。
- `stable` 这里指线上稳定镜像，不是 Git 分支。
- `canary` 这里指已经有真实流量的 public canary，不是私下测试环境。

## 4. 初步判断

我现在不认为应该先改账本，也不认为应该先改官方报表。

更像是这个问题：

- `$100.00` 是官方用量成本。
- `$40.00` 是经过 prepaid multiplier 后的客户实际扣款。
- dashboard 用 `Total usage cost` 这个名字展示 `$100.00`，客户自然会觉得“为什么你说总成本 100，但只扣了 40？”

还要继续排查的可能性：

- 有没有重复计费路径。
- dashboard 是不是把官方成本和实际扣款混在一起算了。
- ledger 有没有真的写错。

但在这些被证明之前，不能为了让两个数字看起来一样就去改钱。这个坑很危险。

## 5. 这次先不做什么，non-goals

- 不改历史 ledger。
- 不把官方用量 `$100.00` 硬改成 `$40.00`。
- 不把客户实际扣款 `$40.00` 硬改成 `$100.00`。
- 不碰 provider balance、provider key、routing、fallback、ALB 权重。
- 不为了 dashboard 单独造一套新的 billing truth。
- 不在 release safety review 前覆盖 public canary。
- 不重写系统。

## 6. 影响范围，blast radius

这个修复应该尽量只碰客户 dashboard 的展示口径。

账本默认不动。只要后面证明 `$40.00` 是正确的 prepaid debit，就保留它。财务官方报表里的 `$100.00` 也要保留，因为那是另一个口径。

不应该影响 provider、routing、fallback、load balancing。发布上最大的风险是 public canary 已经有 1% 真实流量，所以 Phase 2 紧急修复不能直接覆盖它。

还有一个小风险是泄漏内部信息。客户页面不能暴露 provider 账号、内部价格表、release 镜像、canary 状态这些东西。

## 7. 后面怎么验证，validation plan

后面要证明几件事：

- 官方用量成本还是 `$100.00`。
- 客户钱包扣款还是 `$40.00`。
- dashboard 文案能让客户看懂：哪个是官方用量，哪个是实际扣款。
- 重试不会重复扣款。
- provider balance 没被碰。
- load-balancing weight 没被碰。
- 发布前后 health check 正常。

如果最后需要改代码，先补能锁住旧行为的测试，再做小改。不要一上来就重构。

## 8. 发布安全计划

发布这块先按保守方案来，不抢那几分钟：

- 先把当前 stable image、canary image、traffic weight、rollback target 写进 `solutions/release-command-log.md`。
- Phase 1 先冻结，必要时先把 canary 流量切回 0。
- 紧急 Phase 2 优先基于 stable image A 做，不要默认叠在还没 promoted 的 Phase 1 上。
- 当前 public canary 有 1% 真实流量，不能直接覆盖。
- 如果要复用 canary，先确认流量已经切走。
- 先 smoke test，再慢慢放量。
- 每一步都要有 rollback target，默认回到 stable image A。

## 9. AI 建议和人工纠正，ai recommendation

| AI 建议 | 处理 | 原因 |
|---|---|---|
| 直接把 ledger 的 `$40.00` 改成 `$100.00` | 拒绝 | `0.4` multiplier 正好能解释 `$40.00`，先改账本风险太大 |
| 把官方用量 `$100.00` 改成 `$40.00` | 拒绝 | 官方用量和客户实际扣款不是一个口径 |
| 先按 dashboard 展示/文案问题处理 | 暂时接受 | 目前最符合数字，但还要用测试和记录证明 |
| 为了赶时间直接覆盖 public canary | 拒绝 | canary 已经有真实流量 |
| 先写 spec，再动代码 | 接受 | README 要求这样做，用户也明确要求先完成 `solutions/spec.md` |

人工纠正：

暂时无
