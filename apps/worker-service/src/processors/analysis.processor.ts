import * as fs from 'fs';
import * as path from 'path';
import mongoose, { type Connection } from 'mongoose';
import { z } from 'zod';
import type { AnalysisRequestedEvent, AnalysisStatus, Demographics, ThirdPartyApiResponse } from '@senior-challenge/shared-types';
import type { MessageProcessor } from './processor.interface';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/analysis_db';
const FAILED_RECORDS_DIR = 'failed-records';
const CANONICAL_AGE_RANGES = new Set(['under-18', '18-24', '25-34', '35-44', '45-54', '55+']);
const ALLOWED_GENDERS = new Set(['male', 'female', 'other', 'non-binary']);
const MIN_PROCESSING_LEASE_TIMEOUT_MS = 1000;
const PROCESSING_LEASE_TIMEOUT_MS = Math.max(
    parsePositiveInteger(process.env.PROCESSING_LEASE_TIMEOUT_MS, 5 * 60 * 1000),
    MIN_PROCESSING_LEASE_TIMEOUT_MS,
);
const PROCESSING_LEASE_HEARTBEAT_MS = parseProcessingLeaseHeartbeatMs(
    process.env.PROCESSING_LEASE_HEARTBEAT_MS,
    PROCESSING_LEASE_TIMEOUT_MS,
);

interface ValidationIssue {
    field: string;
    value: unknown;
    reason: string;
}

interface ProcessOptions {
    allowFailedRetry?: boolean;
    failOnSkipped?: boolean;
    failOnProcessingError?: boolean;
    source?: 'queue' | 'replay';
}

type ProcessingStartResult = 'started' | 'recovered' | 'skipped' | 'inflight';

class ThirdPartyValidationError extends Error {
    constructor(readonly issues: ValidationIssue[]) {
        super('Third-party API response failed validation');
        this.name = 'ThirdPartyValidationError';
    }
}

class JobInFlightError extends Error {
    constructor(readonly jobId: string) {
        super(`Job is already being processed: ${jobId}`);
        this.name = 'JobInFlightError';
    }
}

const ThirdPartyApiResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        age: z.union([z.number(), z.string()]).nullable().optional(),
        gender: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        tags: z.union([z.array(z.string()), z.string()]).nullable().optional(),
        score: z.union([z.number(), z.string()]).nullable().optional(),
    }).optional(),
    error: z.string().optional(),
});

type ThirdPartyData = NonNullable<z.infer<typeof ThirdPartyApiResponseSchema>['data']>;

/**
 * Analysis Processor - processes analysis jobs from the queue.
 * Handles the full analysis pipeline: fetch third-party data, transform, and persist results.
 */
export class AnalysisProcessor implements MessageProcessor {
    private connection: Connection | null = null;
    private readonly ready: Promise<void>;

    constructor() {
        this.ready = this.initializeDatabase();
    }

    private async initializeDatabase(): Promise<void> {
        try {
            this.connection = await mongoose.createConnection(MONGODB_URI).asPromise();
            this.logEvent('info', 'worker_database_connected', {
                databaseName: this.connection.name,
            });
        } catch (error) {
            this.logEvent('error', 'worker_database_connection_failed', {
                errorName: (error as Error).name,
                message: (error as Error).message,
            });
            throw error;
        }
    }

    async close(): Promise<void> {
        await this.ready.catch(() => undefined);
        const connection = this.connection;
        this.connection = null;
        await connection?.close().catch(() => undefined);
    }

