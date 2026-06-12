# Part 3: 生产事故 — 数据质量分析报告

> 本报告先基于原始代码和 `debug-payloads/chaos-data-samples.json` 建立数据质量判断标准，再将标准编码为 runtime validation。

## 1. 逐条数据审查

本次不采用简单的“合法 / 不合法”二分，而是分为 4 类：

| 分类 | 含义 | 处理方式 |
|------|------|----------|
| Valid | 字段类型和值域都符合内部模型 | 直接处理 |
| Normalized | 第三方格式不一致，但语义明确，可无损转换 | 转换后处理 |
| Degraded | 核心画像可用，但辅助字段不可可靠转换 | 保留核心画像，记录 warning |
| Rejected | 核心字段缺失、无法解析或业务值域不可能 | 跳过，写入 `failed-records/` |

| 记录 ID | 分类 | 问题字段 | 实际值 | 判断依据 |
|---------|------|----------|--------|----------|
| record-001 | Valid | 无 | 标准格式 | age/gender/country/tags/engagementScore/email 都符合预期。 |
| record-002 | Degraded | `age`, `tags`, `engagementScore` | `"25+"`, `"tech,gaming,esports"`, `"0.72"` | tags/score 可无损转换，但 `25+` 是开放年龄段，只能映射到 lower-bound canonical bucket `25-34`，有信息损失。 |
| record-003 | Rejected | `age`, `email` | `null`, `"invalid-email"` | age 是核心画像字段，不能缺失；email 格式也不可用。 |
| record-004 | Rejected | `gender`, `tags`, `engagementScore` | missing, `[]`, `null` | gender 是核心画像字段，缺失后无法用于受众性别画像；tags/score 也不可用。 |
| record-005 | Rejected | `age` | `"thirty"` | age 语义不可可靠解析，不能猜测为某个年龄段；`non-binary` 本身允许。 |
| record-006 | Valid | 无 | 标准格式 | 字段完整且值域合理。 |
| record-007 | Rejected | `age`, `engagementScore` | `-5`, `1.5` | age 不能为负数；engagementScore 定义为 0~1，1.5 超出合法范围。 |
| record-008 | Rejected | `age` | missing | age 是核心受众画像字段，缺失后无法生成可信年龄段。 |
| record-009 | Rejected | `gender`, `country`, `tags`, `engagementScore`, `email` | 多字段 `null` | 画像核心字段和辅助字段大量缺失，不能安全进入分析流程。 |
| record-010 | Valid | 无 | 标准格式 | 字段完整且值域合理。 |
| record-011 | Valid | 无 | 标准格式 | 字段完整且值域合理。 |
| record-012 | Degraded | `engagementScore` | `"high"` | age/gender/country/tags/email 都可用；`"high"` 是定性描述，不能伪造为 0~1 数字，因此保留画像但丢弃 score。 |

最终预期：

```text
Processed: 6 = Valid 4 + Normalized 0 + Degraded 2
Skipped: 6 = Rejected 6
```

## 2. 字段语义理解

| 字段 | 业务含义 | 合法值域 |
|------|----------|----------|
| `age` | 受众年龄画像，用于映射到 canonical `ageRange`。这是核心 demographics 字段。 | number: 0~120；string 必须最终映射到 `under-18`, `18-24`, `25-34`, `35-44`, `45-54`, `55+`。`"25+"` 这类开放区间可按 lower-bound bucket 降级处理；`null`、缺失、负数、`"thirty"` 不合法。 |
| `gender` | 受众性别画像，不是用户本人性别。核心 demographics 字段。 | `male`, `female`, `other`, `non-binary`。空值或未知字符串不合法。 |
| `country` / `city` | 地理画像。`country` 是核心字段，`city` 是补充字段。 | `country` 必须是非空字符串；`city` 可缺失。 |
| `tags` | 兴趣标签，用于分析受众兴趣和营销匹配。 | string[]；逗号分隔字符串可 normalize。空数组/null 不是核心 reject 条件，但会作为 warning。 |
| `engagementScore` | 互动质量或活跃度分数，辅助排序/质量评估。 | number 0~1；数字字符串可 normalize。`"high"` 这类定性描述只做 degraded warning，不映射成假精度。 |
| `email` | 联系/归因字段，用于关联来源或后续通知。 | 合法 email 字符串。无效或缺失时 reject。 |

