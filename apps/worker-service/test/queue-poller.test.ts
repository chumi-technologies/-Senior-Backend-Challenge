import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QueuePoller } from '../src/queue-poller';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';
import type { MessageProcessor } from '../src/processors/processor.interface';

const event: AnalysisRequestedEvent = {
    eventType: 'AnalysisRequested',
    jobId: 'job-queue',
    userId: 'user-1',
    dataUrl: 'https://example.com/input.json',
    timestamp: '2026-06-14T10:00:00.000Z',
};

async function withQueueDir(run: (queueDir: string) => Promise<void>): Promise<void> {
    const queueDir = await mkdtemp(join(tmpdir(), 'senior-challenge-queue-'));
    try {
        await run(queueDir);
    } finally {
        await rm(queueDir, { recursive: true, force: true });
    }
}

test('pollOnce deletes a message only after successful processing', async () => {
    await withQueueDir(async (queueDir) => {
        const filepath = join(queueDir, 'job-queue.json');
        const processed: AnalysisRequestedEvent[] = [];
        const processor: MessageProcessor = {
            async process(message: AnalysisRequestedEvent): Promise<void> {
                processed.push(message);
            },
        };

        await writeFile(filepath, JSON.stringify(event), 'utf8');

        const poller = new QueuePoller(processor, { queueDir });
        await poller.pollOnce();

        assert.equal(existsSync(filepath), false);
        assert.equal(processed.length, 1);
        assert.equal(processed[0].jobId, 'job-queue');
    });
});

test('pollOnce keeps a message when processing fails', async () => {
    await withQueueDir(async (queueDir) => {
        const filepath = join(queueDir, 'job-queue.json');
        const processor: MessageProcessor = {
            async process(): Promise<void> {
                throw new Error('transient provider failure');
            },
        };

        await writeFile(filepath, JSON.stringify(event), 'utf8');

        const poller = new QueuePoller(processor, { queueDir });
        await poller.pollOnce();

        assert.equal(existsSync(filepath), true);
        assert.deepEqual(JSON.parse(await readFile(filepath, 'utf8')), event);
    });
});