    /**
     * Processes an analysis request from the message queue.
     * Fetches data from the third-party API, transforms it, and saves the results.
     */
    async process(event: AnalysisRequestedEvent, options: ProcessOptions = {}): Promise<void> {
        const { jobId, dataUrl, traceId } = event;
        const traceIdForLog = traceId ?? null;
        const processingLeaseOwner = this.createProcessingLeaseOwner(jobId);
        let apiResponse: ThirdPartyApiResponse | undefined;
        let startedProcessing = false;
        let leaseHeartbeat: ReturnType<typeof setInterval> | undefined;

        try {
            await this.ready;

            this.logEvent('info', 'analysis_job_received', {
                jobId,
                traceId: traceIdForLog,
                source: options.source ?? 'queue',
            });

            const startResult = await this.markJobProcessing(jobId, traceIdForLog, processingLeaseOwner, options);
            if (startResult === 'inflight') {
                throw new JobInFlightError(jobId);
            }

            if (startResult === 'skipped') {
                this.logEvent('warn', 'analysis_job_start_skipped_due_to_state', {
                    jobId,
                    traceId: traceIdForLog,
                    expectedStatus: 'PENDING_OR_PROCESSING',
                });
                if (options.failOnSkipped) {
                    throw new Error(`Job ${jobId} could not be started for replay; it may be missing or already terminal`);
                }
                return;
            }
            startedProcessing = true;
            leaseHeartbeat = this.startProcessingLeaseHeartbeat(jobId, traceIdForLog, processingLeaseOwner);

            // Call third-party API for full analysis
            apiResponse = await this.callThirdPartyApi(dataUrl);

            // Transform API response to our internal format
            const demographics = this.transformApiResponse(apiResponse, {
                jobId,
                traceId: traceIdForLog,
            });

            // Save the analysis results
            const completed = await this.markJobCompleted(jobId, demographics, traceIdForLog, processingLeaseOwner);
            if (!completed) {
                this.logEvent('warn', 'analysis_job_completion_skipped_due_to_state', {
                    jobId,
                    traceId: traceIdForLog,
                    expectedStatus: 'PROCESSING',
                });
                if (options.failOnSkipped) {
                    throw new Error(`Job ${jobId} completion was skipped because the processing lease no longer matched`);
                }
                return;
            }
            this.stopProcessingLeaseHeartbeat(leaseHeartbeat);
            leaseHeartbeat = undefined;

            this.logEvent('info', 'analysis_job_completed', {
                jobId,
                traceId: traceIdForLog,
            });
        } catch (error) {
            if (!startedProcessing) {
                this.logEvent(error instanceof JobInFlightError ? 'warn' : 'error', 'analysis_job_failed_before_processing', {
                    jobId,
                    traceId: traceIdForLog,
                    errorName: (error as Error).name,
                    message: (error as Error).message,
                });
                throw error;
            }

            this.logEvent('error', 'analysis_job_failed', {
                jobId,
                traceId: traceIdForLog,
                errorName: (error as Error).name,
                message: (error as Error).message,
                validationIssues: error instanceof ThirdPartyValidationError ? error.issues : undefined,
            });

            const markedFailed = await this.markJobFailed(jobId, error as Error, traceIdForLog, processingLeaseOwner);
            if (!markedFailed) {
                this.logEvent('warn', 'analysis_job_failure_update_skipped_due_to_state', {
                    jobId,
                    traceId: traceIdForLog,
                    expectedStatus: 'PROCESSING',
                });
                if (options.failOnSkipped) {
                    throw new Error(`Job ${jobId} failure update was skipped because the processing lease no longer matched`);
                }
                return;
            }

            await this.writeFailedRecord(event, error as Error, apiResponse);
            if (options.failOnProcessingError) {
                throw error;
            }
        } finally {
            this.stopProcessingLeaseHeartbeat(leaseHeartbeat);
        }
    }

    /**
     * Calls the third-party AI analysis API.
     * Returns raw response data for transformation.
     */
    private async callThirdPartyApi(dataUrl: string): Promise<ThirdPartyApiResponse> {
        // Simulate API latency
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

        // Simulated API responses representing real-world data variety
        const scenarios: ThirdPartyApiResponse[] = [
            // Standard response
            {
                success: true,
                data: {
                    age: 28,
                    gender: 'female',
                    country: 'US',
                    city: 'New York',
                    tags: ['fashion', 'travel'],
                    score: 0.85,
                },
            },
            // Response with alternative data formats
            {
                success: true,
                data: {
                    age: '25+',
                    gender: 'male',
                    country: 'UK',
                    city: null,
                    tags: 'lifestyle,food',
                    score: '0.72',
                },
            },
            // Response with sparse data
            {
                success: true,
                data: {
                    age: null,
                    gender: undefined,
                    country: 'CA',
                    city: 'Toronto',
                    tags: null,
                    score: null,
                },
            },
        ];

        return scenarios[Math.floor(Math.random() * scenarios.length)];
    }

