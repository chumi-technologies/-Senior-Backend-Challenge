import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob, AnalysisRequestedEvent, Demographics } from '@senior-challenge/shared-types';

/**
 * Bug Reproduction Test Suite
 *
 * Write automated tests here to reproduce and verify the data inconsistency
 * reported in customer support ticket #4521.
 */
describe('Data Consistency (Bug Repro)', () => {
  let service: AnalysisService;
  let savedJob: AnalysisJob;
  let databaseService: jest.Mocked<Pick<DatabaseService, 'saveJob' | 'findJobById' | 'updateJobIfStatus'>>;
  let messageQueueService: jest.Mocked<Pick<MessageQueueService, 'publishEvent'>>;

  beforeEach(() => {
    jest.useFakeTimers();

    databaseService = {
      saveJob: jest.fn(async (job: AnalysisJob) => {
        savedJob = { ...job };
      }),
      findJobById: jest.fn(async (_jobId: string) => savedJob),
      updateJobIfStatus: jest.fn(async (jobId, expectedStatus, updates) => {
        if (savedJob.jobId !== jobId || savedJob.status !== expectedStatus) {
          return false;
        }

        savedJob = {
          ...savedJob,
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        return true;
      }),
    };

    messageQueueService = {
      publishEvent: jest.fn(async (_event: AnalysisRequestedEvent) => undefined),
    };

    service = new AnalysisService(
      databaseService as unknown as DatabaseService,
      messageQueueService as unknown as MessageQueueService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not let the delayed quick refresh overwrite completed worker demographics', async () => {
    await service.createAnalysis({
      userId: 'user-4521',
      dataUrl: 's3://analysis-inputs/customer-4521.json',
    });

    const workerDemographics: Demographics = {
      ageRange: '25-34',
      gender: 'female',
      location: 'US',
      interests: ['fashion', 'travel'],
      confidence: 0.85,
    };

    savedJob = {
      ...savedJob,
      status: 'COMPLETED',
      demographics: workerDemographics,
      completedAt: new Date().toISOString(),
    };

    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(databaseService.updateJobIfStatus).toHaveBeenCalledWith(
      savedJob.jobId,
      'PENDING',
      expect.objectContaining({ demographics: expect.any(Object) }),
    );
    expect(savedJob.status).toBe('COMPLETED');
    expect(savedJob.demographics).toEqual(workerDemographics);
  });
});

describe('DatabaseService conditional updates', () => {
  it('uses job status in the MongoDB update predicate', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
    const service = new DatabaseService();

    (service as unknown as { connection: { collection: jest.Mock } }).connection = {
      collection: jest.fn(() => ({ updateOne })),
    };

    await expect(
      service.updateJobIfStatus('job-123', 'PENDING', {
        demographics: { confidence: 0.3 },
      }),
    ).resolves.toBe(true);

    expect(updateOne).toHaveBeenCalledWith(
      { jobId: 'job-123', status: 'PENDING' },
      {
        $set: expect.objectContaining({
          demographics: { confidence: 0.3 },
          updatedAt: expect.any(String),
        }),
      },
    );
  });
});
