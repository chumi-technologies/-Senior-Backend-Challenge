/**
 * Replay Event Script
 *
 * Usage: pnpm run replay -- --file=debug-payloads/job-xxx.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';
import { AnalysisProcessor } from '../apps/worker-service/src/processors/analysis.processor';

interface ReplayInput {
    payload?: unknown;
    [key: string]: unknown;
}

async function main(): Promise<void> {
    const file = getFileArgument(process.argv.slice(2));
    const filepath = path.resolve(process.cwd(), file);

    if (!fs.existsSync(filepath)) {
        throw new Error(`Replay file not found: ${filepath}`);
    }

    const parsed = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as ReplayInput;
    const event = extractEvent(parsed);

    console.log(`Replaying payload from: ${filepath}`);
    console.log(`Replay jobId: ${event.jobId}`);

    const processor = new AnalysisProcessor();
    try {
        await processor.process(event, {
            allowFailedRetry: true,
            failOnProcessingError: true,
            failOnSkipped: true,
            source: 'replay',
        });
        console.log(`Replay completed for jobId: ${event.jobId}`);
    } finally {
        await processor.close();
    }
}

function getFileArgument(args: string[]): string {
    const fileArg = args.find((arg) => arg.startsWith('--file='));
    if (fileArg) {
        return fileArg.slice('--file='.length);
    }

    const fileFlagIndex = args.indexOf('--file');
    if (fileFlagIndex >= 0 && args[fileFlagIndex + 1]) {
        return args[fileFlagIndex + 1];
    }

    throw new Error('Missing required argument: --file=<path-to-payload.json>');
}

function extractEvent(input: ReplayInput): AnalysisRequestedEvent {
    const candidate = hasPayload(input) ? input.payload : input;

    if (!isAnalysisRequestedEvent(candidate)) {
        throw new Error('Replay file does not contain a valid AnalysisRequestedEvent payload');
    }

    return candidate;
}

function hasPayload(input: ReplayInput): input is ReplayInput & { payload: unknown } {
    return Object.prototype.hasOwnProperty.call(input, 'payload');
}

function isAnalysisRequestedEvent(value: unknown): value is AnalysisRequestedEvent {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const event = value as Partial<AnalysisRequestedEvent>;

    return event.eventType === 'AnalysisRequested'
        && typeof event.jobId === 'string'
        && typeof event.userId === 'string'
        && typeof event.dataUrl === 'string'
        && typeof event.timestamp === 'string';
}

main()
    .catch((error) => {
        console.error('Replay failed:', (error as Error).message);
        process.exitCode = 1;
    });
