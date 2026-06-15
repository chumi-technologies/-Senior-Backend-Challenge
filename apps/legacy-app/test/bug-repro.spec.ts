import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob, Demographics } from '@senior-challenge/shared-types';

/**
 * Bug Reproduction Test Suite — Ticket #4521
 *
 * Customer support reported that high-confidence Worker results are
 * intermittently overwritten with low-confidence quick-demographics.
 *
 * Original bug timeline:
 *   T+0ms     createAnalysis()  -> saveJob(quickDemographics, status=PENDING)
 *   T+~1000ms Worker            -> updateJob(highConfidence, status=COMPLETED)
 *   T+2000ms  delayedUpdate()   -> updateJob(quickDemographics)  // overwrite
 *
 * The original first-attempt fix used a read-then-write pattern:
 *   findJobById(jobId)
 *   if (job.status === 'COMPLETED') return
 *   updateJob(jobId, {...})
 *
 * That fix is INCORRECT under concurrency. Between `findJobById` and
 * `updateJob`, the Worker can transition the job to COMPLETED, and the
 * unconditional `updateJob` will still overwrite the COMPLETED state.
 * This is a textbook TOCTOU (time-of-check / time-of-use) race.
 *
 * The correct fix is a single atomic conditional update:
 *   updateOne({ jobId, status: { $ne: 'COMPLETED' } }, { $set: ... })
 *
 * The database itself decides whether to write, so no interleaving exists.
 *
 * These tests exercise the in-memory mock equivalent of that atomic
 * conditional update via `updateJobIfNotCompleted`.
 */
