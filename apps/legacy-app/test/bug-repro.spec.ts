import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob, AnalysisRequestedEvent, Demographics } from '@senior-challenge/shared-types';

/**
 * Bug Reproduction Test Suite — customer support ticket #4521 ("data overwrite issue").
 *
 * Root cause under test: AnalysisService.createAnalysis schedules a fire-and-forget
 * setTimeout(2000) that re-persists the stale quick demographics with an unconditional
 * update. If the worker completes the real analysis inside that window, the worker's
 * results are silently overwritten by placeholder data.
 *
 * Structure:
 *  - "characterization" block locks the existing public behavior (must pass before
 *    AND after the fix).
 *  - "regression" block reproduces #4521 (red before the fix, green after).
 *
 * The in-memory store emulates the Mongo update semantics the app relies on:
 *  - saveJob: upsert
 *  - updateJob: unconditional $set (legacy behavior)
 *  - updateJobIfPending: $set guarded by filter { jobId, status: 'PENDING' } (the fix)
 * so the tests exercise store-level behavior rather than spying on call names.
 */

class InMemoryJobStore {
    readonly jobs = new Map<string, AnalysisJob>();
    saveJobCalls = 0;

    async saveJob(job: AnalysisJob): Promise<void> {
        this.saveJobCalls += 1;
        this.jobs.set(job.jobId, { ...job });
    }

    async findJobById(jobId: string): Promise<AnalysisJob | null> {
        return this.jobs.get(jobId) ?? null;
    }

    async updateJob(jobId: string, updates: Partial<AnalysisJob>): Promise<void> {
        const existing = this.jobs.get(jobId);
        if (!existing) {
            return;
        }
        this.jobs.set(jobId, { ...existing, ...updates, updatedAt: new Date().toISOString() });
    }

    async updateJobIfPending(jobId: string, updates: Partial<AnalysisJob>): Promise<void> {
        const existing = this.jobs.get(jobId);
        if (!existing || existing.status !== 'PENDING') {
            return;
        }
        this.jobs.set(jobId, { ...existing, ...updates, updatedAt: new Date().toISOString() });
    }
}

class RecordingQueue {
    readonly events: AnalysisRequestedEvent[] = [];

    async publishEvent(event: AnalysisRequestedEvent): Promise<void> {
        this.events.push(event);
    }
}

async function flushAsync(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
}

describe('Data Consistency (Bug Repro)', () => {
    let service: AnalysisService;
    let store: InMemoryJobStore;
    let queue: RecordingQueue;

    beforeEach(async () => {
        jest.useFakeTimers();
        store = new InMemoryJobStore();
        queue = new RecordingQueue();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AnalysisService,
                {
                    provide: DatabaseService,
                    useValue: store,
                },
                {
                    provide: MessageQueueService,
                    useValue: queue,
                },
            ],
        }).compile();

        service = module.get<AnalysisService>(AnalysisService);
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    describe('characterization — existing public behavior locked before any change', () => {
        it('returns a PENDING job with quick demographics and persists it exactly once', async () => {
            const job = await service.createAnalysis({ userId: 'user-1', dataUrl: 'https://example.com/data.csv' });

            expect(job.status).toBe('PENDING');
            expect(['18-24', '25-34', '35-44', '45-54']).toContain(job.demographics?.ageRange);
            expect(['male', 'female', 'other']).toContain(job.demographics?.gender);
            expect(['US', 'UK', 'CA', 'AU']).toContain(job.demographics?.location);
            expect(job.demographics?.confidence).toBe(0.3);

            expect(store.saveJobCalls).toBe(1);
            expect(store.jobs.get(job.jobId)).toMatchObject({ status: 'PENDING', userId: 'user-1' });
        });

        it('publishes exactly one AnalysisRequested event matching the job', async () => {
            const job = await service.createAnalysis({ userId: 'user-2', dataUrl: 'https://example.com/d2.csv' });

            expect(queue.events).toHaveLength(1);
            expect(queue.events[0]).toMatchObject({
                eventType: 'AnalysisRequested',
                jobId: job.jobId,
                userId: 'user-2',
                dataUrl: 'https://example.com/d2.csv',
            });
        });

        it('still refreshes a job that remains PENDING when the delayed update fires', async () => {
            const job = await service.createAnalysis({ userId: 'user-3', dataUrl: 'https://example.com/d3.csv' });
            const before = store.jobs.get(job.jobId)!;

            jest.advanceTimersByTime(2000);
            await flushAsync();

            const after = store.jobs.get(job.jobId)!;
            expect(after.status).toBe('PENDING');
            expect(after.demographics).toEqual(before.demographics);
        });
    });

    describe('regression — ticket #4521: delayed refresh must not clobber worker results', () => {
        it('preserves COMPLETED worker results when the 2s delayed update fires afterwards', async () => {
            const job = await service.createAnalysis({ userId: 'user-4', dataUrl: 'https://example.com/d4.csv' });

            // Worker completes the real analysis inside the 2-second window:
            const workerResults: Demographics = {
                ageRange: '25-34',
                gender: 'female',
                location: 'US',
                interests: ['fashion', 'travel'],
                confidence: 0.85,
            };
            const current = store.jobs.get(job.jobId)!;
            store.jobs.set(job.jobId, {
                ...current,
                status: 'COMPLETED',
                demographics: workerResults,
                completedAt: new Date().toISOString(),
            });

            // The legacy fire-and-forget refresh fires:
            jest.advanceTimersByTime(2000);
            await flushAsync();

            const final = store.jobs.get(job.jobId)!;
            expect(final.status).toBe('COMPLETED');
            expect(final.demographics).toEqual(workerResults);
        });
    });
});
