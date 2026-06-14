# Surgical Refactor Plan

> Complete before touching messy hot-path code.

## 1. Target

- File: `apps/legacy-app/src/analysis/analysis.service.ts`
- Function / class: `AnalysisService.delayedUpdate`
- Why this is in scope: the delayed preliminary demographics refresh can race with the worker's completed result and overwrite newer, more authoritative analysis data.

Related safety fixes in the same hot path:

- `apps/legacy-app/src/shared/database/database.service.ts`: add conditional status update support.
- `apps/worker-service/src/processors/analysis.processor.ts`: reject after failed provider processing so the queue can retry instead of treating the message as successful.
- `apps/worker-service/src/queue-poller.ts`: expose `pollOnce` and delete a message only after successful processing.
- `apps/worker-service/src/audience-integration/facade-audience.service.ts`: delegate response-shape handling to one mapper.

## 2. Current responsibility leak

The legacy app writes preliminary demographics and schedules a delayed refresh, while the worker later writes final demographics. The preliminary writer had no state guard, so it could update a job after the worker had already completed it. The queue poller also treated a processor call as successful whenever the promise resolved, while the processor swallowed provider failures after marking the job failed.

The smallest safe fix is to make state transitions explicit:

- preliminary updates only apply to jobs still in `PENDING`
- processor failures reject after marking the job `FAILED`
- queue messages are acknowledged / deleted only after successful processing

## 3. Characterization test

- Existing behavior to lock: pending jobs may still receive preliminary demographic refreshes.
- New behavior to protect: completed worker results must not be overwritten by stale preliminary refreshes.
- Test file: `apps/legacy-app/test/analysis.service.test.ts`
- Expected failure mode if behavior changes accidentally: a completed job's high-confidence worker demographics are replaced by low-confidence quick demographics.

Additional tests:

- `apps/worker-service/test/analysis.processor.test.ts`: provider failure marks job failed and rejects so the queue can retry.
- `apps/worker-service/test/queue-poller.test.ts`: successful messages are deleted; failed messages are retained.
- `apps/worker-service/test/audience-response.mapper.test.ts`: standard and legacy third-party audience payloads normalize to the same internal shape.

## 4. Extraction boundary

- Extracted helper / function: `extractAudiencePayload`
- Inputs: unknown third-party audience API response
- Outputs: normalized audience payload with `gender`, `age`, and/or `geography`, or `null`
- Side effects: none
- Why this is the smallest safe boundary: the facade still owns Playwright, auth, HTTP request, and logging; the helper only handles provider response-shape drift.

No helper was extracted for the delayed update because a single conditional database update is the smallest safe boundary. No new queue framework was introduced because the local file queue is a simulation, and replacing it with SQS/Redis is outside the current code-change scope.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Replace the local queue with SQS/Redis now | Correct production direction, but too broad for this scoped fix and would require infrastructure not present in the repo. |
| Rewrite the worker into a full batch-processing framework | The scale plan belongs in `solutions/scale-plan.md`; current code change only needs to prevent known unsafe behavior. |
| Add a billing ledger/refund subsystem | The repository has no wallet/ledger implementation; inventing one would violate the source-of-truth decision. |
| Collapse API and worker into one synchronous flow | This would remove the async architecture the challenge is modeling and would not address release/batch concerns. |

## 6. Verification

- Tests run: `pnpm --filter legacy-app test`
- Result: 2 tests passed.
- Tests run: `pnpm --filter worker-service test`
- Result: 6 tests passed.
- Tests run: `pnpm -r test`
- Result: 8 tests passed across legacy-app and worker-service.
- Build run: `pnpm run build`
- Result: shared-types, legacy-app, and worker-service built successfully.
- Remaining risk: the local file queue is still a development simulation and is not safe as a production multi-consumer queue. Production scale still requires the queue design in the spec.
