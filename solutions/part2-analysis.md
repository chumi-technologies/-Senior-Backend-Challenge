# Part 2: 客服工单 #4521 — 系统认知报告

> ⚡ 请在动手写任何代码之前完成此报告。报告质量占总评分的 40%。

## 1. 数据生命周期图

请画出一个 `AnalysisJob` 从 API 请求到最终状态的 **完整时序图**。

要求：
- 标注每一步操作的发起方（LegacyApp / WorkerService）
- 标注每一步对 MongoDB 的读写操作
- 标注时间窗口（毫秒级）
- 如果有多个服务对同一条记录做了操作，请标注它们的先后顺序和可能的交叉

```
时序图：

```

## 2. 字段语义分析

请解释以下字段在业务场景中的含义：

| 字段 | 你的理解 |
|------|---------|
| `status: PENDING / PROCESSING / COMPLETED` | |
| `demographics.confidence` | |
| `demographics.gender` | |
| `demographics.ageRange` | |
| 工单中 `confidence: 0.85` → `confidence: 0.3` 意味着什么？ | |

## 3. 根因假设

在你还没开始修改任何代码之前，基于以上分析，你认为问题的根因是什么？

```
你的假设：

```

## 4. 修复方案

### 设计原则

<!-- 你基于什么原则来设计修复？ -->

### 具体修改

#### LegacyApp 修改

<!-- 你对 LegacyApp 做了什么修改？为什么？ -->

#### WorkerService 修改

<!-- 你对 WorkerService 做了什么修改？为什么？ -->

## 5. 验收结果

```bash
# 请粘贴你的 TDD 测试输出（先红后绿）
```
