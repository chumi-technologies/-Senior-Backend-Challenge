# Scale Plan Under Constraints

> 1 backend engineer, 2 weeks. CTO suggested a Rust rewrite or "move everything to Kubernetes" — both rejected below.

## 1. Throughput target

- Rows: ~5,000,000 per file, weekly (Monday 09:00), ~10 GB CSV.
- Deadline: results + reporting within 2 hours.
- Current throughput: ~10 rows/second (≈ 500,000 s ≈ 139 hours for 5M rows — ~70× too slow).
- Required throughput: ≥ 5,000,000 / 7,200 s ≈ **695 rows/second**.
- Safety factor: target ~2× headroom → design for ~1,400 rows/second (≈ 140× current single-worker rate).
- Bottleneck reality: the per-row cost is the **third-party API call** (latency-bound, ~hundreds of ms each), not CPU. So the lever is **concurrency / horizontal fan-out**, not a faster language.

## 2. Smallest architecture change

```text
S3 upload (10GB CSV)
  -> S3 event -> "splitter" lambda/process: stream the CSV, chunk into N shards
       (e.g. 1,000 rows/shard => ~5,000 shard messages), write each shard ref to SQS
  -> SQS work queue (shard messages)  <-- existing queue-poller pattern, just real SQS
  -> M concurrent workers (existing worker-service, scaled out) pull shards,
       process rows with a bounded per-provider concurrency pool,
       upsert results by idempotency key
  -> results store + reporting aggregate
  -> DLQ for poison shards/rows
```

Only additions: a streaming **splitter** + real **SQS** + **horizontal worker scaling** + an **idempotent upsert**. Everything else (the existing TS worker, processor interface, queue-poller shape) is reused. No new language, no cluster.

## 3. Work partitioning and idempotency

- Shard key: `fileId + shardIndex` (each shard = a contiguous row range, e.g. rows 0–999).
- Job identity: `fileId` (one weekly batch) with a manifest of expected shard count for completion tracking.
- Idempotency key: `fileId:rowIndex` (or a content hash) used as the upsert key in the results store, so a retried row/shard overwrites itself rather than duplicating — mirrors the existing `updateOne(..., {upsert:true})` pattern in `DatabaseService`.
- Retry policy: per-message exponential backoff with a max attempt count; transient provider errors (429/5xx) retried, deterministic bad-data errors sent straight to the failure bucket (no pointless retries).
- Dead-letter policy: after max attempts, the shard/row goes to a DLQ and a `failed-records/batch-xxx.json` file; the batch continues (one bad shard never blocks the 2-hour window).

## 4. Concurrency and backpressure

- Worker count: scale workers horizontally to hit ~700–1,400 rows/s. With ~300 ms/row per concurrent slot, ~300–500 concurrent in-flight calls reach target; spread across a handful of worker instances each running a bounded pool.
- Per-provider concurrency cap: a hard cap per upstream provider/credential so we never exceed the provider's rate limit; the `MockAuthPool` round-robin (load balancing across credentials) raises the effective ceiling without overloading a single account.
- Queue visibility / lease: SQS visibility timeout ≥ max shard processing time so an in-flight shard isn't double-delivered; long-poll to reduce churn.
- Rate-limit handling / backpressure: on provider 429, apply token-bucket throttling and let SQS hold the queue (backpressure is automatic — unconsumed messages simply wait). Cap concurrency rather than buffering unboundedly in memory.

## 5. Debuggability without alert floods

- Error sampling: log full detail for the first N failures per error class per batch, then count-and-sample the rest (no per-row alerts).
- Failure buckets: classify into `bad-data` (e.g. `age:"25+"`, `tags` as CSV string vs array, null fields — exactly the variety in `debug-payloads/chaos-data-samples.json`), `provider-transient`, `provider-permanent`, `internal`.
- Representative payload capture: save one representative payload per bucket to `failed-records/` for offline replay (`scripts/replay-event.ts` / `process:chaos`), instead of dumping every row.
- Alert thresholds: page only on batch-level SLO risk — e.g. failure rate > 2% or projected completion > 2 h — not on individual row failures.
- Operator dashboard: rows processed/sec, shards remaining, ETA vs 2-hour deadline, failure counts per bucket, DLQ depth.

## 6. What not to rebuild in two weeks

- Do **not** rewrite the worker in Rust — the bottleneck is I/O-bound provider latency, not CPU; a rewrite spends the 2 weeks for ~0 throughput gain.
- Do **not** "move everything to Kubernetes" — managed queue + autoscaled workers (ECS/Lambda) reaches the target with far less operational surface for one engineer.
- Do **not** replace the existing worker/processor/queue abstractions — extend them (real SQS, scale-out, idempotent upsert).
- Do **not** build a bespoke distributed scheduler — SQS + shard manifest is enough.

## 7. Degrade / rollback plan

- If behind schedule: increase worker concurrency / instance count first; if still behind, **degrade gracefully** — prioritize a representative sample for the report, finish the tail asynchronously past the 2 h mark, and clearly mark the report as partial.
- If provider is degraded: lower the per-provider concurrency cap (the queue absorbs backpressure), rotate to healthy credentials via the auth pool; if fully down, pause consumption (messages persist) rather than burning retries.
- If bad data rate spikes: circuit-break to the failure bucket + DLQ, alert once at the batch level, keep processing good rows; do not let a malformed-data flood stall the batch.
- If billing/usage confidence is low: never emit speculative usage/billing numbers — withhold the affected aggregate, flag it, and fall back to the last known-good figure; rollback is "stop and report partial", never "guess".
- Rollback: each weekly batch is independent and idempotent, so a failed run can be **re-run from the same S3 file** with no double-counting (idempotency key dedupes); the previous week's data is untouched.
