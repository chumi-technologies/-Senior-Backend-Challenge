# Scale Plan Under Constraints

## 1. Throughput target

- Rows: ~5,000,000 per file (10GB CSV, weekly Monday 09:00).
- Deadline: 2 hours (7,200 seconds) end-to-end including reporting.
- Current throughput: ~10 rows/second (single worker).
- Required throughput: 5,000,000 / 7,200 ≈ 695 rows/second sustained.
- Safety factor: target ~1,000 rows/second (≈1.4×) to absorb retries, provider latency, and a late start.

## 2. Smallest architecture change

```text
S3 upload (10GB CSV)
  -> S3 event -> splitter: stream the CSV and enqueue row batches (e.g. 500 rows/message) to the existing queue
  -> N replicas of the EXISTING Node worker (horizontal scale), each running bounded in-process concurrency
  -> idempotent upsert of per-row results keyed by (fileId, rowNumber)
  -> reporting aggregates from the results store once all batches are done
```

The change is: add a streaming splitter that fans the file into batched messages, and run more replicas of the current worker with bounded concurrency. No language rewrite, no orchestration platform migration. From 10 → ~1,000 rows/s is ~100× : roughly 10 worker replicas × ~10 concurrent in-flight requests each, sized against the provider rate limit rather than CPU.

## 3. Work partitioning and idempotency

- Shard key: `fileId` partitions a run; batches are sharded by contiguous `rowNumber` ranges so replicas never overlap.
- Job identity: `(fileId, rowNumber)` uniquely identifies one row's analysis.
- Idempotency key: `(fileId, rowNumber)` drives an upsert, so a redelivered or retried batch re-writes the same row rather than creating duplicates (no double counting in the report).
- Retry policy: bounded exponential backoff per batch; on repeated failure the message goes to a dead-letter queue rather than blocking the run.
- Dead-letter policy: failed rows land in a DLQ with their error bucket; the run can complete and report partial results while DLQ rows are reprocessed or surfaced.

## 4. Concurrency and backpressure

- Worker count: ~10 replicas of the existing worker (horizontal), tuned to the provider ceiling, not the box.
- Per-provider concurrency cap: a token-bucket / semaphore limiting in-flight calls to the third-party API so total concurrency across replicas stays under its rate limit — this is the real throughput ceiling.
- Queue visibility / lease: per-batch visibility timeout so an in-progress batch is not redelivered while a worker is still on it; the lease renews for long batches.
- Rate-limit handling: on HTTP 429 / throttle, the token bucket sheds and backs off; backpressure propagates by leaving messages on the queue (visibility timeout) instead of dropping them, so the queue depth is the natural buffer.

## 5. Debuggability without alert floods

- Error sampling: log the first occurrence per error bucket per window, then count the rest; do not log every failed row.
- Failure buckets: classify failures (provider 5xx, provider 429, malformed row, timeout, validation) and count per bucket.
- Representative payload capture: store one representative payload per bucket (e.g. to `failed-records/` / `debug-payloads/`) for reproduction, not every payload.
- Alert thresholds: page only on rate-of-failure crossing a threshold (e.g. >2% of rows in a 5-minute window) or on falling behind the deadline burn-down — not on individual row failures.
- Operator dashboard: rows processed vs target burn-down, queue depth, DLQ size, per-bucket failure counts, provider 429 rate.

## 6. What not to rebuild in two weeks

- Do not rewrite the worker in Rust — the bottleneck is the provider API and I/O concurrency, not CPU; a rewrite adds risk and no headroom in the time available.
- Do not migrate everything to Kubernetes — horizontal replicas of the current worker behind the existing queue reach the target without a platform migration.
- Do not replace the queue/datastore or invent a new pipeline framework — reuse the existing queue, worker, and results store.

## 7. Degrade / rollback plan

- If behind schedule: raise per-provider concurrency toward the cap and add worker replicas; if still behind, prioritize a representative sample to deliver a partial report by the deadline and continue the tail asynchronously.
- If provider is degraded: the token bucket throttles down and batches stay queued (visibility timeout) rather than failing; alert on sustained 429/5xx.
- If bad data rate spikes: route malformed rows to the DLQ with their bucket and keep processing good rows; surface the bad-row count in the report rather than failing the whole run.
- If billing/usage confidence is low: this is a read/analysis pipeline and must not write the customer ledger; degrade to reporting-only and flag low-confidence rows.
- Rollback: the splitter is the only new component; disable it and the system reverts to the prior single-worker behavior with no schema change, so rollback is a config flip.
