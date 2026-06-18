# Scale Plan Under Constraints

## 1. Throughput target

- Rows: 约 5,000,000。
- Deadline: 2 小时。
- Current throughput: 约 10 rows/s。
- Required throughput: 约 700 rows/s，实际要按 1,000 rows/s 设计。
- Safety factor: 留 30% 左右 buffer。

## 2. Smallest architecture change

```text
S3 upload -> split CSV into chunks -> queue chunk jobs -> run more workers -> merge reports
```

方向：不重写 worker，先把单个大文件拆成很多 chunk 并行跑。

## 3. Work partitioning and idempotency

- Shard key: fileId + chunkIndex。
- Job identity: uploadId + chunkIndex。
- Idempotency key: uploadId + rowRange。
- Retry policy: chunk 级别重试，别整文件重跑。
- Dead-letter policy: 失败 chunk 进 DLQ，保留样本和错误原因。

## 4. Concurrency and backpressure

- Worker count: 先水平加 worker，不改语言。
- Per-provider concurrency cap: 每个 provider 设置固定上限，避免打爆上游。
- Queue visibility / lease: chunk 处理期间续租，超时自动重试。
- Rate-limit handling: 429 就退避，别继续硬打。

## 5. Debuggability without alert floods

- Error sampling: 每类错误只存少量代表样本。
- Failure buckets: 按 validation、provider、timeout、unknown 分桶。
- Representative payload capture: 只保存脱敏后的失败行。
- Alert thresholds: 按失败率告警，不按每一行告警。
- Operator dashboard: 看进度、失败 chunk、剩余时间。

## 6. What not to rebuild in two weeks

- 不重写 Rust。我觉得应该换一种更效率的语言？

## 7. Degrade / rollback plan

- If behind schedule: 先出 partial report，标清楚未完成 chunk。
- If provider is degraded: 降低并发，暂停低优先级 chunk。
- If bad data rate spikes: 跳过坏行进失败文件，不阻塞整批。
- If billing/usage confidence is low: 停止自动扣费，保留 usage evidence 人工复核。
