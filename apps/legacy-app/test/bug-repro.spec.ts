/**
 * Bug Reproduction / Characterization Test — support ticket #4521
 *
 * Symptom: a job's full demographics (computed asynchronously by the Worker) are
 * silently replaced ~2s later by the stale "quick" pre-compute that the gateway
 * generated at create time. The Worker's real result is overwritten.
 *
 * Root cause: `AnalysisService.createAnalysis` schedules a `setTimeout(2000)` ->
 * `delayedUpdate(jobId, quickDemographics)` that writes the *original* random
 * pre-compute back onto the job, clobbering whatever the Worker has since written.
 *
 * This test characterizes the CORRECT behavior: once the Worker has written the
 * full result, no delayed pre-compute write may overwrite it.
 *   - BEFORE the fix  -> RED  (the delayed callback overwrites the worker result)
 *   - AFTER  the fix  -> GREEN (worker result preserved)
 *
 * Runner-agnostic: no jest / @nestjs/testing dependency. The service constructor
 * takes its two collaborators directly, so we instantiate it with hand-rolled
 * mocks and run under `tsx` (see `pnpm --filter legacy-app test:bug-repro`).
 */
import assert from 'node:assert';
import { AnalysisService } from '../src/analysis/analysis.service';
import type { AnalysisJob, Demographics } from '@senior-challenge/shared-types';

// ---- Minimal in-memory mock of DatabaseService -----------------------------
class MockDatabaseService {
    public store = new Map<string, AnalysisJob>();
    async saveJob(job: AnalysisJob): Promise<void> {
        this.store.set(job.jobId, { ...job });
    }
    async findJobById(jobId: string): Promise<AnalysisJob | null> {
        return this.store.get(jobId) ?? null;
    }
    async updateJob(jobId: string, updates: Partial<AnalysisJob>): Promise<void> {
        const cur = this.store.get(jobId);
        if (cur) this.store.set(jobId, { ...cur, ...updates });
    }
}

// ---- Minimal mock of MessageQueueService -----------------------------------
class MockMessageQueueService {
    public published: unknown[] = [];
    async publishEvent(event: unknown): Promise<void> {
        this.published.push(event);
    }
}

const WORKER_RESULT: Demographics = {
    ageRange: '25-34',
    gender: 'female',
    location: 'US',
    interests: ['fashion', 'travel'],
    confidence: 0.85,
};

async function run(): Promise<void> {
    const db = new MockDatabaseService();
    const mq = new MockMessageQueueService();

    // Capture (do not execute) any timer the service schedules, so the test is
    // deterministic and does not wait 2 real seconds.
    const realSetTimeout = globalThis.setTimeout;
    const scheduled: Array<() => unknown> = [];
    (globalThis as any).setTimeout = (fn: () => unknown, _ms?: number) => {
        scheduled.push(fn);
        return 0 as unknown as ReturnType<typeof realSetTimeout>;
    };

    try {
        const service = new AnalysisService(db as any, mq as any);

        // 1. Gateway creates the job (writes random "quick" pre-compute, publishes event).
        const job = await service.createAnalysis({ userId: 'acme-user', dataUrl: 's3://acme/file.csv' } as any);
        assert.ok(mq.published.length === 1, 'an AnalysisRequested event should be published');

        // 2. The Worker finishes and writes the REAL demographics.
        await db.updateJob(job.jobId, { status: 'COMPLETED', demographics: WORKER_RESULT });

        // 3. ~2s later any delayed pre-compute write fires.
        for (const fn of scheduled) await fn();

        // 4. The worker's real result must survive.
        const finalJob = await db.findJobById(job.jobId);
        assert.ok(finalJob, 'job should exist');
        assert.deepStrictEqual(
            finalJob!.demographics,
            WORKER_RESULT,
            `Worker demographics were overwritten by stale pre-compute. ` +
            `Got: ${JSON.stringify(finalJob!.demographics)}`,
        );
        assert.strictEqual(finalJob!.status, 'COMPLETED', 'status should remain COMPLETED');
    } finally {
        (globalThis as any).setTimeout = realSetTimeout;
    }
}

run()
    .then(() => {
        console.log('✅ PASS: worker demographics are preserved (no stale overwrite)');
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ FAIL:', err instanceof Error ? err.message : err);
        process.exit(1);
    });