    /**
     * Transforms the third-party API response into our Demographics model.
     */
    private transformApiResponse(
        response: ThirdPartyApiResponse,
        context?: { jobId: string; traceId: string | null },
    ): Demographics {
        const parsed = ThirdPartyApiResponseSchema.safeParse(response);
        if (!parsed.success) {
            throw new ThirdPartyValidationError(parsed.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                value: undefined,
                reason: issue.message,
            })));
        }

        if (!parsed.data.success || !parsed.data.data) {
            throw new ThirdPartyValidationError([{
                field: 'data',
                value: parsed.data.data,
                reason: parsed.data.error ?? 'third-party response must include data when success is true',
            }]);
        }

        const data = parsed.data.data;
        const issues: ValidationIssue[] = [];
        const warnings: ValidationIssue[] = [];

        const age = this.normalizeAge(data.age);
        if (!age.ok) {
            issues.push(age.issue);
        } else if (age.warning) {
            warnings.push(age.warning);
        }

        const gender = this.normalizeGender(data.gender);
        if (!gender.ok) issues.push(gender.issue);

        const location = this.normalizeRequiredString('country', data.country);
        if (!location.ok) issues.push(location.issue);

        const tags = this.normalizeTags(data.tags);
        if (!tags.ok) warnings.push(tags.issue);

        const score = this.normalizeScore(data.score);
        if (!score.ok) warnings.push(score.issue);

        if (issues.length > 0) {
            throw new ThirdPartyValidationError(issues);
        }

        const ageRange = age.ok ? age.value : undefined;
        const genderValue = gender.ok ? gender.value : undefined;
        const locationValue = location.ok ? location.value : undefined;

        if (!ageRange || !genderValue || !locationValue) {
            throw new ThirdPartyValidationError(issues);
        }

        if (warnings.length > 0) {
            this.logEvent('warn', 'analysis_response_degraded', {
                jobId: context?.jobId,
                traceId: context?.traceId ?? null,
                warnings,
            });
        }

        return {
            ageRange,
            gender: genderValue,
            location: locationValue,
            interests: tags.ok ? tags.value : [],
            confidence: score.ok ? score.value : undefined,
        };
    }

    private normalizeAge(value: ThirdPartyData['age']):
        | { ok: true; value: string; warning?: ValidationIssue }
        | { ok: false; issue: ValidationIssue } {
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 0 || value > 120) {
                return this.invalid('age', value, 'age must be an integer between 0 and 120');
            }

            return { ok: true, value: this.calculateAgeRange(value) };
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (CANONICAL_AGE_RANGES.has(trimmed)) {
                return { ok: true, value: trimmed };
            }

            const plusMatch = trimmed.match(/^(\d{1,3})\+$/);
            if (plusMatch) {
                const lowerBound = Number(plusMatch[1]);
                if (lowerBound >= 0 && lowerBound <= 120) {
                    return {
                        ok: true,
                        value: this.calculateAgeRange(lowerBound),
                        warning: {
                            field: 'age',
                            value,
                            reason: 'open-ended age range mapped to lower-bound canonical bucket',
                        },
                    };
                }
            }

            const rangeMatch = trimmed.match(/^(\d{1,3})-(\d{1,3})$/);
            if (rangeMatch) {
                const start = Number(rangeMatch[1]);
                const end = Number(rangeMatch[2]);
                if (start >= 0 && end <= 120 && start <= end && CANONICAL_AGE_RANGES.has(trimmed)) {
                    return { ok: true, value: trimmed };
                }
            }
        }

        return this.invalid('age', value, 'age is required and must be numeric or a parseable age range');
    }

    private normalizeRequiredString(field: string, value: string | null | undefined):
        | { ok: true; value: string }
        | { ok: false; issue: ValidationIssue } {
        if (typeof value !== 'string' || value.trim().length === 0) {
            return this.invalid(field, value, `${field} is required`);
        }

        return { ok: true, value: value.trim() };
    }

    private normalizeGender(value: string | null | undefined):
        | { ok: true; value: string }
        | { ok: false; issue: ValidationIssue } {
        const normalized = this.normalizeRequiredString('gender', value);
        if (!normalized.ok) {
            return normalized;
        }

        const gender = normalized.value.toLowerCase();
        if (!ALLOWED_GENDERS.has(gender)) {
            return this.invalid('gender', value, 'gender must be male, female, other, or non-binary');
        }

        return { ok: true, value: gender };
    }

    private normalizeTags(value: ThirdPartyData['tags']):
        | { ok: true; value: string[] }
        | { ok: false; issue: ValidationIssue } {
        if (Array.isArray(value)) {
            const tags = value.map((tag) => tag.trim()).filter(Boolean);
            if (tags.length === 0) {
                return this.invalid('tags', value, 'tags are empty; keeping record with empty interests');
            }

            return { ok: true, value: tags };
        }

        if (typeof value === 'string') {
            const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
            if (tags.length > 0) {
                return { ok: true, value: tags };
            }
        }

        return this.invalid('tags', value, 'tags are missing or empty; keeping record with empty interests');
    }

    private normalizeScore(value: ThirdPartyData['score']):
        | { ok: true; value: number }
        | { ok: false; issue: ValidationIssue } {
        if (typeof value === 'number') {
            if (value >= 0 && value <= 1) {
                return { ok: true, value };
            }

            return this.invalid('score', value, 'score must be between 0 and 1');
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length === 0) {
                return this.invalid('score', value, 'score is empty; keeping core demographics only');
            }

            const numeric = Number(trimmed);
            if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) {
                return { ok: true, value: numeric };
            }
        }

        return this.invalid('score', value, 'score is unavailable or non-numeric; keeping core demographics only');
    }

    private invalid(field: string, value: unknown, reason: string): { ok: false; issue: ValidationIssue } {
        return {
            ok: false,
            issue: { field, value, reason },
        };
    }

    /**
     * Maps a numeric age to a standard age range bucket.
     */
    private calculateAgeRange(age: number): string {
        if (age < 18) return 'under-18';
        if (age < 25) return '18-24';
        if (age < 35) return '25-34';
        if (age < 45) return '35-44';
        if (age < 55) return '45-54';
        return '55+';
    }

    private getAnalysisJobsCollection() {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) {
            throw new Error('MongoDB connection is not initialized');
        }

        return collection;
    }

    private async markJobProcessing(
        jobId: string,
        traceId: string | null,
        processingLeaseOwner: string,
        options: ProcessOptions,
    ): Promise<ProcessingStartResult> {
        const collection = this.getAnalysisJobsCollection();
        const now = new Date().toISOString();
        const startableStatuses: AnalysisStatus[] = options.allowFailedRetry
            ? ['PENDING', 'FAILED']
            : ['PENDING'];

        const result = await collection.updateOne(
            { jobId, status: { $in: startableStatuses } },
            {
                $set: {
                    status: 'PROCESSING' satisfies AnalysisStatus,
                    updatedAt: now,
                    processingLeaseExpiresAt: this.createProcessingLeaseExpiresAt(),
                    processingLeaseOwner,
                },
                $unset: {
                    error: '',
                    completedAt: '',
                },
            },
        );

        this.logMatchedCount('analysis_job_mark_processing', jobId, traceId, result.matchedCount);
        if (result.matchedCount === 1) {
            return 'started';
        }

        const currentJob = await collection.findOne<{
            status?: AnalysisStatus;
            processingLeaseExpiresAt?: string;
            processingLeaseOwner?: string;
        }>(
            { jobId },
            { projection: { status: 1, processingLeaseExpiresAt: 1, processingLeaseOwner: 1 } },
        );

        if (currentJob?.status === 'PROCESSING') {
            const leaseExpiresAtMs = this.getProcessingLeaseExpiresAtMs(currentJob.processingLeaseExpiresAt);
            const leaseRemainingMs = leaseExpiresAtMs - Date.now();
            if (leaseRemainingMs > 0) {
                this.logEvent('warn', 'analysis_job_processing_inflight', {
                    jobId,
                    traceId,
                    currentStatus: currentJob.status,
                    processingLeaseExpiresAt: currentJob.processingLeaseExpiresAt ?? null,
                    leaseRemainingMs,
                    leaseTimeoutMs: PROCESSING_LEASE_TIMEOUT_MS,
                    reason: 'job is still within processing lease; keeping queue message for retry',
                });
                return 'inflight';
            }

            const recoveryFilter: Record<string, unknown> = {
                jobId,
                status: 'PROCESSING' satisfies AnalysisStatus,
                processingLeaseExpiresAt: typeof currentJob.processingLeaseExpiresAt === 'string'
                    ? currentJob.processingLeaseExpiresAt
                    : { $exists: false },
                processingLeaseOwner: typeof currentJob.processingLeaseOwner === 'string'
                    ? currentJob.processingLeaseOwner
                    : { $exists: false },
            };
            const recoveryResult = await collection.updateOne(
                recoveryFilter,
                {
                    $set: {
                        updatedAt: now,
                        processingLeaseExpiresAt: this.createProcessingLeaseExpiresAt(),
                        processingLeaseOwner,
                    },
                },
            );

            this.logEvent(recoveryResult.matchedCount === 1 ? 'warn' : 'error', 'analysis_job_processing_recovered', {
                jobId,
                traceId,
                matchedCount: recoveryResult.matchedCount,
                previousProcessingLeaseExpiresAt: currentJob.processingLeaseExpiresAt ?? null,
                previousProcessingLeaseOwner: currentJob.processingLeaseOwner ?? null,
                leaseExpiredByMs: Math.max(0, Date.now() - leaseExpiresAtMs),
                leaseTimeoutMs: PROCESSING_LEASE_TIMEOUT_MS,
                reason: 'stale PROCESSING lease recovered because queue message still exists',
            });

            if (recoveryResult.matchedCount === 1) {
                return 'recovered';
            }

            return 'inflight';
        }

        this.logEvent('warn', 'analysis_job_start_not_allowed', {
            jobId,
            traceId,
            currentStatus: currentJob?.status ?? null,
        });
        return 'skipped';
    }

    private startProcessingLeaseHeartbeat(
        jobId: string,
        traceId: string | null,
        processingLeaseOwner: string,
    ): ReturnType<typeof setInterval> {
        const heartbeat = setInterval(() => {
            void this.extendProcessingLease(jobId, traceId, processingLeaseOwner).catch((error) => {
                this.logEvent('error', 'analysis_processing_lease_heartbeat_failed', {
                    jobId,
                    traceId,
                    errorName: (error as Error).name,
                    message: (error as Error).message,
                });
            });
        }, PROCESSING_LEASE_HEARTBEAT_MS);

        heartbeat.unref?.();
        return heartbeat;
    }

    private stopProcessingLeaseHeartbeat(heartbeat: ReturnType<typeof setInterval> | undefined): void {
        if (heartbeat) {
            clearInterval(heartbeat);
        }
    }

    private async extendProcessingLease(
        jobId: string,
        traceId: string | null,
        processingLeaseOwner: string,
    ): Promise<void> {
        const collection = this.getAnalysisJobsCollection();
        const result = await collection.updateOne(
            { jobId, status: 'PROCESSING' satisfies AnalysisStatus, processingLeaseOwner },
            {
                $set: {
                    updatedAt: new Date().toISOString(),
                    processingLeaseExpiresAt: this.createProcessingLeaseExpiresAt(),
                },
            },
        );

        if (result.matchedCount === 0) {
            this.logEvent('warn', 'analysis_processing_lease_heartbeat_skipped', {
                jobId,
                traceId,
                matchedCount: result.matchedCount,
                processingLeaseOwner,
            });
        }
    }

    private createProcessingLeaseExpiresAt(): string {
        return new Date(Date.now() + PROCESSING_LEASE_TIMEOUT_MS).toISOString();
    }

    private getProcessingLeaseExpiresAtMs(processingLeaseExpiresAt: string | undefined): number {
        if (!processingLeaseExpiresAt) {
            return 0;
        }

        const expiresAtMs = Date.parse(processingLeaseExpiresAt);
        return Number.isNaN(expiresAtMs) ? 0 : expiresAtMs;
    }

    private createProcessingLeaseOwner(jobId: string): string {
        return `${this.sanitizeForFilename(jobId)}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    private async markJobCompleted(
        jobId: string,
        demographics: Demographics,
        traceId: string | null,
        processingLeaseOwner: string,
    ): Promise<boolean> {
        const collection = this.getAnalysisJobsCollection();
        const now = new Date().toISOString();

        const result = await collection.updateOne(
            { jobId, status: 'PROCESSING' satisfies AnalysisStatus, processingLeaseOwner },
            {
                $set: {
                    status: 'COMPLETED' satisfies AnalysisStatus,
                    demographics,
                    updatedAt: now,
                    completedAt: now,
                },
                $unset: {
                    processingLeaseExpiresAt: '',
                    processingLeaseOwner: '',
                },
            },
        );

        this.logMatchedCount('analysis_job_mark_completed', jobId, traceId, result.matchedCount);
        return result.matchedCount === 1;
    }

    private async markJobFailed(
        jobId: string,
        error: Error,
        traceId: string | null,
        processingLeaseOwner: string,
    ): Promise<boolean> {
        const collection = this.getAnalysisJobsCollection();
        const result = await collection.updateOne(
            { jobId, status: 'PROCESSING' satisfies AnalysisStatus, processingLeaseOwner },
            {
                $set: {
                    status: 'FAILED' satisfies AnalysisStatus,
                    error: error.message,
                    updatedAt: new Date().toISOString(),
                },
                $unset: {
                    processingLeaseExpiresAt: '',
                    processingLeaseOwner: '',
                },
            },
        );

        this.logMatchedCount('analysis_job_mark_failed', jobId, traceId, result.matchedCount);
        return result.matchedCount === 1;
    }

    private logMatchedCount(event: string, jobId: string, traceId: string | null, matchedCount: number): void {
        this.logEvent(matchedCount === 1 ? 'info' : 'warn', event, {
            jobId,
            traceId,
            matchedCount,
        });
    }

    private logEvent(level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown>): void {
        console.log(JSON.stringify({
            level,
            event,
            timestamp: new Date().toISOString(),
            ...context,
        }));
    }

    private async writeFailedRecord(
        event: AnalysisRequestedEvent,
        error: Error,
        apiResponse?: ThirdPartyApiResponse,
    ): Promise<void> {
        try {
            const rootDir = this.findRepositoryRoot(process.cwd());
            const failedDir = path.join(rootDir, FAILED_RECORDS_DIR);
            fs.mkdirSync(failedDir, { recursive: true });

            const timestamp = new Date().toISOString();
            const filepath = path.join(
                failedDir,
                `worker-${this.sanitizeForFilename(event.jobId)}-${this.formatTimestampForFilename(timestamp)}.json`,
            );

            const failedRecord = {
                failedAt: timestamp,
                source: 'worker-service',
                jobId: event.jobId,
                traceId: event.traceId ?? null,
                event,
                thirdPartyResponse: apiResponse,
                error: {
                    name: error.name,
                    message: error.message,
                    validationIssues: error instanceof ThirdPartyValidationError ? error.issues : undefined,
                },
            };

            fs.writeFileSync(filepath, JSON.stringify(failedRecord, null, 2));
            this.logEvent('warn', 'analysis_failed_record_saved', {
                jobId: event.jobId,
                traceId: event.traceId ?? null,
                filepath,
            });
        } catch (writeError) {
            this.logEvent('error', 'analysis_failed_record_write_failed', {
                jobId: event.jobId,
                traceId: event.traceId ?? null,
                message: (writeError as Error).message,
            });
        }
    }

    private findRepositoryRoot(startDir: string): string {
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

    private sanitizeForFilename(value: string): string {
        return value.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    private formatTimestampForFilename(value: string): string {
        return value.replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
    }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function parseProcessingLeaseHeartbeatMs(value: string | undefined, timeoutMs: number): number {
    const fallback = Math.max(1, Math.floor(timeoutMs / 3));
    const requested = parsePositiveInteger(value, fallback);
    const maxHeartbeat = Math.max(1, Math.floor(timeoutMs / 2));

    return Math.min(requested, maxHeartbeat);
}
