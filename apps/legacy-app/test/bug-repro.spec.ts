import { AnalysisService } from '../src/analysis/analysis.service';

/**
 * Bug Reproduction / Characterization Test — ticket #4521 ("data overwrite").
 *
 * Root cause: createAnalysis used to schedule a delayed setTimeout that re-wrote
 * the job with the stale pre-computed placeholder, racing with and overwriting the
 * worker's COMPLETED result (last-write-wins lost update).
 *
 * These tests lock the correct behavior: the request path persists exactly once and
 * publishes exactly once, and NO delayed write fires to clobber the worker result.
 * If the racy setTimeout is reintroduced, the second test fails.
 */
describe('Data Consistency (Bug Repro): single writer for job results', () => {
    let saveJob: jest.Mock;
    let updateJob: jest.Mock;
    let publishEvent: jest.Mock;
    let service: AnalysisService;

    beforeEach(() => {
        jest.useFakeTimers();
        saveJob = jest.fn().mockResolvedValue(undefined);
        updateJob = jest.fn().mockResolvedValue(undefined);
        publishEvent = jest.fn().mockResolvedValue(undefined);

        const databaseService = { saveJob, updateJob, findJobById: jest.fn() } as any;
        const messageQueueService = { publishEvent } as any;
        service = new AnalysisService(databaseService, messageQueueService);
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('persists the job once and publishes the analysis event once', async () => {
        const job = await service.createAnalysis({ userId: 'u1', dataUrl: 'http://data/1' } as any);

        expect(saveJob).toHaveBeenCalledTimes(1);
        expect(publishEvent).toHaveBeenCalledTimes(1);
        expect(job.status).toBe('PENDING');
    });

    it('does NOT schedule a delayed write that overwrites the worker result (#4521)', async () => {
        await service.createAnalysis({ userId: 'u1', dataUrl: 'http://data/1' } as any);

        // Simulate the worker having already written the real, COMPLETED demographics.
        updateJob.mockClear();

        // Advance well past the old 2000ms delayed-overwrite window.
        jest.advanceTimersByTime(5000);
        await Promise.resolve();

        // After the fix there is no stale delayedUpdate clobbering the job.
        expect(updateJob).not.toHaveBeenCalled();
    });
});
