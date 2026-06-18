# Scale Plan Under Constraints

## 1. Throughput target

- **Rows**: 10 million CSV rows per batch job (per challenge scale requirement)
- **Deadline**: Complete within 2-hour SLA window per batch
- **Current throughput**: ~1 row/second per Worker instance (500ms–1500ms API latency per row, single-threaded queue poller)
- **Required throughput**: ~1,400 rows/second sustained (10M rows ÷ 7,200 seconds)
- **Safety factor**: 2× — target 2,800 rows/second to handle API rate-limit retries and backpressure

## 2. Smallest architecture change

```text
S3 upload (CSV file: 10M rows)
  -> S3 Event Notification triggers SQS message with bucket/key reference
  -> Partitioner Lambda reads CSV header, splits into N shards of ~50K rows each
     (N = 200 shards; shard key = row range [offset, limit])
  -> Each shard creates a SQS batch-job message with: jobId, s3Key, shardIndex, rowOffset, rowCount
  -> Worker pool (auto-scaled ECS Fargate tasks) polls SQS batch-job queue
     Each Worker processes one shard: streams CSV rows from S3, calls third-party API per row
  -> Worker writes results to MongoDB in bulk (bulkWrite, 100 rows per write)
  -> DLQ captures failed shards for operator review
  -> Aggregator: when all shards for a jobId complete, mark top-level job COMPLETED in MongoDB
```

Key: no single Worker processes the full 10M rows. Each Worker processes 50K rows (~35 seconds at 1,400 rows/second with 10× concurrency per worker).

## 3. Work partitioning and idempotency

- **Shard key**: `(jobId, shardIndex)` — composite key unique per shard. `shardIndex = rowOffset / shardSize`. Deterministic: same CSV always produces same shards.
- **Job identity**: `jobId` = UUID generated at upload time; `shardId` = `${jobId}#${shardIndex}` stored in MongoDB shard-status collection.
- **Idempotency key**: Each SQS message carries `shardId`. Worker checks if shard is already `COMPLETED` in MongoDB before processing. If `COMPLETED`, returns immediately (SQS message deleted). Prevents double-processing on SQS redelivery.
- **Retry policy**: SQS visibility timeout = 120 seconds (2× expected shard processing time). Max receive count = 3 before DLQ. Exponential backoff on third-party API calls: 1s, 2s, 4s with jitter.
- **Dead-letter policy**: Failed shards after 3 attempts → DLQ. Operator can re-enqueue individual shards from DLQ without reprocessing successful shards. Failed shards do not block other shards in the same job.

## 4. Concurrency and backpressure

- **Worker count**: 20 ECS Fargate tasks (auto-scaled; min 5, max 50 based on SQS queue depth metric).
- **Per-provider concurrency cap**: Each Worker maintains a semaphore of 10 concurrent third-party API calls. Total max = 200 concurrent API calls across all workers. Set below provider rate limit (300 req/s for this provider).
- **Queue visibility / lease**: SQS visibility timeout = 120 seconds per shard message. Workers heartbeat (extend visibility) every 30 seconds for long-running shards. If Worker dies, message reappears in queue after timeout for another Worker to claim.
- **Rate-limit handling**: If provider returns 429 (rate limit), Worker pauses all new API calls for that provider for 10 seconds (circuit-breaker pattern). Shard processing continues but API calls are queued locally. After pause, resumes at 50% of normal concurrency rate. If 429 persists for >60 seconds, shard fails to DLQ with `RATE_LIMITED` error code.

## 5. Debuggability without alert floods

- **Error sampling**: Capture 1 in 100 failed row payloads to S3 `debug-payloads/` prefix (existing pattern in repo). Never capture PII fields (strip before sampling). Log row offset + error code for all failures.
- **Failure buckets**: Categorize errors at DLQ ingestion time: `API_TIMEOUT` / `RATE_LIMITED` / `INVALID_RESPONSE` / `TRANSFORM_ERROR` / `DB_WRITE_FAIL`. Separate CloudWatch metrics per bucket. Alert only on sustained failure rates (>5% error rate over 5 minutes per bucket), not individual errors.
- **Representative payload capture**: Each failed shard writes a summary to MongoDB shard-status: `{ shardId, errorCode, sampleRowOffset, errorMessage, failedAt }`. Operators can retrieve representative failed rows without scanning all 10M rows.
- **Alert thresholds**: 
  - `WARN`: Shard failure rate > 1% (investigate)
  - `CRIT`: Shard failure rate > 5% over 5 min (page on-call)
  - `CRIT`: DLQ depth > 50 shards (systemic failure, investigate provider)
  - `INFO`: Job completion rate (logged, not alerted)
- **Operator dashboard**: CloudWatch dashboard showing: active worker count, SQS queue depth, DLQ depth, rows/second throughput, per-bucket error rates, P95 API latency. No custom dashboard infra required — all metrics from existing ECS + SQS CloudWatch integration.

## 6. What not to rebuild in two weeks

- **Custom queue system**: SQS + ECS is sufficient. Do not build Redis-based custom task queue.
- **Custom scheduler**: SQS S3 event trigger handles partitioning trigger. Do not build a cron-based coordinator.
- **Stream processing (Kafka/Kinesis)**: Overkill for batch workload. SQS fan-out achieves same parallelism without operational overhead.
- **Distributed transaction coordinator**: MongoDB bulk writes are sufficient. Do not implement two-phase commit across shards.
- **ML model for age-range prediction**: The current `calculateAgeRange()` bug (string "25+" coercion to NaN) should be fixed with proper input validation, not replaced with a model.

## 7. Degrade / rollback plan

- **If behind schedule**: Reduce shard size from 50K to 25K rows (doubles shard count, increases parallelism). Temporarily increase Worker max count from 50 to 100 (confirm provider rate limit allows). If still behind, alert operations team — partial results are available in MongoDB for completed shards; job is not all-or-nothing.
- **If provider is degraded**: Activate circuit breaker at job level — pause all new API calls for affected provider. Switch to backup provider if configured (provider routing in `AnalysisProcessor` can be extended). Mark affected shards as `PROVIDER_DEGRADED` — retry automatically when provider recovers. Do not fail the entire job; preserve completed shard results.
- **If bad data rate spikes**: If `TRANSFORM_ERROR` rate exceeds 10%, pause new shard processing and alert. Sample bad rows to `debug-payloads/`. Do not DLQ silently — surface the data quality issue to the data team. Fix the transform (e.g., the `age as number` coercion bug) and re-enqueue affected shards from DLQ.
- **If billing/usage confidence is low**: Each row-level analysis result carries a `confidence` score. If median confidence for a job drops below 0.5, flag the job result as `LOW_CONFIDENCE` in MongoDB. Do not write low-confidence results to billing-affecting ledger entries. Surface the confidence issue to the customer before billing occurs. Preserve raw usage event records even for low-confidence jobs — usage did happen, billing amount is the open question.
