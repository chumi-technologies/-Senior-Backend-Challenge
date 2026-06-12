# Scale Plan Under Constraints

## 1. Throughput target

- Rows: ~5,000,000 per file, one 10GB CSV every Monday 09:00.
- Deadline: analysis + report within 2 hours of upload.
- Current throughput: ~10 rows/second (single worker) → 5M rows would take ~139 hours. Gap: ~70x.
- Required throughput: 5,000,000 / 7,200s ≈ **695 rows/second** sustained.
- Safety factor: design for **~1,400 rows/second (2x)** so retries, warm-up, and tail latency still land inside the window; alert if projected completion exceeds 60% of the window.

## 2. Smallest architecture change

The bottleneck is almost certainly per-row I/O latency (third-party API call + per-row DB write), not CPU — so the answer is parallelism and batching around the **existing worker code**, not a faster language.

```text
S3 upload (10GB CSV)
  -> S3 event -> splitter job (stream the file once, no full load in memory)
       -> emits chunk manifests: (fileId, chunkId, byteRange/rowRange) ~10k rows each (~500 chunks)
       -> SQS queue (one message per chunk)
  -> N worker replicas (SAME worker codebase, containerized as today)
       -> each consumes chunk messages, processes rows with a bounded in-process
          concurrency pool (e.g. 32-64 in-flight third-party calls)
       -> batched DB writes (bulk upserts per 500-1000 rows)
  -> completion tracker (chunks done / total per fileId)
       -> report generator fires when all chunks for the fileId are done
```

Two levers, both cheap, multiply:
- In-process concurrency: if 10 rows/s is one-call-at-a-time latency (~100ms/row), a 32-deep async pool lifts one worker to ~200-300 rows/s without touching row logic.
- Horizontal replicas: 5-8 identical workers on the existing container platform (ECS service / ASG — whatever runs the worker today) reach the ~1,400 rows/s design point with margin.

Two weeks, one engineer: splitter (2-3 days), pool + batching inside the existing processor (2-3 days), idempotent writes + completion tracking (2-3 days), load test with a synthetic 10GB file (2 days), dashboards/alerts + degrade switch (2 days).

## 3. Work partitioning and idempotency

- Shard key: `(fileId, chunkId)` — contiguous row ranges; chunk size 10k rows balances retry blast radius against queue overhead.
- Job identity: chunk message carries `fileId`, `chunkId`, row range, and the source object version (S3 ETag) so a re-uploaded file never mixes with the old one.
- Idempotency key: `(fileId, rowNumber)` (or the row's natural business key if one exists) — all row writes are **upserts** keyed on it, so reprocessing a chunk is harmless by construction.
- Retry policy: SQS redelivery on visibility-timeout expiry; per-chunk attempt counter; max 3 attempts.
- Dead-letter policy: after 3 failed attempts the chunk goes to a DLQ; failed rows inside an otherwise-good chunk go to a `failed-records/` bucket (the repo's existing pattern) with the raw payload, error class, and row number — replayable after the run.

## 4. Concurrency and backpressure

- Worker count: start 6 replicas (design point ~1,400 rows/s), scale on queue depth between 2 and 10.
- Per-provider concurrency cap: global token bucket shared via a small rate-limit table/semaphore service so N workers cannot exceed the third-party API's contract rate; per-worker in-process pool capped at 32-64 in-flight calls.
- Queue visibility / lease: visibility timeout = p99 chunk duration x 1.5 (re-derived from load test); heartbeat extension for slow chunks so a live worker never loses its lease mid-chunk.
- Rate-limit handling (backpressure): on provider 429/5xx, exponential backoff with jitter inside the pool and shrink the pool size (halve on sustained 429s, recover additively); workers stop prefetching new chunks when the in-flight pool is saturated or DB bulk-write p99 exceeds threshold — the queue absorbs the backlog, which is exactly what it is for. Memory is bounded by streaming chunks (never load the 10GB file or a whole chunk's responses at once).

## 5. Debuggability without alert floods

- Error sampling: log the first occurrence + every Nth (e.g. 100th) repeat per error class per file, with counts — never one alert per row.
- Failure buckets: classify failures (validation, provider 4xx, provider 5xx/timeout, DB write) and count per bucket per fileId.
- Representative payload capture: store 1-3 raw sample payloads per bucket in `failed-records/` for postmortem replay; everything else is counted, not stored.
- Alert thresholds: page only on (a) projected completion time exceeding the 2h window (ETA from chunks-done rate), (b) failure rate > 1% sustained 5 min, (c) DLQ non-empty. Everything else is dashboard-only.
- Operator dashboard: per-file progress (chunks done/total, rows/s, ETA), failure-bucket counts, provider 429 rate, pool size, queue depth — one screen answers "will Monday's file make it?".

## 6. What not to rebuild in two weeks

- **No Rust rewrite** (CTO suggestion, rejected): the workload is I/O-bound; a language swap attacks the wrong bottleneck, throws away tested row logic, and one engineer cannot de-risk a rewrite plus a 70x scale-up in two weeks.
- **No Kubernetes migration** (CTO suggestion, rejected): the existing container platform already runs N replicas; a platform migration adds operational risk and zero rows/second.
- No new database or streaming stack (Kafka/Flink/etc.): SQS + the existing store handle 1,400 rows/s comfortably with batching.
- No rewrite of the row-processing/business logic: it is the part that already works; it gets wrapped, not replaced.

## 7. Degrade / rollback plan

- If behind schedule (ETA alert at any point): scale replicas toward the cap, raise pool size within the provider's contract rate; if still behind, switch on degrade mode — process the columns required for the contractual report first, queue low-priority enrichment columns for a backfill pass after the deadline; deliver the report on time and backfill transparently.
- If provider is degraded: backoff shrinks throughput automatically; ETA alert fires early; degrade mode prioritizes must-have columns; chunks that exhaust retries land in the DLQ for post-recovery replay — partial progress is never lost (idempotent upserts).
- If bad data rate spikes (malformed CSV region): failed rows divert to `failed-records/` buckets without stalling the pipeline; if a whole chunk is poison it dead-letters after 3 attempts; the report flags the affected row ranges.
- If billing/usage confidence is low or results look wrong: kill switch back to the **untouched legacy single-worker path** — the splitter sits behind a feature flag and the old entry point is preserved, so rollback is a flag flip plus replaying the file from S3 (everything is idempotent, so a partial parallel run followed by a legacy rerun double-writes nothing).
