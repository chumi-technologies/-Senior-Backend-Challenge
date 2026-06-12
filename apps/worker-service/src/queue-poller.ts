import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';
import { captureMessage } from './middleware/capture.middleware';
import type { MessageProcessor } from './processors/processor.interface';

const QUEUE_DIR = path.join(findRepositoryRoot(process.cwd()), 'local-queue');
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
        this.logEvent('info', 'queue_poller_started', {
            queueDir: QUEUE_DIR,
        });

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

                        this.logEvent('info', 'queue_message_received', {
                            jobId: event.jobId,
                            traceId: event.traceId ?? null,
                            messageFile: file,
                        });

                        await captureMessage(event, {
                            source: 'local-queue',
                            messageId: event.jobId,
                            messageFile: file,
                            rawBody: content,
                        });

                        await this.processor.process(event);

                        // Delete file after successful processing
                        fs.unlinkSync(filepath);
                        this.logEvent('info', 'queue_message_processed_and_deleted', {
                            jobId: event.jobId,
                            traceId: event.traceId ?? null,
                            messageFile: file,
                        });
                    } catch (error) {
                        const isRetryDeferred = (error as Error).name === 'JobInFlightError';
                        this.logEvent(isRetryDeferred ? 'warn' : 'error', 'queue_message_processing_failed', {
                            messageFile: file,
                            errorName: (error as Error).name,
                            message: (error as Error).message,
                            retryDeferred: isRetryDeferred,
                        });
                    }
                }
            } catch (error) {
                this.logEvent('error', 'queue_poll_loop_failed', {
                    queueDir: QUEUE_DIR,
                    errorName: (error as Error).name,
                    message: (error as Error).message,
                });
            }

            await this.sleep(POLL_INTERVAL_MS);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private logEvent(level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown>): void {
        console.log(JSON.stringify({
            level,
            event,
            timestamp: new Date().toISOString(),
            ...context,
        }));
    }
}

function findRepositoryRoot(startDir: string): string {
    let current = startDir;

    while (true) {
        if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return startDir;
        }

        current = parent;
    }
}
