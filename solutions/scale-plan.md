# Scale Plan Under Constraints

## 1. Throughput target

- Rows: about 5,000,000 rows per Monday upload.
- Deadline: 2 hours, or 7,200 seconds.
- Current throughput: about 10 rows/second per current worker.
- Required throughput: about 695 rows/second before safety margin.
- Safety factor: design for at least 1,000 rows/second, preferably 1,500 rows/second if provider quotas and database capacity allow.

## 2. Smallest architecture change

```text
S3/object-storage upload
  -> batch_jobs record
  -> streaming CSV parser
  -> chunk manifest, initially about 5,000 rows per chunk
  -> queue message per chunk
  -> bounded worker replicas
  -> provider-aware rate limiter
  -> idempotent chunk result writes
  -> incremental report summary
  -> final dashboard/report
```

This avoids rewriting the worker in Rust or moving the whole platform to Kubernetes in two weeks. The main win is chunking and bounded horizontal concurrency, not a language rewrite.

## 3. Work partitioning and idempotency

- Shard key: `batch_id + chunk_index`, where each chunk references row range and input file version.
- Job identity: `batch_id` for the whole upload; `chunk_id` for each processable unit.
- Idempotency key: hash of `batch_id + chunk_id + input_file_version + processing_version`.
- Retry policy: retry transient provider/rate-limit failures with exponential backoff and capped attempts.
- Dead-letter policy: route permanent parse failures, repeated provider failures, or invalid rows to DLQ with representative failed records in `failed-records`.

## 4. Concurrency and backpressure

- Worker count: start around 100 replicas for roughly 1,000 rows/second if each worker sustains 10 rows/second; scale toward 150 only if provider and DB capacity are confirmed.
- Per-provider concurrency cap: global token bucket per provider/account to avoid upstream throttling or credential bans.
- Queue visibility / lease: use a real queue with visibility timeout or lease; local file queue is not safe for multi-consumer production use.
- Rate-limit handling: retry `429` / quota responses with backoff, reduce provider token bucket, and surface backlog age to operators.

## 5. Debuggability without alert floods

- Error sampling: store representative payloads per error bucket rather than every failing row.
- Failure buckets: parse error, validation error, provider auth, provider rate limit, provider 5xx, transform error, database write error.
- Representative payload capture: write bounded samples with batch id, chunk id, row number, provider, stage, and retryability.
- Alert thresholds: alert on failure rate, stuck chunks, DLQ growth, backlog age, and projected SLA miss, not individual row failures.
- Operator dashboard: show batch progress, chunks completed/failed/retrying, rows processed per second, provider throttling, ETA, and top error buckets.

## 6. What not to rebuild in two weeks

- Do not rewrite the worker in Rust; current bottleneck is orchestration, provider quota, and concurrency control.
- Do not migrate the whole platform to Kubernetes just for this batch requirement.
- Do not build a new billing or ledger system as part of the batch scale work.
- Do not create one queue message per row unless load tests prove it is operationally acceptable.
- Do not make the report all-or-nothing when partial results can be safely surfaced.

## 7. Degrade / rollback plan

- If behind schedule: publish partial report with completed chunks, ETA, and explicit incomplete dimensions; pause non-critical enrichment.
- If provider is degraded: lower provider concurrency, switch to cached or lower-fidelity enrichment where contractually allowed, and continue parsing/validation work.
- If bad data rate spikes: stop retrying permanent validation errors, DLQ affected chunks, and surface error buckets to the customer/support team.
- If billing/usage confidence is low: pause billing-affecting finalization, keep raw processing records, and require ledger/source-of-truth verification before exposing payable totals.
- Rollback: disable new batch enqueue, let in-flight leased chunks finish or expire, keep the original CSV and manifest for replay, and return to the prior single-worker path for small jobs.
