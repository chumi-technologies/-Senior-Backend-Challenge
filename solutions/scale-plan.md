# Scale Plan Under Constraints

## 1. Throughput target

- Rows: about `5,000,000`
- Deadline: `2 hours` end-to-end for analysis and reporting
- Current throughput: about `10 rows/second`
- Required throughput: about `694 rows/second` (`5,000,000 / 7,200`)
- Safety factor: target at least `1,200-1,500 rows/second` aggregate capacity so retries, skew, provider latency, and report generation do not consume the entire margin

## 2. Smallest architecture change

```text
S3 upload
  -> create batch manifest record
  -> split CSV into chunk objects (for example 25k-50k rows per chunk)
  -> enqueue one chunk-analysis job per chunk
  -> horizontally scale existing worker process across many chunk jobs
  -> persist per-chunk results and progress
  -> merge chunk outputs into final report
  -> publish batch status / completion summary
```

Smallest change: keep the current "API -> queue -> worker -> database" shape, but introduce a chunking stage and per-chunk job model. Do not rebuild the whole service, queue system, or runtime. The main bottleneck today is that the worker acts like a single-file, single-thread pipeline; the fastest path to the target is to parallelize bounded chunk jobs rather than rewrite everything.

## 3. Work partitioning and idempotency

- Shard key: `batchId + chunkIndex`
- Job identity: One parent batch job plus many child chunk jobs
- Idempotency key: `batchId:chunkIndex:fileChecksumVersion` so the same chunk can be retried or replayed without double-counting results
- Retry policy: Retry transient provider and storage failures with bounded exponential backoff; cap retries per chunk and mark the chunk as retriable failure instead of rerunning the whole 5M-row file
- Dead-letter policy: Move chunks that exhaust retries to a dead-letter queue/table with representative error payload, row-range metadata, and provider failure category for operator replay

## 4. Concurrency and backpressure

- Worker count: Start with enough workers to process at least 100-150 chunks concurrently, then tune based on provider latency and database write pressure
- Per-provider concurrency cap: Enforce explicit provider/API concurrency limits per worker so horizontal scale does not become a thundering herd against the third-party analysis endpoint
- Queue visibility / lease: Each chunk job needs a lease/visibility timeout long enough for chunk completion, with heartbeat extension for slow chunks so duplicate workers do not process the same shard
- Rate-limit handling: When provider latency or 429 rates rise, reduce worker pull rate, lower per-provider concurrency, and let queue depth absorb burst traffic instead of failing the whole batch

Backpressure control is essential. The system should prefer a growing queue and slower completion over uncontrolled fan-out that overwhelms providers, MongoDB, or downstream report generation.

## 5. Debuggability without alert floods

- Error sampling: Sample repeated failures by signature so one bad CSV or one provider outage does not emit millions of near-identical errors
- Failure buckets: Group by provider timeout, bad CSV schema, row parse failure, chunk merge failure, and database persistence failure
- Representative payload capture: Store one sanitized example row and one chunk-level trace per failure bucket, not every failed row
- Alert thresholds: Alert on sustained batch lateness, dead-letter growth, provider error-rate spikes, and merge-stage stalls rather than every row-level exception
- Operator dashboard: Show batch progress, completed chunks, retrying chunks, dead-letter count, oldest in-flight chunk, provider health, and projected completion time

## 6. What not to rebuild in two weeks

- Do not rewrite the worker in Rust first; that is a schedule risk, not the smallest path to throughput
- Do not move the entire platform to Kubernetes just to run parallel workers
- Do not introduce a brand-new billing or reporting framework while solving batch throughput

## 7. Degrade / rollback plan

- If behind schedule: Reduce per-chunk compute depth, prioritize core analysis/report fields, and deliver partial progress visibility while continuing background processing; if necessary, cap new Monday uploads until backlog drains
- If provider is degraded: Lower concurrency, extend SLA communication internally, and queue chunks for deferred retry rather than burning retry budget instantly
- If bad data rate spikes: Quarantine malformed chunks, continue processing valid chunks, and produce a partial report with explicit exclusions rather than failing the whole customer batch
- If billing/usage confidence is low: Freeze downstream customer-visible financial/reporting publication, preserve raw usage and chunk outputs, and roll back to the last known-good report generation path until reconciliation completes

Rollback principle: revert only the new chunking/orchestration layer while preserving uploaded files and parent batch manifests, so batches can be replayed through the previous path or a repaired orchestrator without data loss.
