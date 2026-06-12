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

The current branch contains three logical changes:

1. Startup dependency fix: add missing `@senior-challenge/shared-types` workspace dependencies to the apps.
2. Part 2 consistency fix: prevent delayed quick demographics from overwriting Worker results.
3. Part 1 Capture & Replay: capture Worker input payloads and replay them locally.

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

## Validation Already Run

Commands run locally:

```bash
pnpm --filter legacy-app test -- --runInBand
pnpm --filter legacy-app build
pnpm --filter worker-service build
pnpm run replay -- --file=debug-payloads/analysis-requested-naming-example-20260410-143201000Z.json
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

Tests and config:

- `apps/legacy-app/test/bug-repro.spec.ts`
- `apps/legacy-app/jest.config.js`
- `apps/legacy-app/package.json`
- `pnpm-lock.yaml`

Docs and samples:

- `solutions/part1-replay-tool.md`
- `solutions/part2-analysis.md`
- `debug-payloads/analysis-requested-naming-example-20260410-143201000Z.json`
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
8. Any simpler or more idiomatic TypeScript/NestJS approach that would better fit this codebase.

Please avoid broad rewrites unless they are necessary. Prefer minimal, challenge-appropriate changes with clear validation.
