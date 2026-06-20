# Scale Plan Under Constraints

> Scenario: 10GB CSV (~5M rows) uploaded every Monday 09:00; analysis + reporting within 2 hours.
> Current worker throughput ~10 rows/sec; one backend engineer; two-week budget. CTO suggests a
> Rust rewrite or moving everything to Kubernetes — both rejected as out-of-scope for two weeks.

## 1. Throughput target

- **Rows:** ~5,000,000 per file.
- **Deadline:** 2 hours = 7,200 seconds.
- **Current throughput:** ~10 rows/sec (single worker) → ~500,000s ≈ **5.8 days** (≈70x too slow).
- **Required throughput:** 5,000,000 / 7,200 ≈ **695 rows/sec**.
- **Safety factor:** target ~1,400 rows/sec (2x headroom) to absorb retries, hot partitions, and a
  late start. With ~10 rows/sec per worker that is ~140 concurrent worker slots; size to ~150–200.

## 2. Smallest architecture change

```text
S3 upload (10GB CSV)
  -> S3 event -> splitter (stream + byte-range chunking into ~1,000 shards of ~5,000 rows)
  -> SQS work queue (one message per shard, carries {fileId, shardId, byteRange})
  -> N stateless worker replicas (existing worker code) pull shards, cap provider concurrency
  -> write per-row results idempotently (keyed by fileId+rowId) to the results store
  -> SQS DLQ for poison shards
  -> aggregator (on shard-complete count == total) emits the report
```

This reuses the **existing worker logic** and the existing SQS-style queue abstraction
(`MessageQueueService` / `QueuePoller`). The only new pieces are a **splitter**, **shard-level
idempotency**, and a **completion aggregator**. Horizontal fan-out (more consumers of one queue) is
what buys the 70x — not a language change.

## 3. Work partitioning and idempotency

- **Shard key:** `fileId + shardId` (a contiguous byte/row range, ~5,000 rows each → ~1,000 shards).
- **Job identity:** `(fileId, shardId)` for the unit of work; `(fileId, rowId)` for each result row.
- **Idempotency key:** `fileId:rowId` on the results write (upsert), so a re-delivered SQS message or
  worker retry never double-writes or double-bills. Shard completion is recorded once per shardId.
- **Retry policy:** SQS visibility-timeout redelivery; max ~3 receives, exponential backoff via
  per-shard retry count; transient provider 429/5xx retried, deterministic parse errors are not.
- **Dead-letter policy:** after max receives, the shard goes to a DLQ with its `{fileId, shardId,
  byteRange, lastError}` for targeted replay — never silently dropped.

## 4. Concurrency and backpressure

- **Worker count:** ~150–200 shard consumers (autoscale on queue depth) to hit ~1,400 rows/sec.
- **Per-provider concurrency cap:** a global token-bucket / semaphore per upstream provider so fan-out
  does not exceed the provider's rate limit (this, not worker count, is the real ceiling).
- **Queue visibility / lease:** SQS visibility timeout > p99 shard processing time; long-poll receive;
  delete-on-success so a crash re-leases the shard rather than losing it.
- **Rate-limit handling:** on 429, back off and *reduce* the provider semaphore (AIMD) rather than
  hammering; surface sustained throttling as a single aggregated signal, not per-row.

## 5. Debuggability without alert floods

- **Error sampling:** log 1-in-N of identical error signatures; aggregate counts per failure bucket.
- **Failure buckets:** parse error, provider 429, provider 5xx, timeout, schema mismatch — counted per
  bucket per file run.
- **Representative payload capture:** store the first K failing rows per bucket (see existing
  `debug-payloads/` / `failed-records/` directories) instead of every failure.
- **Alert thresholds:** page only when a file run's failure rate exceeds a threshold (e.g. >2%) or the
  run is projected to miss the 2-hour SLA — not on individual row errors.
- **Operator dashboard:** per-file progress = shards complete / total, rows/sec, ETA vs SLA, DLQ depth,
  provider throttle rate.

## 6. What not to rebuild in two weeks

- Do **not** rewrite the worker in Rust — the bottleneck is I/O-bound fan-out, not CPU; horizontal
  scaling of the existing Node worker reaches the target.
- Do **not** migrate everything to Kubernetes — queue-driven autoscaling (e.g. ECS/Lambda consumers on
  SQS depth) ships in two weeks without a platform migration.
- Do **not** replace SQS/the queue abstraction or introduce a new datastore.

## 7. Degrade / rollback plan

- **If behind schedule:** raise consumer count / shard count first; if still behind, prioritize a
  representative sample for the report and clearly mark it partial rather than miss the QBR entirely.
- **If provider is degraded:** shrink the provider semaphore, lengthen backoff, and shift to the
  fallback provider if configured; never remove idempotency.
- **If bad data rate spikes:** route to DLQ, cap DLQ growth alerts to one aggregated signal, and pause
  ingestion of new shards if the failure bucket dominates (backpressure, not crash).
- **If billing/usage confidence is low:** freeze any usage/cost write that depends on the batch and
  reconcile from the idempotent results store before publishing customer-facing numbers.