describe('Data Consistency (Bug Repro — Ticket #4521, atomic update)', () => {
  let service: AnalysisService;
  let mockDb: { jobs: Record<string, AnalysisJob> };

  // Records every write attempt so we can assert atomicity.
  type WriteAttempt = {
    readonly kind: 'updateJob' | 'updateJobIfNotCompleted';
    readonly jobId: string;
    readonly applied: boolean;
    readonly demographics?: Demographics;
    readonly status?: string;
  };
  const writeLog: WriteAttempt[] = [];

  beforeEach(async () => {
    mockDb = { jobs: {} };
    writeLog.length = 0;

    const mockDatabaseService = {
      saveJob: jest.fn(async (job: AnalysisJob) => {
        mockDb.jobs[job.jobId] = { ...job };
      }),
      findJobById: jest.fn(async (jobId: string) => {
        return mockDb.jobs[jobId] ?? null;
      }),
      updateJob: jest.fn(async (jobId: string, updates: Partial<AnalysisJob>) => {
        writeLog.push({
          kind: 'updateJob',
          jobId,
          applied: Boolean(mockDb.jobs[jobId]),
          demographics: updates.demographics,
          status: (updates as Partial<AnalysisJob>).status,
        });
        if (mockDb.jobs[jobId]) {
          mockDb.jobs[jobId] = { ...mockDb.jobs[jobId], ...updates };
        }
      }),
      // Mock equivalent of MongoDB's atomic conditional update:
      //   updateOne({ jobId, status: { $ne: 'COMPLETED' } }, { $set: updates })
      // Returns true iff a document was actually updated.
      updateJobIfNotCompleted: jest.fn(
        async (jobId: string, updates: Partial<AnalysisJob>): Promise<boolean> => {
          const current = mockDb.jobs[jobId];
          const matches = Boolean(current) && current.status !== 'COMPLETED';
          writeLog.push({
            kind: 'updateJobIfNotCompleted',
            jobId,
            applied: matches,
            demographics: updates.demographics,
            status: (updates as Partial<AnalysisJob>).status,
          });
          if (matches) {
            mockDb.jobs[jobId] = { ...current, ...updates };
          }
          return matches;
        },
      ),
    };

    const mockMessageQueueService = {
      publishEvent: jest.fn(async () => {}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: MessageQueueService, useValue: mockMessageQueueService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /**
   * Test 1: COMPLETED-before-timer case.
   *
   * Worker flips job to COMPLETED before the 2-second delayedUpdate fires.
   * The atomic conditional write must NOT modify the document.
   */
  it('should not overwrite a COMPLETED job demographics (Worker faster than 2s)', async () => {
    jest.useFakeTimers();

    const job = await service.createAnalysis({
      userId: 'user-acme-completed',
      dataUrl: 'https://data.example.com/acme.csv',
    });
    const { jobId } = job;

    expect(mockDb.jobs[jobId].status).toBe('PENDING');
    expect(mockDb.jobs[jobId].demographics?.confidence).toBe(0.3);

    // Worker completes BEFORE delayedUpdate fires.
    const workerDemographics: Demographics = {
      ageRange: '25-34',
      gender: 'female',
      location: 'US',
      interests: ['fashion', 'travel'],
      confidence: 0.85,
    };
    mockDb.jobs[jobId] = {
      ...mockDb.jobs[jobId],
      status: 'COMPLETED',
      demographics: workerDemographics,
      completedAt: new Date().toISOString(),
    };

    jest.advanceTimersByTime(2500);
    await flushMicrotasks();

    const finalJob = mockDb.jobs[jobId];

    // Worker result preserved — atomic guard rejected the late write.
    expect(finalJob.status).toBe('COMPLETED');
    expect(finalJob.demographics?.confidence).toBe(0.85);

    // No unconditional updateJob was issued by delayedUpdate.
    const unconditionalWrites = writeLog.filter((w) => w.kind === 'updateJob');
    expect(unconditionalWrites).toEqual([]);

    // The conditional write was attempted exactly once and was rejected.
    const conditionalWrites = writeLog.filter((w) => w.kind === 'updateJobIfNotCompleted');
    expect(conditionalWrites).toHaveLength(1);
    expect(conditionalWrites[0].applied).toBe(false);
  });

  /**
   * Test 2: Interleaved write case — TOCTOU regression guard.
   *
   * This test fails on the original read-then-write fix and passes on
   * the atomic conditional update fix.
   *
   * We force the database to flip the job to COMPLETED in the middle of
   * the delayedUpdate "operation". With a read-then-write fix this would
   * silently overwrite the COMPLETED state. With the atomic conditional
   * update, the write is rejected because the filter is evaluated
   * server-side at the moment of the write, not at the moment of the read.
   */
  it('should not overwrite a job that becomes COMPLETED between read and write (TOCTOU)', async () => {
    jest.useFakeTimers();

    const job = await service.createAnalysis({
      userId: 'user-acme-toctou',
      dataUrl: 'https://data.example.com/toctou.csv',
    });
    const { jobId } = job;

    // Original PENDING state — Worker has not yet completed at the time
    // delayedUpdate would have read the job.
    expect(mockDb.jobs[jobId].status).toBe('PENDING');

    // Wire a one-shot interleaver: the FIRST conditional update call
    // observes a synthetic Worker COMPLETED transition that occurs *between*
    // any potential read and the write. Because we use a single atomic
    // conditional update, the filter is evaluated against the post-flip
    // state and the write must be rejected.
    const dbMock = (service as unknown as { databaseService: DatabaseService })
      .databaseService as unknown as {
      updateJobIfNotCompleted: jest.Mock<Promise<boolean>, [string, Partial<AnalysisJob>]>;
    };
    const realImpl = dbMock.updateJobIfNotCompleted.getMockImplementation();
    dbMock.updateJobIfNotCompleted.mockImplementationOnce(
      async (id: string, updates: Partial<AnalysisJob>): Promise<boolean> => {
        // Simulate the Worker flipping the job to COMPLETED right before
        // the database evaluates the conditional update filter.
        if (mockDb.jobs[id]) {
          mockDb.jobs[id] = {
            ...mockDb.jobs[id],
            status: 'COMPLETED',
            demographics: {
              ageRange: '35-44',
              gender: 'male',
              location: 'UK',
              interests: ['tech'],
              confidence: 0.92,
            },
            completedAt: new Date().toISOString(),
          };
        }
        return realImpl ? realImpl(id, updates) : false;
      },
    );

    jest.advanceTimersByTime(2500);
    await flushMicrotasks();

    const finalJob = mockDb.jobs[jobId];

    // Worker result wins. The interleaved COMPLETED flip is preserved.
    expect(finalJob.status).toBe('COMPLETED');
    expect(finalJob.demographics?.confidence).toBe(0.92);
    expect(finalJob.demographics?.ageRange).toBe('35-44');

    // Conditional update returned false — write was rejected by the guard.
    const conditional = writeLog.filter((w) => w.kind === 'updateJobIfNotCompleted');
    expect(conditional).toHaveLength(1);
    expect(conditional[0].applied).toBe(false);

    // No unconditional `updateJob` call occurred — the service uses ONLY
    // the atomic conditional API for the delayed refresh.
    const unconditional = writeLog.filter((w) => w.kind === 'updateJob');
    expect(unconditional).toEqual([]);
  });

  /**
   * Test 3: PENDING-still case (queue backlog).
   *
   * If the Worker hasn't picked up the job yet, the delayed refresh is
   * the only data the user has. The atomic conditional update must apply.
   */
  it('should still update demographics if the job is still PENDING when the timer fires', async () => {
    jest.useFakeTimers();

    const job = await service.createAnalysis({
      userId: 'user-slow-queue',
      dataUrl: 'https://data.example.com/slow-queue.csv',
    });
    const { jobId } = job;

    expect(mockDb.jobs[jobId].status).toBe('PENDING');

    jest.advanceTimersByTime(2500);
    await flushMicrotasks();

    const conditional = writeLog.filter((w) => w.kind === 'updateJobIfNotCompleted');
    expect(conditional).toHaveLength(1);
    expect(conditional[0].applied).toBe(true);
    expect(mockDb.jobs[jobId].status).toBe('PENDING');
    expect(mockDb.jobs[jobId].demographics?.confidence).toBe(0.3);
  });

  /**
   * Test 4: Service must use the atomic conditional API and never the
   * unconditional `updateJob` for the delayed refresh.
   *
   * This is a structural test that prevents accidentally regressing back
   * to read-then-write.
   */
  it('should never call the unconditional updateJob from the delayed refresh path', async () => {
    jest.useFakeTimers();

    await service.createAnalysis({
      userId: 'user-structural',
      dataUrl: 'https://data.example.com/structural.csv',
    });

    jest.advanceTimersByTime(2500);
    await flushMicrotasks();

    const unconditional = writeLog.filter((w) => w.kind === 'updateJob');
    expect(unconditional).toEqual([]);

    const conditional = writeLog.filter((w) => w.kind === 'updateJobIfNotCompleted');
    expect(conditional.length).toBeGreaterThan(0);
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}
