import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob } from '@senior-challenge/shared-types';

/**
 * Bug Reproduction Test Suite
 *
 * Write automated tests here to reproduce and verify the data inconsistency
 * reported in customer support ticket #4521.
 */
describe('Data Consistency (Bug Repro)', () => {
  let service: AnalysisService;
  let savedJob: AnalysisJob | null;
  let databaseService: {
    saveJob: jest.Mock;
    findJobById: jest.Mock;
    updateJob: jest.Mock;
    updateJobIfStatus: jest.Mock;
  };
  let messageQueueService: {
    publishEvent: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    savedJob = null;
    databaseService = {
      saveJob: jest.fn(async (job: AnalysisJob) => {
        savedJob = { ...job, demographics: { ...job.demographics } };
      }),
      findJobById: jest.fn(async () => savedJob),
      updateJob: jest.fn(async (_jobId: string, updates: Partial<AnalysisJob>) => {
        if (!savedJob) return;
        savedJob = {
          ...savedJob,
          ...updates,
          demographics: updates.demographics
            ? { ...updates.demographics }
            : savedJob.demographics,
        };
      }),
      updateJobIfStatus: jest.fn(async (_jobId: string, expectedStatus: string, updates: Partial<AnalysisJob>) => {
        if (!savedJob || savedJob.status !== expectedStatus) return false;
        savedJob = {
          ...savedJob,
          ...updates,
          demographics: updates.demographics
            ? { ...updates.demographics }
            : savedJob.demographics,
        };
        return true;
      }),
    };
    messageQueueService = {
      publishEvent: jest.fn(async () => undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
        {
          provide: MessageQueueService,
          useValue: messageQueueService,
        },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not let delayed quick demographics overwrite a completed worker result', async () => {
    await service.createAnalysis({
      userId: 'user-8827',
      dataUrl: 'https://example.com/data.json',
    });

    expect(savedJob).not.toBeNull();
    const jobId = savedJob!.jobId;

    const workerResult = {
      ageRange: '25-34',
      gender: 'female',
      location: 'US',
      confidence: 0.85,
    };

    savedJob = {
      ...savedJob!,
      jobId,
      status: 'COMPLETED',
      demographics: workerResult,
      updatedAt: new Date('2026-04-10T14:32:02.000Z').toISOString(),
      completedAt: new Date('2026-04-10T14:32:02.000Z').toISOString(),
    };

    await jest.advanceTimersByTimeAsync(2000);

    expect(savedJob?.status).toBe('COMPLETED');
    expect(savedJob?.demographics).toEqual(workerResult);
    expect(databaseService.updateJobIfStatus).toHaveBeenCalledWith(
      jobId,
      'PENDING',
      expect.objectContaining({
        demographics: expect.objectContaining({ confidence: 0.3 }),
      }),
    );
  });
});
