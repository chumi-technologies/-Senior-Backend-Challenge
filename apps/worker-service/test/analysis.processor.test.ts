import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisProcessor } from '../src/processors/analysis.processor';
import type { AnalysisRequestedEvent, ThirdPartyApiResponse } from '@senior-challenge/shared-types';

type TestableProcessor = AnalysisProcessor & {
    callThirdPartyApi(dataUrl: string): Promise<ThirdPartyApiResponse>;
    updateJobStatus(jobId: string, status: string, errorMessage?: string): Promise<void>;
};

const event: AnalysisRequestedEvent = {
    eventType: 'AnalysisRequested',
    jobId: 'job-failing',
    userId: 'user-1',
    dataUrl: 'https://example.com/input.json',
    timestamp: '2026-06-14T10:00:00.000Z',
};

test('process rejects after marking a failed provider call so the queue can retry', async () => {
    const processor = new AnalysisProcessor({ autoConnect: false }) as TestableProcessor;
    const statuses: Array<{ status: string; errorMessage?: string }> = [];

    processor.callThirdPartyApi = async () => {
        throw new Error('provider unavailable');
    };
    processor.updateJobStatus = async (_jobId: string, status: string, errorMessage?: string) => {
        statuses.push({ status, errorMessage });
    };

    await assert.rejects(() => processor.process(event), /provider unavailable/);

    assert.deepEqual(statuses, [
        { status: 'PROCESSING', errorMessage: undefined },
        { status: 'FAILED', errorMessage: 'provider unavailable' },
    ]);
});
