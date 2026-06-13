# Scale Plan Under Constraints

## 1. Throughput target

- Rows: about 5,000,000 rows from a 10GB CSV.
- Deadline: 2 hours, or 7,200 seconds.
- Current throughput: about 10 rows/second.
- Required throughput: about 695 rows/second before overhead.
- Safety factor: design for 1,500 rows/second so retries, provider throttling, and parsing overhead do not miss the SLA.

## 2. Smallest architecture change

```text
Object storage upload
  -> create import job
  -> split CSV by byte ranges / row chunks
  -> enqueue chunk jobs with bounded concurrency
  -> workers parse and analyze chunks idempotently
  -> chunk result table stores checkpoint, counts, failure bucket, and sample errors
  -> reducer builds final report when all chunks are completed or explicitly degraded
```

This keeps the existing TypeScript worker and queue model. The smallest change is chunked processing with checkpointed retries, not a Rust rewrite or Kubernetes migration.

## 3. Work partitioning and idempotency

- Shard key: `{fileId, chunkIndex}` where each chunk owns a byte range and starts at the next newline boundary.
- Job identity: `{tenantId, fileId, importVersion}`.
- Idempotency key: `{tenantId, fileId, chunkIndex, contentHash}` for chunk writes and `{tenantId, fileId, rowNumber}` for row-level outputs if needed.
- Retry policy: retry transient provider/network failures with exponential backoff and a max attempt count; keep permanent validation failures in the chunk result.
- Dead-letter policy: dead-letter only chunks that exhaust retries; include failure bucket, representative payload pointer, and retry history.

## 4. Concurrency and backpressure

- Worker count: start with 8-16 TypeScript workers and tune from observed rows/second; do not exceed downstream provider limits.
- Per-provider concurrency cap: token bucket per provider account so one customer batch cannot starve live traffic.
- Queue visibility / lease: chunk lease with heartbeat; expired lease returns the chunk to the queue.
- Rate-limit handling: provider 429 lowers the provider token bucket and pauses new chunk dispatch for that provider.
- Backpressure: if queue age or provider error rate crosses threshold, pause new batch intake and reduce chunk concurrency before failing live gateway traffic.

## 5. Debuggability without alert floods

- Error sampling: store first N representative bad rows per failure bucket, not every row.
- Failure buckets: parse error, schema validation, provider timeout, provider 429, transform error, persistence error.
- Representative payload capture: save redacted row sample plus chunk id and line number range.
- Alert thresholds: page on SLA risk, systemic provider failure, or reducer blocked; ticket-only alert for isolated bad rows below threshold.
- Operator dashboard: show job progress, rows/second, chunk success/failure counts, oldest chunk age, retry counts, and top failure buckets.

## 6. What not to rebuild in two weeks

- Do not rewrite the worker in Rust; the bottleneck is orchestration, chunking, retries, and downstream limits before language speed.
- Do not move everything to Kubernetes; deploy topology change is not the smallest path to 695 rows/second.
- Do not replace the queue, database, and reporting stack at once.
- Do not build a fully general workflow engine; a job/chunk table and bounded workers are enough for this SLA.

## 7. Degrade / rollback plan

- If behind schedule: publish partial report with completed chunk coverage and ETA, pause new enterprise uploads, and raise concurrency only within provider caps.
- If provider is degraded: lower provider concurrency, continue parsing/checkpointing, and mark provider-dependent analysis as delayed.
- If bad data rate spikes: stop retrying permanent validation errors, bucket them, and continue valid chunks.
- If billing/usage confidence is low: freeze customer-visible report finalization, keep raw chunk outputs, and roll back to previous serial worker for new uploads while preserving chunk state for replay.
- Rollback: disable chunk dispatcher feature flag and route new uploads to the old worker; already completed chunks remain idempotent artifacts and can be reduced or replayed.
