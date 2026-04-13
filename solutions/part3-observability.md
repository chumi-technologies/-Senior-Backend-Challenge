# Part 3: 生产事故 — 数据质量分析报告

> ⚡ 请在动手写任何代码之前完成此报告。

## 1. 逐条数据审查

审查 `debug-payloads/chaos-data-samples.json` 中的每条记录。

对每条记录，判断其在 **influencer marketing 受众分析** 场景下是否合法，并说明判断依据。

| 记录 ID | 合法？ | 问题字段 | 实际值 | 为什么不合法（业务理由） |
|---------|--------|----------|--------|------------------------|
| record-001 | | | | |
| record-002 | | | | |
| record-003 | | | | |
| record-004 | | | | |
| record-005 | | | | |
| record-006 | | | | |
| record-007 | | | | |
| record-008 | | | | |
| record-009 | | | | |
| record-010 | | | | |
| record-011 | | | | |
| record-012 | | | | |

## 2. 字段语义理解

请解释以下字段在 influencer marketing 数据场景中的业务含义和合法值域：

| 字段 | 业务含义 | 合法值域 |
|------|---------|---------|
| `age` | | |
| `gender` | | |
| `country` / `city` | | |
| `tags` | | |
| `engagementScore` | | |
| `email` | | |

## 3. 你的校验方案

### 使用的工具/库

<!-- 你选择了什么方案？为什么？ -->

### Schema 定义

```typescript
// 请粘贴你的校验 Schema
```

### 错误处理策略

<!-- 不合法的数据如何处理？彻底丢弃？部分保留？ -->

## 4. 日志改进

```typescript
// Before:
console.log('Error happened');

// After:
// 请展示你改进后的结构化日志方案
```

## 5. 验收结果

```bash
# 请粘贴 pnpm run process:chaos 的输出
```
