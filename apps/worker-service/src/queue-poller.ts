import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';
import type { MessageProcessor } from './processors/processor.interface';

const QUEUE_DIR = path.join(process.cwd(), 'local-queue');
const POLL_INTERVAL_MS = 1000;

/**
 * Queue Poller - simulates SQS polling for local development.
 * In production, this would use AWS SQS SDK.
 */
export class QueuePoller {
    private isRunning = false;

    constructor(private readonly processor: MessageProcessor) { }

    /**
     * Starts the polling loop.
     */
    async start(): Promise<void> {
        console.log('📡 Queue poller started, watching: ' + QUEUE_DIR);

        // Ensure queue directory exists
        if (!fs.existsSync(QUEUE_DIR)) {
            fs.mkdirSync(QUEUE_DIR, { recursive: true });
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
            try {
                const files = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json'));

                for (const file of files) {
                    const filepath = path.join(QUEUE_DIR, file);

                    try {
                        const content = fs.readFileSync(filepath, 'utf-8');
                        const event: AnalysisRequestedEvent = JSON.parse(content);

                        console.log(`📨 Processing message: ${event.jobId}`);

                        await this.processor.process(event);

                        // Delete file after successful processing
                        fs.unlinkSync(filepath);
                        console.log(`✅ Message processed and deleted: ${file}`);
                    } catch (error) {
                        console.log('Error processing message');
                    }
                }
            } catch (error) {
                console.log('Error in poll loop');
            }

            await this.sleep(POLL_INTERVAL_MS);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
