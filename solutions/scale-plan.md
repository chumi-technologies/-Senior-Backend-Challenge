# Scale Plan Under Constraints

## 1. Throughput target

- Rows: ~5,000,000 per 10GB CSV, every Monday 09:00.
- Deadline: complete analysis + reporting within 2 hours (7,200s).
- Current throughput: ~10 rows/second (single worker) => 5,000,000 / 10 = 500,000s ≈ 138.9 hours.
- Required throughput: 5,000,000 / 7,200 ≈ 695 rows/second => ~70x the current rate.
- Safety factor: target ~1,000 rows/second (provision ~100 worker slots) to absorb retries, provider latency, and tail rows.

## 2. Smallest architecture change

Keep the existing Node worker and queue model; scale horizontally. Do NOT rewrite in Rust and do NOT move to Kubernetes in two weeks.

```text
S3 upload (10GB CSV)
  -> splitter (stream + chunk into N-row shards, e.g. 10k rows/shard => ~500 shards)
  -> SQS work queue (one message per shard, carrying fileId + shard range)
  -> ~100 concurrent worker instances (autoscaled) pulling shards
  -> idempotent upsert of per-row results (keyed by fileId + rowIndex)
  -> aggregation/report job once all shards COMPLETED
  -> DLQ for poison shards/rows
```

## 3. Work partitioning and idempotency

- Shard key: `fileId + shardIndex` (contiguous row ranges so a shard is independently reprocessable).
- Job identity: `fileId` (the weekly upload); shards are children.
- Idempotency key: `fileId + rowIndex` on the result upsert so re-delivered/retried shards never double-write or double-bill.
- Retry policy: SQS redrive with capped retries (e.g. 3) and exponential backoff; per-row failures isolated, not whole-shard.
- Dead-letter policy: shards exceeding max retries go to a DLQ with the failing row range for offline inspection.

## 4. Concurrency and backpressure

- Worker count: ~100 slots (autoscale on queue depth), tunable to hit ~1,000 rows/s.
- Per-provider concurrency cap: bounded concurrent calls to the third-party API to respect its rate limit (token bucket / semaphore), independent of worker count.
- Queue visibility / lease: SQS visibility timeout > max shard processing time so in-flight shards are not duplicated; heartbeat/extend for long shards.
- Rate-limit handling: on provider 429, back off and requeue the shard with backpressure; never spin-retry.

## 5. Debuggability without alert floods

- Error sampling: aggregate failures by reason; sample N representative failures per bucket instead of one alert per row.
- Failure buckets: provider-error / parse-error / validation-error / timeout.
- Representative payload capture: store one sample failing row per bucket (like `failed-records/`) for replay, not every row.
- Alert thresholds: page only on batch-level SLOs (e.g. error rate > X% or projected completion > 2h), not per-row.
- Operator dashboard: shards total / completed / in-flight / DLQ, rows/sec, projected finish time.

## 6. What not to rebuild in two weeks

- The worker language/runtime (no Rust rewrite).
- The orchestration platform (no Kubernetes migration).
- The third-party integration and transform logic (reuse as-is, just fan out).

## 7. Degrade / rollback plan

- If behind schedule: process priority shards first, raise worker count, shed non-critical enrichment, surface a partial report with coverage %.
- If the provider is degraded: lower per-provider concurrency, lengthen backoff, queue remainder for later; do not fail the whole batch.
- If the bad-data rate spikes: divert affected shards to the DLQ, keep good shards flowing, alert once at the batch level.
- If billing/usage confidence is low: mark affected results provisional and hold reporting rather than emit wrong aggregates; rollback = reprocess from the immutable S3 source (idempotent, so safe to replay).
