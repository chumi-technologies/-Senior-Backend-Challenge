# Scale Plan Under Constraints

## 1. Throughput target

- Rows: `5,000,000`
- Deadline: `2 hours = 7,200 seconds`
- Current throughput: about `10 rows/second`
- Required throughput: `5,000,000 / 7,200 = 694.4 rows/second`
- Safety factor: target `900-1,000 accounted rows/second`

The important metric is accounted throughput, not enqueue throughput:

```text
accounted rows = successfully processed rows + rows classified into a durable failure category
```

At `10 rows/second`, the current worker can process about `72,000` rows in 2 hours. Processing `5,000,000` rows would take about `138.9` hours. This is roughly a `70x` gap before accounting for retries, provider latency, MongoDB writes, final aggregation, and deployment variance.

This means the plan must parallelize the batch pipeline end to end. Rewriting the worker in Rust or moving everything to Kubernetes does not by itself solve provider quota, queue fan-out, idempotency, bulk writes, partial aggregation, or observability.

## 2. Smallest architecture change

Build one enterprise weekly batch path around the existing TypeScript worker logic. Do not rewrite the existing single-job analysis path.

```text
S3 upload
  -> batch run record
  -> streaming CSV splitter
  -> S3 shard files + manifest
  -> SQS shard-pointer messages
  -> horizontally scaled TypeScript worker pool
  -> provider calls with bounded concurrency
  -> MongoDB bulk upsert for row results and progress
  -> S3 shard summaries / failed rows
  -> final aggregation job
  -> report metadata and final report
```

The smallest production-grade change is to replace the local single-message processing shape with a sharded batch pipeline:

- Keep the current worker language and core transformation logic.
- Treat the current `local-queue` file poller as the local-development stand-in for production SQS; replace the production queue boundary, not the whole application.
- Add `BatchRun` metadata: `runId`, customer, source file, status, total rows, total shards, progress, started/completed timestamps.
- Add a streaming CSV splitter so the 10GB input is never loaded fully into memory.
- Add an `AnalysisShardRequested` message alongside the existing single-job `AnalysisRequested` event; emit shard pointers, not one message per row.
- Process each shard with bounded in-worker concurrency and bulk writes.
- Write shard-level summaries so final reporting merges summaries instead of scanning 5 million detailed rows.

Initial shard size can be `5,000` rows:

```text
5,000,000 rows / 5,000 rows per shard = 1,000 shard messages
```

That keeps retry granularity small enough while avoiding 5 million queue messages.

Core data flow:

1. Customer uploads the source CSV to `s3://analysis-input/{customerId}/{runId}/source.csv`.
2. An S3 event or explicit API call creates a `BatchRun` with status `SPLITTING`.
3. The splitter reads the CSV as a stream, validates the header, and writes complete-record shards to S3.
4. The splitter writes a manifest with total rows, total shards, schema version, and shard locations.
5. Each shard pointer is sent as one queue message.
6. Workers fetch shard files, process rows with bounded concurrency, and bulk upsert row results.
7. Each worker writes one shard summary and any failed rows to S3.
8. The final aggregation job merges shard summaries and publishes report metadata.

Example manifest:

```json
{
  "runId": "run-2026-06-13-enterprise-a",
  "customerId": "enterprise-a",
  "sourceS3Key": "analysis-input/enterprise-a/run-2026-06-13/source.csv",
  "totalRows": 5000000,
  "totalShards": 1000,
  "shardSize": 5000,
  "schemaVersion": 1
}
```

Example shard message:

```json
{
  "eventType": "AnalysisShardRequested",
  "schemaVersion": 1,
  "runId": "run-2026-06-13-enterprise-a",
  "customerId": "enterprise-a",
  "shardId": "shard-000123",
  "shardS3Key": "analysis-runs/run-2026-06-13/shards/shard-000123.jsonl",
  "rowStart": 615000,
  "rowEnd": 619999,
  "attempt": 1,
  "traceId": "trace-run-2026-06-13"
}
```

The queue payload stays small and stable. The large data stays in S3, where it is cheap, replayable, and easier to inspect.

Main bottlenecks:

