import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob, AnalysisStatus, Demographics } from '@senior-challenge/shared-types';

type DelayedUpdateCapable = {
    delayedUpdate(jobId: string, demographics: Demographics): Promise<void>;
};

class InMemoryDatabase {
    readonly jobs = new Map<string, AnalysisJob>();

    async saveJob(job: AnalysisJob): Promise<void> {
        this.jobs.set(job.jobId, { ...job });
    }

    async findJobById(jobId: string): Promise<AnalysisJob | null> {
        return this.jobs.get(jobId) ?? null;
    }

    async updateJob(jobId: string, updates: Partial<AnalysisJob>): Promise<void> {
        const current = this.jobs.get(jobId);
        if (!current) return;
        this.jobs.set(jobId, { ...current, ...updates });
    }

    async updateJobIfStatus(
        jobId: string,
        allowedStatuses: readonly AnalysisStatus[],
        updates: Partial<AnalysisJob>,
    ): Promise<boolean> {
        const current = this.jobs.get(jobId);
        if (!current || !allowedStatuses.includes(current.status)) {
            return false;
        }

        this.jobs.set(jobId, { ...current, ...updates });
        return true;
    }
}

class InMemoryQueue {
    readonly events: unknown[] = [];

    async publishEvent(event: unknown): Promise<void> {
        this.events.push(event);
    }
}

function createService(database: InMemoryDatabase): AnalysisService {
    return new AnalysisService(
        database as unknown as DatabaseService,
        new InMemoryQueue() as unknown as MessageQueueService,
    );
}

test('delayed preliminary update does not overwrite a completed worker result', async () => {
    const database = new InMemoryDatabase();
    const service = createService(database) as unknown as DelayedUpdateCapable;
    const completedDemographics: Demographics = {
        ageRange: '25-34',
        gender: 'female',
        location: 'US',
        confidence: 0.95,
    };
    const staleDemographics: Demographics = {
        ageRange: '18-24',
        gender: 'other',
        location: 'CA',
        confidence: 0.3,
    };

    await database.saveJob({
        jobId: 'job-completed',
        userId: 'user-1',
        dataUrl: 'https://example.com/data.csv',
        status: 'COMPLETED',
        demographics: completedDemographics,
        createdAt: '2026-06-14T10:00:00.000Z',
        updatedAt: '2026-06-14T10:01:00.000Z',
        completedAt: '2026-06-14T10:01:00.000Z',
    });

    await service.delayedUpdate('job-completed', staleDemographics);

    const job = await database.findJobById('job-completed');
    assert.deepEqual(job?.demographics, completedDemographics);
    assert.equal(job?.status, 'COMPLETED');
});

test('delayed preliminary update can refresh a still-pending job', async () => {
    const database = new InMemoryDatabase();
    const service = createService(database) as unknown as DelayedUpdateCapable;
    const refreshedDemographics: Demographics = {
        ageRange: '35-44',
        gender: 'male',
        location: 'UK',
        confidence: 0.3,
    };

    await database.saveJob({
        jobId: 'job-pending',
        userId: 'user-2',
        dataUrl: 'https://example.com/data.csv',
        status: 'PENDING',
        demographics: { confidence: 0.1 },
        createdAt: '2026-06-14T10:00:00.000Z',
        updatedAt: '2026-06-14T10:00:00.000Z',
    });

    await service.delayedUpdate('job-pending', refreshedDemographics);

    const job = await database.findJobById('job-pending');
    assert.deepEqual(job?.demographics, refreshedDemographics);
    assert.equal(job?.status, 'PENDING');
});
