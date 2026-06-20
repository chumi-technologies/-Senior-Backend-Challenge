import { AnalysisService } from '../src/analysis/analysis.service';
import type { DatabaseService } from '../src/shared/database/database.service';
import type { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob, Demographics } from '@senior-challenge/shared-types';

/**
 * Characterization tests for support ticket #4521 — "data inconsistency / overwrite".
 *
 * Root cause: `createAnalysis` used to schedule a `setTimeout` that re-persisted the
 * stale PRELIMINARY demographics (confidence 0.3) ~2s after the job was created. That
 * background write raced the worker pipeline (the single writer of final demographics)
 * and could overwrite the real COMPLETED result with the preliminary estimate.
 *
 * These tests lock the corrected contract:
 *   1. The request path writes the job exactly once (the initial seed) and performs no
 *      demographics write after publishing the AnalysisRequested event.
 *   2. A worker-written COMPLETED result is never clobbered by the request path.
 *
 * The tests use lightweight in-memory fakes so they need neither MongoDB nor Nest DI.
 */
describe('Data Consistency (Bug Repro #4521)', () => {
  type Store = Map<string, AnalysisJob>;

  function makeFakeDb(store: Store) {
    return {
      saveJob: jest.fn(async (job: AnalysisJob) => {
        store.set(job.jobId, { ...job });
      }),
      findJobById: jest.fn(async (jobId: string) => store.get(jobId) ?? null),
      updateJob: jest.fn(async (jobId: string, updates: Partial<AnalysisJob>) => {
        const current = store.get(jobId);
        if (current) store.set(jobId, { ...current, ...updates });
      }),
    } as unknown as DatabaseService & { saveJob: jest.Mock; updateJob: jest.Mock };
  }

  function makeFakeQueue() {
    return {
      publishEvent: jest.fn(async () => undefined),
    } as unknown as MessageQueueService & { publishEvent: jest.Mock };
  }

  const realWorkerResult: Demographics = {
    ageRange: '25-34',
    gender: 'female',
    location: 'US',
    interests: ['fashion', 'travel'],
    confidence: 0.85, // high-confidence, authoritative worker output
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('writes the job exactly once and performs no demographics write after publishing', async () => {
    const store: Store = new Map();
    const db = makeFakeDb(store);
    const queue = makeFakeQueue();
    const service = new AnalysisService(db as any, queue as any);

    const job = await service.createAnalysis({ userId: 'acme-user', dataUrl: 'https://x/d.csv' } as any);

    // Initial seed persisted once.
    expect(db.saveJob).toHaveBeenCalledTimes(1);
    expect(queue.publishEvent).toHaveBeenCalledTimes(1);

    // Advance well past the legacy 2s timer window.
    jest.advanceTimersByTime(5000);
    await Promise.resolve();

    // The request path must never re-write demographics after publishing.
    expect(db.updateJob).not.toHaveBeenCalled();
    expect(store.get(job.jobId)?.status).toBe('PENDING');
  });

  it('does not overwrite a worker-written COMPLETED result with stale preliminary data', async () => {
    const store: Store = new Map();
    const db = makeFakeDb(store);
    const queue = makeFakeQueue();
    const service = new AnalysisService(db as any, queue as any);

    const job = await service.createAnalysis({ userId: 'acme-user', dataUrl: 'https://x/d.csv' } as any);

    // Simulate the worker completing within the old race window.
    await db.updateJob(job.jobId, {
      status: 'COMPLETED',
      demographics: realWorkerResult,
      completedAt: new Date().toISOString(),
    });
    const workerUpdateCalls = (db.updateJob as jest.Mock).mock.calls.length;

    // Advance past the legacy 2s delayed-update window.
    jest.advanceTimersByTime(5000);
    await Promise.resolve();

    // No additional write from the request path; worker result survives intact.
    expect((db.updateJob as jest.Mock).mock.calls.length).toBe(workerUpdateCalls);
    const persisted = store.get(job.jobId);
    expect(persisted?.status).toBe('COMPLETED');
    expect(persisted?.demographics?.confidence).toBe(0.85);
    expect(persisted?.demographics).toEqual(realWorkerResult);
  });
});