| Stage | Risk | Handling |
|---|---|---|
| CSV ingestion | Loading 10GB into memory or splitting inside quoted newlines corrupts rows. | Use a streaming CSV parser and split only on complete records. |
| Queue fan-out | 5 million row-level messages would increase cost and make retries hard to reason about. | Queue shard pointers, not row payloads. |
| Provider API | The provider may not allow `700+ rows/second`, especially with one request per row. | Confirm quota before launch, prefer provider batch API, and enforce bounded concurrency. |
| MongoDB writes | Per-row synchronous `updateOne` will amplify latency and index pressure. | Use bulk upsert and keep large intermediate artifacts in S3. |
| Final reporting | Scanning all row results at the end creates a tail-latency bottleneck. | Emit shard summaries and merge summaries. |
| Observability | 1% failed rows means 50,000 failure events. | Use error buckets, sampled examples, S3 failed-row files, and aggregate alerts. |

## 3. Work partitioning and idempotency

- Shard key: `runId + shardId`
- Job identity: one `BatchRun` per customer upload, with a deterministic `runId` created at ingestion time.
- Row identity: `recordKey = hash(runId + sourceRowNumber + stableExternalId)`
- Provider request identity: `providerRequestKey = hash(provider + normalizedInput)`
- Shard status: `PENDING -> PROCESSING -> COMPLETED / COMPLETED_WITH_ERRORS / FAILED`
- Retry policy: retry transient shard failures with exponential backoff and jitter; do not retry permanent validation failures.
- Dead-letter policy: after the retry budget is exhausted, put the shard message in DLQ and mark the shard `FAILED` with an error category.

SQS-style queues are at-least-once. Exactly-once delivery is not a realistic two-week goal, so correctness must come from deterministic keys and idempotent writes.

MongoDB row result writes should use bulk upsert:

```text
filter: { runId, recordKey }
update: {
  $setOnInsert: { createdAt, sourceRowNumber },
  $set: { status, normalizedResult, errorCategory, updatedAt }
}
upsert: true
```

That filter prevents duplicate row documents, but it is not enough by itself for at-least-once retries. Row-result writes also need write ownership: include the active shard attempt or lease version in the update guard, or make terminal transitions monotonic so a stale retry cannot replace a successful row result with a later transient failure. Otherwise a customer report can regress after a newer shard attempt has already produced the correct row result.

Shard progress updates should also be conditional. A stale retry must not overwrite a newer terminal shard state. This is the same write-ownership principle used in the Part 4 delayed-update fix.

The final report should be idempotent as well:

- Each shard writes one summary object keyed by `runId + shardId`.
- The final aggregation job runs only after all shards reach a terminal state.
- Re-running final aggregation replaces the report for the same `runId`; it does not append duplicate totals.

Example shard summary:

```json
{
  "runId": "run-2026-06-13-enterprise-a",
  "shardId": "shard-000123",
  "processed": 5000,
  "succeeded": 4930,
  "failed": 70,
  "ageBuckets": { "18-24": 1200, "25-34": 2100 },
  "genderBuckets": { "female": 2600, "male": 2100, "other": 230 },
  "countryBuckets": { "US": 3000, "CA": 500 }
}
```

## 4. Concurrency and backpressure

- Worker count: start with `90-120` worker tasks if the provider quota allows it. The mathematical floor is about `70` current-speed workers, but that leaves no retry or tail-latency buffer.
- Per-provider concurrency cap: centrally configured and enforced by token bucket or leased counters. It must be based on confirmed provider quota, not desired SLA.
- Queue visibility / lease: visibility timeout should exceed expected shard processing time, with heartbeat extension for long shards.
- Rate-limit handling: on `429` or provider saturation, reduce concurrency, extend leases, and requeue with jittered backoff instead of hammering the provider.

The first capacity gate is provider quota. If the third-party API is one row per request with 1 second average latency, `700 rows/second` implies roughly `700` concurrent provider requests. If p95 latency is 1.5 seconds, the needed concurrency approaches `1,000`. If the provider offers a batch API, use it first; for example, `100 rows/request` turns `700 rows/second` into about `7 provider requests/second`.

Backpressure rules:

- If provider `429`, timeout, or 5xx rates cross threshold, reduce worker concurrency and let queue age rise rather than creating a retry storm.
- If MongoDB bulk write latency rises, reduce per-worker batch flush frequency and worker concurrency.
- If DLQ starts growing, stop increasing worker count and investigate the dominant error category.
- If final aggregation falls behind, pause new enterprise batch starts until the current run is accounted.

## 5. Debuggability without alert floods

A 1% row failure rate means `50,000` failures. That cannot become `50,000` logs or `50,000` alerts.

- Error sampling: log shard summaries and sample representative rows per error category; store full failure details in S3 with PII redaction.
- Failure buckets: use stable low-cardinality categories such as `csv.malformed_row`, `validation.required_field_missing`, `third_party.rate_limited`, `third_party.timeout`, `third_party.bad_response_shape`, `mongo.bulk_write_failed`, and `worker.unhandled_exception`.
- Representative payload capture: write failed rows to S3 partitioned by `runId / shardId / errorCategory`, with raw values redacted or referenced rather than printed into centralized logs.
- Alert thresholds: alert on aggregate signals, not individual bad rows.
- Operator dashboard: show ETA, processed rows, accounted throughput, shard terminal count, queue age, worker count, provider p50/p95/p99, provider error rates, Mongo bulk write latency, DLQ depth, and top error categories.

Alert only on signals that need action:

| Alert | Trigger |
|---|---|
| SLA risk | ETA exceeds 120 minutes or queue oldest-message age keeps growing. |
| No progress | Accounted row count is flat for several minutes. |
| Failure spike | Row failure rate exceeds threshold, for example `>2%` for 10 minutes. |
| Provider degraded | `429`, timeout, or 5xx rate crosses threshold. |
| DLQ growth | Any shard enters DLQ or DLQ depth keeps increasing. |
| Mongo degraded | Bulk write latency or write errors exceed threshold. |
| Aggregation stuck | All shards are terminal but final report is not produced. |

Do not alert on individual validation failures, known low-rate permanent bad data, or sampled rows that have already been durably captured.

Failed rows should be stored outside centralized logs:

```text
s3://analysis-runs/{runId}/failed/
  category=validation.required_field_missing/part-00001.jsonl
  category=third_party.timeout/part-00002.jsonl
  category=third_party.rate_limited/part-00003.jsonl
```

Each failed-row record should include `runId`, `shardId`, `rowNumber`, `recordKey`, `errorCategory`, a redacted reason, and a reference to the raw source. It should not dump full PII or full provider responses into logs.

## 6. What not to rebuild in two weeks

| Do not rebuild | Reason | Two-week alternative |
|---|---|---|
| Full Rust worker rewrite | The bottleneck is likely external I/O, provider quota, retries, writes, and aggregation rather than TypeScript CPU. | Keep TypeScript; profile later and rewrite only proven CPU hot paths behind stable contracts. |
| New Kubernetes platform | Kubernetes can run more workers, but it does not solve sharding, idempotency, quota, DLQ, reporting, or alert design. | Use a managed worker runtime such as ECS Fargate, AWS Batch, or the existing compute platform with queue-driven scaling. |
| Spark/Flink/data lake | Too broad for one engineer in two weeks and not required for one weekly 10GB batch. | S3 shards, SQS shard messages, worker pool, shard summaries, final aggregation. |
| Distributed exactly-once processing | Expensive and unrealistic under deadline. | At-least-once queue plus deterministic idempotency keys and upsert. |
| Complex live progress UI | Nice but not required for the 2-hour SLA. | Operator dashboard with run progress, ETA, top errors, and replay pointers. |
| Per-row live status queries | High cardinality and write amplification. | Shard progress plus sampled failed rows. |
| Per-row alerts | 1% failure would flood operators. | Error buckets, aggregate thresholds, and S3 failure files. |
| Multi-region active-active | Too much platform scope for first delivery. | Single-region batch path with durable S3 inputs, retryable shards, DLQ, and runbook. |

Rust and Kubernetes are not rejected forever. They are rejected for the two-week critical path. If profiling later proves CSV parsing or transformation is CPU-bound, a narrow Rust module can be considered after contracts and characterization tests exist. If the company already has mature Kubernetes/KEDA/SQS autoscaling, the worker pool can run there, but the architecture is still shard-based batch processing.

