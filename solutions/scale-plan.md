# Scale Plan Under Constraints

## 1. Throughput target

- Rows:
- Deadline:
- Current throughput:
- Required throughput:
- Safety factor:

## 2. Smallest architecture change

```text
S3 upload
  -> ...
```

## 3. Work partitioning and idempotency

- Shard key:
- Job identity:
- Idempotency key:
- Retry policy:
- Dead-letter policy:

## 4. Concurrency and backpressure

- Worker count:
- Per-provider concurrency cap:
- Queue visibility / lease:
- Rate-limit handling:

## 5. Debuggability without alert floods

- Error sampling:
- Failure buckets:
- Representative payload capture:
- Alert thresholds:
- Operator dashboard:

## 6. What not to rebuild in two weeks

- 
- 
- 

## 7. Degrade / rollback plan

- If behind schedule:
- If provider is degraded:
- If bad data rate spikes:
- If billing/usage confidence is low:
