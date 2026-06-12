# WebGPT Review Notes — Capture & Replay and Part 2 Consistency Fix

## Purpose

This document is intended to be used as prompt/context when sending a repomix bundle to WebGPT for a second-pass review.

The goal is not to ask WebGPT to rewrite the whole project. The goal is to review whether our current solutions correctly address the challenge requirements, whether the design assumptions are sound, and whether any edge cases or better minimal fixes were missed.

## Project Context

This repository is a backend interview challenge. It simulates an influencer marketing analysis system with:

- `apps/legacy-app`: NestJS REST API. It creates `AnalysisJob` records and publishes `AnalysisRequested` events.
- `apps/worker-service`: Worker that consumes queued events and writes analysis results back to MongoDB.
- `packages/shared-types`: shared TypeScript types.
- `local-queue/`: local filesystem queue used to simulate AWS SQS.
- `debug-payloads/`: captured payloads and replay/debug samples.
- `solutions/`: written analysis reports required by the challenge.

The current branch contains four logical changes:

1. Startup dependency fix: add missing `@senior-challenge/shared-types` workspace dependencies to the apps.
2. Part 2 consistency fix: prevent delayed quick demographics from overwriting Worker results.
3. Part 1 Capture & Replay: capture Worker input payloads and replay them locally.
4. Part 3 chaos data processing: validate and classify third-party dirty data with Zod plus business rules.

## Part 1: Capture & Replay

### Problem Understanding

The challenge asks for a local "Payload Capture & Replay" mechanism:

- When `CAPTURE_MODE=true`, save each queue message payload to `debug-payloads/`.
- Implement `pnpm run replay -- --file=debug-payloads/job-xxx.json`.
- Replay should directly call the Worker handler, bypassing SQS/local queue.

In this repo, `local-queue/` simulates AWS SQS:

- LegacyApp writes one JSON file per message.
- WorkerService polls the directory.
- Worker parses each JSON file into an `AnalysisRequestedEvent`.
- Worker calls `AnalysisProcessor.process(event)`.

### Design Decision

We capture at the Worker boundary, after reading/parsing the local queue file and before calling `processor.process(event)`.

Rationale:

- It captures the exact input consumed by the Worker.
- It avoids capturing a pre-publish intermediate object from LegacyApp.
- It mirrors the place where a future SQS consumer middleware would sit.
- It keeps replay focused on the Worker processing path.

### Capture Format

We chose an envelope format:

```ts
interface CaptureEnvelope<TPayload = AnalysisRequestedEvent> {
  schemaVersion: 1;
  capturedAt: string;
  source: 'local-queue' | 'sqs' | 'manual';
  messageId: string;
  messageFile?: string;
  attributes?: Record<string, string>;
  rawBody?: unknown;
  payload: TPayload;
}
```

Important distinction:

- `payload` is the actual Worker input used by replay.
- Envelope metadata is debugging context.

We intentionally did not place `CaptureEnvelope` in `packages/shared-types` yet. It is currently a debugging-file format used by Worker/replay, not a cross-service business contract. The shared contract is still `AnalysisRequestedEvent`.

Potential review question:

- Should `CaptureEnvelope` remain local to Worker tooling, or should it move to `shared-types` if future parts/tools reuse it?

### Filename Rule

Current naming rule:

```text
analysis-requested-{jobId}-{timestamp}.json
```

Example sample file added for review/demo:

```text
debug-payloads/analysis-requested-naming-example-20260410-143201000Z.json
```

This file is intentionally allowlisted in `.gitignore` so it can be committed as a stable example.

Potential review question:

- Is this filename rule clear and stable enough, or should it include `source`, `traceId`, or a shorter timestamp format?

### Replay Behavior

Replay script supports both:

```json
{ "payload": { "eventType": "AnalysisRequested", "...": "..." } }
```

and bare payload:

```json
{ "eventType": "AnalysisRequested", "...": "..." }
```

Replay validates the event shape and then calls:

```ts
const processor = new AnalysisProcessor();
await processor.process(event);
```

We also adjusted `AnalysisProcessor` so `process()` waits for MongoDB initialization before processing. This matters more in replay because the script creates a processor and immediately calls `process()`.

Potential review questions:

- Is it acceptable that replay writes to MongoDB like the real Worker does?
- Should replay have a dry-run mode?
- Should replay support overriding `jobId` to avoid mutating the original job?
- Is the `AnalysisProcessor` readiness fix appropriate, or should initialization be explicit instead of constructor-driven?

## Part 2: Delayed Demographics Overwrite

### Problem Understanding

Customer complaint:

- User sees a high-quality report result: `confidence: 0.85`.
- A few seconds later, refresh shows low-quality data: `confidence: 0.3`.

Root cause model:

1. LegacyApp creates a job with quick demographics, fixed low confidence `0.3`.
2. LegacyApp saves the job as `PENDING`.
3. LegacyApp publishes an `AnalysisRequested` event.
4. LegacyApp schedules `setTimeout(..., 2000)` to run `delayedUpdate(jobId, quickDemographics)`.
5. Worker consumes the event, sets status to `PROCESSING`, calls the simulated third-party API, then writes `COMPLETED` results.
6. If Worker writes formal results before the 2 second timer fires, the old quick demographics can overwrite newer Worker demographics.

The key point: we do not know the original business intent of the 2 second delayed update. It may have been intended as a "ensure preliminary data persists" patch. We therefore avoided simply deleting it.

### Design Decision

We kept the delayed update but added a state guard:

```ts
updateJobIfStatus(jobId, 'PENDING', updates)
```

This means:

- If the job is still `PENDING`, LegacyApp may refresh quick demographics.
- If Worker has moved it to `PROCESSING` or `COMPLETED`, LegacyApp no longer overwrites demographics.

The guard is implemented as an atomic MongoDB update filter:

```ts
{ jobId, status: expectedStatus }
```

Rationale:

- Preserves possible business value of delayed quick refresh.
- Prevents stale low-priority writes from overwriting newer Worker results.
- Avoids a separate read-then-write race.

Potential review questions:

- Is `status === 'PENDING'` the correct guard, or should it also check `demographicsSource`, `version`, or `updatedAt`?
- Should Worker updates also use guarded state transitions?
- Should the delayed update be deleted entirely instead of guarded?
- Does this fix fully protect `PENDING -> PROCESSING -> COMPLETED`, or are there remaining race windows?

### TDD Coverage

Added a Jest test in:

```text
apps/legacy-app/test/bug-repro.spec.ts
```

Test flow:

1. Call `createAnalysis()`.
2. Simulate Worker writing `COMPLETED + confidence=0.85` before the timer fires.
3. Advance fake timers by 2000ms.
4. Assert Worker demographics remain unchanged.

Observed before fix:

```text
Expected confidence: 0.85
Received confidence: 0.3
```

Observed after fix:

```text
PASS test/bug-repro.spec.ts
```

Potential review questions:

- Is this test sufficient for the challenge's "TDD red/green" expectation?
- Should there be another test proving delayed update still works while status is `PENDING`?
- Should tests cover `PROCESSING` as well as `COMPLETED`?

## Part 3: Chaos Data Validation and Observability

### Problem Understanding

The incident report says Worker batch processing crashed on third-party API response data, and logs only contained generic messages like `Error happened`.

The raw incident samples are in:

```text
debug-payloads/chaos-data-samples.json
```

The existing Worker code relies on TypeScript assertions such as `data.age as number` and `data.tags as string[]`. These assertions do not convert or validate runtime JSON, so dirty third-party records can either crash later processing or silently produce incorrect demographics.

### Design Decision

We classify records into four categories instead of simple valid/invalid:

```text
valid       - direct use
normalized  - format differs but can be losslessly converted
degraded    - core demographics usable, auxiliary field dropped/warned
rejected    - core fields missing/unparseable or business value impossible
```

Expected result for the provided samples:

```text
Valid: 4
Normalized: 0
Degraded: 2
Rejected: 6
Processed: 6
Skipped: 6
```

Important business decision:

- `record-002` is degraded, not normalized. Its `tags` and `engagementScore` can be losslessly normalized, but `age: "25+"` is an open-ended range. The Worker stores canonical `ageRange: "25-34"` using the lower-bound bucket and logs a warning because this loses information.
- `record-012` is degraded, not rejected. Its `engagementScore: "high"` is not a reliable numeric score, but age/gender/country/tags/email are usable. We keep the core demographics and drop the score rather than inventing a fake numeric value.

### Validation Strategy

We use Zod for the runtime schema boundary:

```ts
const RawChaosRecordSchema = z.object({
  id: z.string(),
  age: z.union([z.number(), z.string()]).nullable().optional(),
  gender: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  tags: z.union([z.array(z.string()), z.string()]).nullable().optional(),
  engagementScore: z.union([z.number(), z.string()]).nullable().optional(),
  email: z.string().nullable().optional(),
});
```

Then custom business rules normalize or reject records:

- age number -> age range
- age strings must resolve to canonical buckets (`under-18`, `18-24`, `25-34`, `35-44`, `45-54`, `55+`)
- open-ended age strings like `25+` -> lower-bound canonical bucket with degraded warning
- tags comma string -> array
- numeric score string -> number
- qualitative score like `high` -> degraded warning
- impossible core values such as `age: -5` -> rejected

Rejected records are written to `failed-records/batch-*.json` with original raw data and field-level reasons.

The same boundary is also applied to the real Worker path now:

- `AnalysisProcessor.transformApiResponse` validates the third-party response with Zod.
- It normalizes age/tags/score before producing `Demographics`.
- It throws `ThirdPartyValidationError` with field-level issues for bad core demographics.
- It logs `analysis_response_degraded` for lossy age mapping and degraded auxiliary fields such as empty `tags` or non-numeric/out-of-range `score`.
- The `process()` catch branch logs a structured `analysis_job_failed` event including `jobId` and `traceId`, then marks the job `FAILED`.
- The Worker writes a production-path dead-letter file to `failed-records/worker-{jobId}-{timestamp}.json`, including the original queue event, third-party response, and validation issues.

The chaos script also validates each record individually. A malformed record shape becomes one rejected row in `failed-records/` instead of aborting the whole batch.

Known residual risk:

- `AnalysisRequestedEvent.dataUrl` can be large. The Worker dead-letter file intentionally stores the original queue event for replay/debugging, so an oversized `dataUrl` could bloat `failed-records/worker-*.json` or create future logging/PII risk if this format is forwarded to centralized observability. This branch documents the risk but does not implement redaction/truncation because the Part 3 scope is focused on third-party response validation, structured logs, and dead-letter capture.
- A production hardening pass could store only `dataUrl` length/hash/scheme/host, or move large payloads to object storage and keep a reference in the failed record.

Potential review questions:

- Is email too strict as a reject condition, or should invalid email become degraded?
- Should empty tags reject, degrade, or only warn?
- Should qualitative engagement labels such as `high` be mapped to a score or left undefined?
- Should Zod transforms be used more heavily, or is keeping business normalization outside the schema clearer?
- Should the validation helpers move into Worker runtime code rather than remaining in `scripts/process-chaos.ts` for the challenge?
- Is the duplicated validation logic between Worker and `process-chaos.ts` acceptable for this challenge, or should it be extracted into a shared Worker utility?
- Is writing one worker dead-letter JSON file per failed job sufficient, or should it use an append-only batch format?
- Should Worker dead-letter files redact or truncate large `dataUrl` values now, or is documenting the risk enough for this challenge?

## Validation Already Run

Commands run locally:

```bash
pnpm --filter legacy-app test -- --runInBand
pnpm --filter legacy-app build
pnpm --filter worker-service build
pnpm run replay -- --file=debug-payloads/analysis-requested-naming-example-20260410-143201000Z.json
pnpm run process:chaos
```

Capture/replay demonstration:

- Without `CAPTURE_MODE`, Worker consumes and completes the job but does not create a capture file.
- With `CAPTURE_MODE=true`, Worker consumes and completes the job and writes a capture envelope to `debug-payloads/`.
- Replay reads the captured envelope and directly calls `AnalysisProcessor.process(payload)`.

## Files WebGPT Should Pay Attention To

Runtime changes:

- `apps/worker-service/src/middleware/capture.middleware.ts`
- `apps/worker-service/src/queue-poller.ts`
- `apps/worker-service/src/processors/analysis.processor.ts`
- `scripts/replay-event.ts`
- `apps/legacy-app/src/analysis/analysis.service.ts`
- `apps/legacy-app/src/shared/database/database.service.ts`
- `scripts/process-chaos.ts`

Tests and config:

- `apps/legacy-app/test/bug-repro.spec.ts`
- `apps/legacy-app/jest.config.js`
- `apps/legacy-app/package.json`
- `pnpm-lock.yaml`

Docs and samples:

- `solutions/part1-replay-tool.md`
- `solutions/part2-analysis.md`
- `solutions/part3-observability.md`
- `debug-payloads/analysis-requested-naming-example-20260410-143201000Z.json`
- `debug-payloads/chaos-data-samples.json`
- `.gitignore`

## Requested Review From WebGPT

Please review the implementation for:

1. Correctness against the challenge requirements.
2. Whether Capture & Replay captures the right boundary and replays the right handler.
3. Whether the capture envelope and filename rule are appropriate.
4. Whether `CaptureEnvelope` should remain local or move to shared types.
5. Whether the Part 2 consistency fix is robust enough.
6. Whether tests adequately prove the bug and the fix.
7. Any risks caused by replay mutating MongoDB.
8. Whether the Part 3 valid/normalized/degraded/rejected classification is reasonable.
9. Whether the Zod + business-rule split is appropriate.
10. Whether the documented `dataUrl` size/redaction risk should be implemented now.
11. Any simpler or more idiomatic TypeScript/NestJS approach that would better fit this codebase.

Please avoid broad rewrites unless they are necessary. Prefer minimal, challenge-appropriate changes with clear validation.
