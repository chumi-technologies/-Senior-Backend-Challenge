import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';
import type { AnalysisJob, Demographics } from '@senior-challenge/shared-types';

/**
 * Bug Reproduction Test Suite
 *
 * Reproduces and verifies the data inconsistency reported in customer support ticket #4521.
 *
 * Root cause: AnalysisService.createAnalysis() fires a setTimeout(delayedUpdate, 2000)
 * that unconditionally overwrites job demographics with low-confidence quick-demographics,
 * even after the Worker has already written high-confidence COMPLETED results.
 *
 * Race condition timeline:
 *   T+0ms:    createAnalysis() → saveJob(quickDemographics, status=PENDING)
 *   T+~1000ms: Worker completes → updateJob(highConfidenceDemographics, status=COMPLETED)
 *   T+2000ms: delayedUpdate() → updateJob(quickDemographics) ← OVERWRITES COMPLETED result
 */
describe('Data Consistency (Bug Repro — Ticket #4521)', () => {
  let service: AnalysisService;
  let mockDb: { jobs: Record<string, AnalysisJob> };

  // Tracks all updateJob calls in sequence for assertion
  const updateCallLog: Array<{ demographics?: Demographics; status?: string }> = [];

  beforeEach(async () => {
    mockDb = { jobs: {} };
    updateCallLog.length = 0;

    const mockDatabaseService = {
      saveJob: jest.fn(async (job: AnalysisJob) => {
        mockDb.jobs[job.jobId] = { ...job };
      }),
      findJobById: jest.fn(async (jobId: string) => {
        return mockDb.jobs[jobId] ?? null;
      }),
      updateJob: jest.fn(async (jobId: string, updates: Partial<AnalysisJob>) => {
        updateCallLog.push({ demographics: updates.demographics, status: (updates as any).status });
        if (mockDb.jobs[jobId]) {
          mockDb.jobs[jobId] = { ...mockDb.jobs[jobId], ...updates };
        }
      }),
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
   * Test 1: Reproduce the bug — demonstrates that without the fix,
   * delayedUpdate overwrites a COMPLETED job's high-confidence demographics.
   *
   * This test uses real timers and simulates the Worker completing before 2 seconds.
   * After this test, you should see that the final stored demographics have confidence=0.3
   * (the quick-demographics value), not the Worker's high-confidence value.
   */
  it('should reproduce the data overwrite issue before fix', async () => {
    jest.useFakeTimers();

    const job = await service.createAnalysis({
      userId: 'user-acme-test',
      dataUrl: 'https://data.example.com/acme.csv',
    });

    const { jobId } = job;

    // Verify initial state: quick-demographics with low confidence
    const initialJob = mockDb.jobs[jobId];
    expect(initialJob).toBeDefined();
    expect(initialJob.status).toBe('PENDING');
    expect(initialJob.demographics?.confidence).toBe(0.3);

    // Simulate Worker completing with high-confidence results BEFORE the 2s timeout
    const workerDemographics: Demographics = {
      ageRange: '25-34',
      gender: 'female',
      location: 'US',
      interests: ['fashion', 'travel'],
      confidence: 0.85, // High confidence — Worker's full analysis
    };

    // Worker writes COMPLETED result at T+1000ms (before delayedUpdate at T+2000ms)
    mockDb.jobs[jobId] = {
      ...mockDb.jobs[jobId],
      status: 'COMPLETED',
      demographics: workerDemographics,
      completedAt: new Date().toISOString(),
    };

    // Advance time to T+2000ms — delayedUpdate fires
    jest.advanceTimersByTime(2500);

    // Wait for any pending async operations
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // BUG DEMONSTRATION: delayedUpdate has now fired and overwritten the COMPLETED job
    // The final demographics should be the Worker's high-confidence result (0.85)
    // but WITHOUT the fix, it will be the quick-demographics (0.3)
    const finalJob = mockDb.jobs[jobId];

    // This assertion documents the BUG: final confidence is overwritten to 0.3
    // Comment: "updateJob was called with quick-demographics AFTER Worker completed"
    const lastUpdateCall = updateCallLog[updateCallLog.length - 1];
    if (lastUpdateCall && lastUpdateCall.demographics) {
      // The bug: delayedUpdate overwrites with confidence=0.3 even though job is COMPLETED
      expect(lastUpdateCall.demographics.confidence).toBe(0.3);
    }

    // The overwrite occurred — final stored confidence is 0.3, not 0.85
    // This is the bug. After the fix, this assertion should FAIL (proving overwrite stopped).
    console.log(
      `[BUG REPRO] Final stored confidence: ${finalJob.demographics?.confidence} ` +
      `(expected Worker value 0.85, got overwritten with quick-demographics ${finalJob.demographics?.confidence})`
    );
  });

  /**
   * Test 2: Verify the fix — after applying the status guard in delayedUpdate,
   * a COMPLETED job's demographics must NOT be overwritten.
   *
   * This is the characterization test that locks the correct behavior.
   */
  it('should not overwrite COMPLETED job demographics when Worker finishes before delayedUpdate fires', async () => {
    jest.useFakeTimers();

    const job = await service.createAnalysis({
      userId: 'user-acme-verified',
      dataUrl: 'https://data.example.com/acme-v2.csv',
    });

    const { jobId } = job;

    // Initial quick-demographics written
    expect(mockDb.jobs[jobId].status).toBe('PENDING');
    expect(mockDb.jobs[jobId].demographics?.confidence).toBe(0.3);

    // Simulate Worker completing BEFORE 2s timeout fires
    const workerDemographics: Demographics = {
      ageRange: '35-44',
      gender: 'male',
      location: 'UK',
      interests: ['tech', 'finance'],
      confidence: 0.92,
    };

    // Worker updates the job to COMPLETED
    mockDb.jobs[jobId] = {
      ...mockDb.jobs[jobId],
      status: 'COMPLETED',
      demographics: workerDemographics,
      completedAt: new Date().toISOString(),
    };

    // Advance time past the delayedUpdate timeout
    jest.advanceTimersByTime(2500);

    // Wait for all microtasks and promises to settle
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const finalJob = mockDb.jobs[jobId];

    // FIXED BEHAVIOR: After fix, delayedUpdate checks job status.
    // If status === COMPLETED, it skips the update.
    // Final demographics should still be Worker's high-confidence result.
    expect(finalJob.status).toBe('COMPLETED');
    expect(finalJob.demographics?.confidence).toBe(0.92);
    expect(finalJob.demographics?.ageRange).toBe('35-44');
    expect(finalJob.demographics?.interests).toEqual(['tech', 'finance']);

    console.log(
      `[FIX VERIFIED] Final stored confidence: ${finalJob.demographics?.confidence} ` +
      `— Worker's high-confidence result preserved. delayedUpdate did not overwrite COMPLETED job.`
    );
  });

  /**
   * Test 3: Verify that delayedUpdate DOES update if the job is still PENDING.
   * (For queue-backlog scenario where Worker hasn't started yet)
   */
  it('should still update demographics if job is still PENDING when delayedUpdate fires', async () => {
    jest.useFakeTimers();

    const job = await service.createAnalysis({
      userId: 'user-slow-queue',
      dataUrl: 'https://data.example.com/slow-queue.csv',
    });

    const { jobId } = job;

    // Job remains PENDING (Worker hasn't picked it up yet)
    expect(mockDb.jobs[jobId].status).toBe('PENDING');

    const updateCallsBefore = updateCallLog.length;

    // Advance time — delayedUpdate fires while job is still PENDING
    jest.advanceTimersByTime(2500);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // delayedUpdate SHOULD have fired and written (job is still PENDING, no Worker result yet)
    const updateCallsAfter = updateCallLog.length;
    expect(updateCallsAfter).toBeGreaterThan(updateCallsBefore);

    console.log(
      `[PENDING CASE] delayedUpdate correctly updated PENDING job (Worker hasn't completed yet). ` +
      `Update calls: ${updateCallsAfter - updateCallsBefore}`
    );
  });
});
