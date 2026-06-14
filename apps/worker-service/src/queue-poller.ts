import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';
import type { MessageProcessor } from './processors/processor.interface';

const QUEUE_DIR = path.join(process.cwd(), 'local-queue');
const POLL_INTERVAL_MS = 1000;

type QueuePollerOptions = {
    readonly queueDir?: string;
    readonly pollIntervalMs?: number;
};

/**
 * Queue Poller - simulates SQS polling for local development.
 * In production, this would use AWS SQS SDK.
 */
export class QueuePoller {
    private isRunning = false;
    private readonly queueDir: string;
    private readonly pollIntervalMs: number;

    constructor(
        private readonly processor: MessageProcessor,
        options: QueuePollerOptions = {},
    ) {
        this.queueDir = options.queueDir ?? QUEUE_DIR;
        this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    }

    /**
     * Starts the polling loop.
     */
    async start(): Promise<void> {
        console.log('📡 Queue poller started, watching: ' + this.queueDir);

        // Ensure queue directory exists
        if (!fs.existsSync(this.queueDir)) {
            fs.mkdirSync(this.queueDir, { recursive: true });
        }

        this.isRunning = true;
        await this.pollLoop();
    }

    /**
     * Stops the polling loop.
     */
    stop(): void {
        this.isRunning = false;
    }

    /**
     * Main polling loop - reads JSON files from the queue directory and processes them.
     */
    private async pollLoop(): Promise<void> {
        while (this.isRunning) {
            await this.pollOnce();
            await this.sleep(this.pollIntervalMs);
        }
    }

    async pollOnce(): Promise<void> {
        try {
            const files = fs.readdirSync(this.queueDir).filter((f) => f.endsWith('.json'));

            for (const file of files) {
                const filepath = path.join(this.queueDir, file);

                try {
                    const content = fs.readFileSync(filepath, 'utf-8');
                    const event: AnalysisRequestedEvent = JSON.parse(content);

                    console.log(`📨 Processing message: ${event.jobId}`);

                    await this.processor.process(event);

                    // Delete file only after successful processing.
                    fs.unlinkSync(filepath);
                    console.log(`✅ Message processed and deleted: ${file}`);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.log(`Error processing message ${file}: ${message}`);
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`Error in poll loop: ${message}`);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
