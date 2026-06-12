import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';

export type CaptureSource = 'local-queue' | 'sqs' | 'manual';

export interface CaptureMetadata {
    source: CaptureSource;
    messageId?: string;
    messageFile?: string;
    attributes?: Record<string, string>;
    rawBody?: unknown;
}

export interface CaptureEnvelope<TPayload = AnalysisRequestedEvent> {
    schemaVersion: 1;
    capturedAt: string;
    source: CaptureSource;
    messageId: string;
    messageFile?: string;
    attributes?: Record<string, string>;
    rawBody?: unknown;
    payload: TPayload;
}

const CAPTURE_DIR = 'debug-payloads';

export async function captureMessage(
    payload: AnalysisRequestedEvent,
    metadata: CaptureMetadata,
): Promise<string | null> {
    if (process.env.CAPTURE_MODE !== 'true') {
        return null;
    }

    try {
        const rootDir = findRepositoryRoot(process.cwd());
        const captureDir = path.join(rootDir, CAPTURE_DIR);
        fs.mkdirSync(captureDir, { recursive: true });

        const capturedAt = new Date().toISOString();
        const messageId = metadata.messageId ?? payload.jobId;
        const envelope: CaptureEnvelope = {
            schemaVersion: 1,
            capturedAt,
            source: metadata.source,
            messageId,
            messageFile: metadata.messageFile,
            attributes: metadata.attributes,
            rawBody: metadata.rawBody,
            payload,
        };

        const filename = buildCaptureFilename(payload, capturedAt, messageId);
        const filepath = path.join(captureDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(envelope, null, 2));
        console.log(`Captured payload: ${filepath}`);

        return filepath;
    } catch (error) {
        console.error('Failed to capture payload:', (error as Error).message);
        return null;
    }
}

function buildCaptureFilename(
    payload: AnalysisRequestedEvent,
    capturedAt: string,
    messageId: string,
): string {
    const eventType = toKebabCase(payload.eventType);
    const jobId = sanitizeForFilename(payload.jobId || messageId);
    const timestamp = capturedAt.replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');

    return `${eventType}-${jobId}-${timestamp}.json`;
}

function toKebabCase(value: string): string {
    return sanitizeForFilename(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_+/g, '-')
        .toLowerCase();
}

function sanitizeForFilename(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
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
