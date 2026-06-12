import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob } from '@senior-challenge/shared-types';

/**
 * Characterization tests for customer support ticket #4521 — the delayed
 * preliminary refresh overwriting the Worker's final results (lost update).
 *
 * RED before the fix:
 *  - DatabaseService had no `updateJobIfPending`, so test 1 and 2 fail to compile/run.
 *  - AnalysisService.delayedUpdate called the unguarded `updateJob`, so test 3 fails.
 * GREEN after the fix: the delayed refresh is routed through a status-guarded
 * atomic update that is a no-op once the job has progressed past PENDING.
 */
describe('Data Consistency (Bug Repro #4521)', () => {
    describe('DatabaseService.updateJobIfPending (status-guarded atomic update)', () => {
        function buildServiceWithFakeCollection(modifiedCount: number) {
            const updateOne = jest.fn().mockResolvedValue({ modifiedCount });
            const service = new DatabaseService();
            (service as unknown as { connection: unknown }).connection = {
                collection: () => ({ updateOne }),
            };
            return { service, updateOne };
        }

        it('puts the PENDING status guard inside the atomic update filter', async () => {
            const { service, updateOne } = buildServiceWithFakeCollection(1);

            await service.updateJobIfPending('job-1', { demographics: { confidence: 0.3 } });

            expect(updateOne).toHaveBeenCalledTimes(1);
            const [filter] = updateOne.mock.calls[0];
            expect(filter).toEqual({ jobId: 'job-1', status: 'PENDING' });
        });

        it('is a no-op (returns false) once the job is no longer PENDING', async () => {
            // modifiedCount 0 means the filter { jobId, status: 'PENDING' } matched
            // nothing because the Worker already moved the job to COMPLETED.
            const { service } = buildServiceWithFakeCollection(0);

            const applied = await service.updateJobIfPending('job-1', { demographics: { confidence: 0.3 } });

            expect(applied).toBe(false);
        });
    });

    describe('AnalysisService delayed refresh', () => {
        const dto = { userId: 'user-1', dataUrl: 'https://example.com/data.csv' };

        beforeEach(() => {
            // Fake timers so the 2s delayed-refresh setTimeout never leaks a real
            // open handle between tests; cleared after each test.
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        function buildAnalysisService() {
            const saveJob = jest.fn().mockResolvedValue(undefined);
            const updateJob = jest.fn().mockResolvedValue(undefined);
            const updateJobIfPending = jest.fn().mockResolvedValue(true);
            const publishEvent = jest.fn().mockResolvedValue(undefined);

            const databaseService = { saveJob, updateJob, updateJobIfPending } as unknown as DatabaseService;
            const messageQueueService = { publishEvent } as unknown as MessageQueueService;
            const service = new AnalysisService(databaseService, messageQueueService);
            return { service, saveJob, updateJob, updateJobIfPending, publishEvent };
        }

        it('persists a PENDING job and publishes an event on creation', async () => {
            const { service, saveJob, publishEvent } = buildAnalysisService();

            const job: AnalysisJob = await service.createAnalysis(dto);

            expect(job.status).toBe('PENDING');
            expect(saveJob).toHaveBeenCalledTimes(1);
            expect(saveJob.mock.calls[0][0]).toMatchObject({ status: 'PENDING', userId: 'user-1' });
            expect(publishEvent).toHaveBeenCalledTimes(1);
        });

        it('routes the delayed refresh through the guarded helper, never the unguarded updateJob', async () => {
            const { service, updateJob, updateJobIfPending } = buildAnalysisService();

            await service.createAnalysis(dto);
            await jest.advanceTimersByTimeAsync(2000);

            expect(updateJobIfPending).toHaveBeenCalledTimes(1);
            expect(updateJob).not.toHaveBeenCalled();
        });
    });
});
