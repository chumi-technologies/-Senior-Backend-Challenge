# Test Evidence

## 2026-06-14 — Scoped code changes

### Commands

```bash
pnpm --filter legacy-app test
pnpm --filter worker-service test
pnpm -r test
pnpm run build
```

### Results

- `legacy-app`: 2 Node test-runner tests passed.
- `worker-service`: 6 Node test-runner tests passed.
- Workspace tests: 8 total tests passed.
- Build: `packages/shared-types`, `apps/legacy-app`, and `apps/worker-service` built successfully.

### Coverage Intent

- `AnalysisService.delayedUpdate` no longer overwrites completed worker results.
- Pending analysis jobs still allow preliminary demographics refresh.
- `AnalysisProcessor.process` marks failed provider processing as `FAILED` and rejects so the queue can retry.
- `QueuePoller.pollOnce` deletes a message only after successful processing and retains failed messages.
- `extractAudiencePayload` handles both standard and legacy third-party audience payload shapes.

### Notes

- The first sandboxed `pnpm install` and `tsx --test` attempts failed because network and IPC pipe creation were restricted. The same commands succeeded with approved escalation.
- `pnpm run verify:submission` has not been used as a final gate yet because several required solution artifacts still need to be filled.