## 7. Degrade / rollback plan

- If behind schedule: stop accepting new enterprise batch starts, increase worker count only within provider and Mongo limits, reduce shard size for better retry granularity, and produce a partial report marked `IN_PROGRESS` or `COMPLETED_WITH_ERRORS` if all rows are either processed or durably classified.
- If provider is degraded: lower concurrency, increase backoff, classify provider timeouts separately, keep failed shard pointers replayable, and report that provider capacity is the blocking dependency. Do not create unbounded retries.
- If bad data rate spikes: keep processing valid rows, write invalid rows to S3 failure files by category, mark the run `COMPLETED_WITH_ERRORS` if the error rate is within the agreed threshold, and fail fast if required columns or schema validation fail at ingestion.
- If reporting or usage confidence is low: pause final report publication and any customer-visible metering effects, preserve raw inputs, shard outputs, and summaries, and rerun aggregation after validation. Do not rewrite historical usage or emit duplicate ledger entries.
- If MongoDB is degraded: reduce worker concurrency, increase bulk batch size carefully, write shard output and partial summaries to S3, and delay final metadata writes until Mongo recovers.
- If a bad batch implementation is deployed: disable the enterprise batch feature flag, stop new S3 event ingestion for this path, leave existing raw files in S3, drain or pause shard queues, and continue serving the existing single-job analysis path.

Rollback target is the current non-batch `AnalysisRequested` worker path. The new batch path should be feature-flagged by customer/run type so it can be disabled without changing ordinary analysis behavior.

SLO and acceptance criteria:

Initial SLO:

- In the normal case, the final report is available within 2 hours of accepted upload.
- Assuming provider quota is sufficient, 100% of rows reach either success or durable classified failure within 2 hours.
- At least 99% of valid accepted rows should be successfully processed within 2 hours.
- Invalid rows do not block the batch; they are classified, sampled, and included in the final report.
- Customer-visible reporting and billing effects are published only after the run is internally consistent.

Risk and mitigation:

| Risk | Impact | Mitigation |
|---|---|---|
| Provider quota is below target throughput. | The SLA is impossible regardless of language or platform. | Confirm quota, use batch API, or renegotiate SLA before launch. |
| Provider tail latency is high. | Final shards drag past the 2-hour deadline. | Keep shards small, use timeouts, bounded retry, and ETA-based throttling. |
| MongoDB write throughput is insufficient. | Worker queue backs up and retries increase. | Bulk write, reduce indexes, avoid hot aggregate documents, and store large artifacts in S3. |
| CSV schema changes unexpectedly. | Large batches fail after expensive processing starts. | Validate header and schema version before sharding; fail fast. |
| Shards are too large. | Retry cost is high and visibility leases expire. | Start around 5,000 rows and tune shard size from load-test data. |
| Shards are too small. | Queue overhead and aggregation overhead grow. | Use shard-size bounds and monitor queue age plus worker utilization. |
| Worker crashes cause duplicate processing. | Duplicate row results or inflated report totals. | Deterministic keys, upsert, conditional shard status, and idempotent aggregation. |
| Failure logging explodes. | Operators cannot debug and logging cost spikes. | Error buckets, S3 failed rows, sampling, and aggregate alerts. |

Acceptance criteria:

| Area | Criterion |
|---|---|
| Throughput | Sustained accounted throughput reaches at least `900 rows/second` in load test, assuming confirmed provider quota. |
| Deadline | `5,000,000` rows reach success or classified failure within 120 minutes. |
| Ingestion | 10GB CSV is processed by streaming parser; no full-file memory load. |
| Queue | Queue messages are shard pointers, not row payloads. |
| Idempotency | Replaying a shard does not duplicate row results or aggregate totals. |
| Backpressure | Provider or Mongo degradation reduces concurrency instead of causing retry storms. |
| Debuggability | Top error categories, representative failed rows, ETA, DLQ depth, and shard progress are visible. |
| Alerts | 50,000 row failures do not create 50,000 alerts. |
| Report | Final report is built from shard summaries and remains traceable to `runId` and `shardId`. |

The one-line plan: deliver a sharded, queue-driven, idempotent batch pipeline with bounded concurrency and aggregate observability, not a language rewrite or platform migration.