## 3. 校验方案

### 使用的工具/库

使用 Zod 作为第三方 JSON 进入系统的 runtime schema boundary。

分层策略：

1. Zod 校验原始结构：确认记录是我们认识的第三方响应形态，例如 `age` 可以是 number/string/null，`tags` 可以是 string[]/string/null。
2. 自定义业务规则做 normalize/validate：因为字段是否合法不只是类型问题，还取决于 influencer marketing 场景下的语义。

这样可以避免继续依赖 TypeScript 的 `as number` / `as string[]`，因为这些断言在运行时不会转换或校验第三方数据。

这套策略不仅用于 `scripts/process-chaos.ts` 的批处理样本，也接入了真实 Worker 路径：

- `AnalysisProcessor.transformApiResponse` 使用 Zod 校验第三方响应结构。
- `age`, `tags`, `score` 在 Worker 中做 runtime normalization。
- `age` 有损映射、空 `tags`、缺失/非数字/越界 `score` 都会进入 `analysis_response_degraded` warning。
- 核心字段不合法时抛出带 `ValidationIssue[]` 的错误。
- `process()` catch 分支输出包含 `jobId` 和 `traceId` 的结构化日志，将 job 标记为 `FAILED`。
- 真实 Worker 失败路径会写入 `failed-records/worker-{jobId}-{timestamp}.json`，保存原始队列 event、第三方响应和失败原因。

### Schema 定义

核心 Zod schema：

```typescript
const RawChaosRecordSchema = z.object({
    id: z.string(),
    age: z.union([z.number(), z.string()]).nullable().optional(),
    gender: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    tags: z.union([z.array(z.string()), z.string()]).nullable().optional(),
    engagementScore: z.union([z.number(), z.string()]).nullable().optional(),
    email: z.string().nullable().optional(),
});

// The script validates each record with RawChaosRecordSchema.safeParse(...)
// so one malformed row cannot abort the whole batch.
```

业务层返回分类：

```typescript
type Classification = 'valid' | 'normalized' | 'degraded' | 'rejected';
```

处理规则：

- `valid`: 无需转换，无 warning。
- `normalized`: 无损格式转换，如 tags string -> string[]，score string -> number。
- `degraded`: 核心画像完整，但存在有损转换或辅助字段不可用，如 `age: "25+"` 映射到 `25-34`，或 `engagementScore: "high"`。
- `rejected`: 核心画像缺失或业务值域不可能。

### 错误处理策略

不让单条坏数据 crash 整个 batch。

- `Processed` 记录继续进入后续处理。
- `Rejected` 记录跳过，写入 `failed-records/batch-*.json`。
- failed record 包含 `id`, `classification`, `reasons`, `raw`。
- 对于 degraded 数据，不伪造精度。例如 `"high"` 不映射为 `0.8`，而是将 `engagementScore`/Worker `score` 置为 undefined 并记录 warning；`"25+"` 映射到 lower-bound canonical bucket 时也记录 warning。
- 对于 batch 文件，逐条执行 Zod `safeParse`。单条 record 结构异常会进入 failed records，不会让整个 batch 提前中止。只有根 JSON 不是数组这类文件级错误才会终止。
- 对于真实 Worker，失败记录按 job 维度写入 `failed-records/worker-*.json`，写入失败本身只记录日志，不阻断 job 标记为 `FAILED`。

## 4. 日志改进

Before:

```typescript
console.log('Error happened');
```

After:

```typescript
function logEvent(level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown>): void {
    console.log(JSON.stringify({
        level,
        event,
        timestamp: new Date().toISOString(),
        ...context,
    }));
}
```

示例：

```json
{
  "level": "warn",
  "event": "chaos_record_validation_failed",
  "timestamp": "2026-06-12T18:15:47.634Z",
  "recordId": "record-007",
  "reasons": [
    {
      "field": "age",
      "value": -5,
      "reason": "age must be an integer between 0 and 120"
    },
    {
      "field": "engagementScore",
      "value": 1.5,
      "reason": "engagementScore must be between 0 and 1"
    }
  ]
}
```

真实 Worker 失败日志示例：

```json
{
  "level": "error",
  "event": "analysis_job_failed",
  "timestamp": "2026-06-12T18:31:41.256Z",
  "jobId": "worker-dlq-test",
  "traceId": "trace-dlq-test",
  "errorName": "ThirdPartyValidationError",
  "message": "Third-party API response failed validation",
  "validationIssues": [
    {
      "field": "age",
      "value": null,
      "reason": "age is required and must be numeric or a parseable age range"
    }
  ]
}
```

## 5. 验收结果

命令：

```bash
pnpm run process:chaos
```

输出：

```text
{"level":"info","event":"chaos_record_processed","recordId":"record-001","classification":"valid","warningCount":0}
{"level":"info","event":"chaos_record_processed","recordId":"record-002","classification":"degraded","warningCount":1}
{"level":"warn","event":"chaos_record_validation_failed","recordId":"record-003","reasons":[...]}
{"level":"warn","event":"chaos_record_validation_failed","recordId":"record-004","reasons":[...]}
{"level":"warn","event":"chaos_record_validation_failed","recordId":"record-005","reasons":[...]}
{"level":"info","event":"chaos_record_processed","recordId":"record-006","classification":"valid","warningCount":0}
{"level":"warn","event":"chaos_record_validation_failed","recordId":"record-007","reasons":[...]}
{"level":"warn","event":"chaos_record_validation_failed","recordId":"record-008","reasons":[...]}
{"level":"warn","event":"chaos_record_validation_failed","recordId":"record-009","reasons":[...]}
{"level":"info","event":"chaos_record_processed","recordId":"record-010","classification":"valid","warningCount":0}
{"level":"info","event":"chaos_record_processed","recordId":"record-011","classification":"valid","warningCount":0}
{"level":"info","event":"chaos_record_processed","recordId":"record-012","classification":"degraded","warningCount":1}
✅ Processed: 6 records
   Valid: 4
   Normalized: 0
   Degraded: 2
⚠️ Skipped (validation failed): 6 records
📁 Failed records saved to: failed-records/batch-20260612-182718154Z.json
```

`failed-records/batch-*.json` 中保存了 6 条 rejected 原始记录和失败原因。

额外验证：

- 使用临时 malformed batch 验证单条坏 shape 不会中止整个 batch：`Processed: 1`, `Skipped: 1`。
- 使用临时 `age: "999+"` 样本验证字符串年龄边界会被拒绝。
- 使用临时 Worker bad response 验证真实 Worker 会输出带 `traceId` 的结构化失败日志，并生成 `failed-records/worker-*.json`。

## 6. 已识别但暂不实现的风险

- `AnalysisRequestedEvent.dataUrl` 可能非常大。当前 Worker 失败路径会把原始 queue event 写入 `failed-records/worker-*.json`，因此超大的 `dataUrl` 可能导致 failed-record 文件膨胀，也可能在未来接入集中式日志时造成日志成本或 PII 暴露风险。
- 本次修复先不处理这个问题，因为 Part 3 的核心目标是第三方响应校验、分类、结构化日志和 dead-letter 记录。生产化方案可以在后续加入 payload redaction/truncation，例如只保存 `dataUrl` 的长度、hash、scheme/host，或将大 payload 存到对象存储后在 failed record 中记录引用。
