import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';
import type { AnalysisRequestedEvent, AnalysisJob, Demographics, ThirdPartyApiResponse } from '@senior-challenge/shared-types';
import type { MessageProcessor } from './processor.interface';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/analysis_db';
const FAILED_RECORDS_DIR = 'failed-records';
const CANONICAL_AGE_RANGES = new Set(['under-18', '18-24', '25-34', '35-44', '45-54', '55+']);
const ALLOWED_GENDERS = new Set(['male', 'female', 'other', 'non-binary']);

interface ValidationIssue {
    field: string;
    value: unknown;
    reason: string;
}

class ThirdPartyValidationError extends Error {
    constructor(readonly issues: ValidationIssue[]) {
        super('Third-party API response failed validation');
        this.name = 'ThirdPartyValidationError';
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
    private connection: mongoose.Connection | null = null;
    private readonly ready: Promise<void>;

    constructor() {
        this.ready = this.initializeDatabase();
    }

    private async initializeDatabase(): Promise<void> {
        try {
            await mongoose.connect(MONGODB_URI);
            this.connection = mongoose.connection;
            console.log('Connected to MongoDB');
        } catch (error) {
            console.log('DB connection failed');
        }
    }

    /**
     * Processes an analysis request from the message queue.
     * Fetches data from the third-party API, transforms it, and saves the results.
     */
    async process(event: AnalysisRequestedEvent): Promise<void> {
        await this.ready;

        const { jobId, dataUrl, traceId } = event;
        const traceIdForLog = traceId ?? null;
        let apiResponse: ThirdPartyApiResponse | undefined;

        console.log('Processing job: ' + jobId);

        try {
            // Update status to PROCESSING
            await this.updateJobStatus(jobId, 'PROCESSING');

            // Call third-party API for full analysis
            apiResponse = await this.callThirdPartyApi(dataUrl);

            // Transform API response to our internal format
            const demographics = this.transformApiResponse(apiResponse, {
                jobId,
                traceId: traceIdForLog,
            });

            // Save the analysis results
            await this.updateJobWithResults(jobId, demographics);

            console.log('Job completed: ' + jobId);
        } catch (error) {
            this.logEvent('error', 'analysis_job_failed', {
                jobId,
                traceId: traceIdForLog,
                errorName: (error as Error).name,
                message: (error as Error).message,
                validationIssues: error instanceof ThirdPartyValidationError ? error.issues : undefined,
            });
            await this.writeFailedRecord(event, error as Error, apiResponse);
            await this.updateJobStatus(jobId, 'FAILED');
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
            const numeric = Number(value);
            if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 1) {
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

    private async updateJobStatus(jobId: string, status: string): Promise<void> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) return;

        await collection.updateOne(
            { jobId },
            { $set: { status, updatedAt: new Date().toISOString() } },
        );
    }

    private async updateJobWithResults(jobId: string, demographics: Demographics): Promise<void> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) return;

        await collection.updateOne(
            { jobId },
            {
                $set: {
                    status: 'COMPLETED',
                    demographics,
                    updatedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                },
            },
        );
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
