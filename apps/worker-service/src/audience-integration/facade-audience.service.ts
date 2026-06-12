/**
 * Facade Service - wraps third-party Audience API calls.
 *
 * Handles Playwright browser context management, authentication,
 * and data extraction from the audience analytics provider.
 */

import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, BrowserContext } from 'playwright';
import { MockAuthPool } from './mock-auth-pool';

export type AudiencePlatform = 'instagram' | 'tiktok';
const FAILED_RECORDS_DIR = 'failed-records';

interface AudienceMetric {
    label: string;
    value: number;
}

export interface AudiencePayload {
    gender?: AudienceMetric[];
    age?: AudienceMetric[];
    geography?: {
        countries?: Array<{ name: string; code: string; percentage: number }>;
    };
}

type AudienceCountry = NonNullable<NonNullable<AudiencePayload['geography']>['countries']>[number];

interface AudienceExtractor {
    name: string;
    extract: (response: unknown) => AudiencePayload | null;
}

const AUDIENCE_EXTRACTORS: AudienceExtractor[] = [
    {
        name: 'standard-v1',
        extract: (response) => {
            const root = asRecord(response);
            const data = asRecord(root?.data);
            return toAudiencePayload(data?.audience);
        },
    },
    {
        name: 'legacy-demographics',
        extract: (response) => {
            const root = asRecord(response);
            const audienceData = asRecord(root?.audience_data);
            return toAudiencePayload(audienceData?.demographics);
        },
    },
];

export class FacadeAudienceService {
    private authPool: MockAuthPool;
    private sharedBrowser: Browser | null = null;

    constructor() {
        this.authPool = new MockAuthPool();
    }

    /**
     * Fetches audience demographic data via Playwright browser context.
     *
     * @param mediaType - audience platform identifier
     * @param mediaId - The media/influencer ID to query
     * @param context - Optional shared browser context for batch operations
     */
    async getAudienceV1ByPlaywright(
        mediaType: AudiencePlatform,
        mediaId: string,
        context?: BrowserContext,
    ): Promise<AudiencePayload | null> {
        const url = `http://localhost:3001/api/v1/audience?media_type=${mediaType}&media_id=${mediaId}`;
        const traceId = this.createTraceId(mediaType, mediaId);
        let browser: Browser | null = null;
        let shouldCloseBrowser = false;

        try {
            // Acquire authentication credentials from the pool
            const auth = await this.authPool.getNextAuth();
            const token = await this.authPool.getToken(auth);

            this.logEvent('info', 'audience_fetch_started', {
                traceId,
                mediaType,
                mediaId,
            });

            // Create a new browser context if none was provided
            if (!context) {
                browser = await chromium.launch({ headless: true });
                context = await browser.newContext();
                shouldCloseBrowser = true;
            }

            // Make the API request through the browser context
            const response = await context.request.get(url, {
                headers: {
                    'authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            const audienceData = await response.json();

            // Validate API response status
            if (audienceData.status !== 'success') {
                this.logEvent('warn', 'audience_api_non_success_status', {
                    traceId,
                    mediaType,
                    mediaId,
                    status: audienceData.status,
                    topLevelKeys: topLevelKeys(audienceData),
                });
                await this.writeUnknownShapeFailedPayload({
                    traceId,
                    mediaType,
                    mediaId,
                    response: audienceData,
                    reason: 'API returned non-success status',
                });
                return null;
            }

            this.logEvent('info', 'audience_api_response_received', {
                traceId,
                mediaType,
                mediaId,
                topLevelKeys: topLevelKeys(audienceData),
            });

            // Extract audience demographics from response
            const extracted = this.extractAudienceData(audienceData, mediaType, mediaId, traceId);

            if (!extracted) {
                this.logEvent('warn', 'audience_unknown_response_shape', {
                    traceId,
                    mediaType,
                    mediaId,
                    topLevelKeys: topLevelKeys(audienceData),
                    triedExtractors: AUDIENCE_EXTRACTORS.map((extractor) => extractor.name),
                });
                await this.writeUnknownShapeFailedPayload({
                    traceId,
                    mediaType,
                    mediaId,
                    response: audienceData,
                    reason: 'Audience data could not be extracted by known response-shape adapters',
                });
            }

            return extracted;

        } catch (error) {
            this.logEvent('error', 'audience_fetch_failed', {
                traceId,
                mediaType,
                mediaId,
                errorName: (error as Error).name,
                message: (error as Error).message,
            });
            throw error;
        } finally {
            if (shouldCloseBrowser && browser) {
                await browser.close();
                this.logEvent('info', 'audience_browser_closed', {
                    traceId,
                    mediaType,
                    mediaId,
                });
            }
        }
    }

    /**
     * Batch fetch audience data for multiple media IDs.
     * Uses Promise.all for concurrent requests.
     */
    async batchGetAudience(requests: Array<{ mediaType: AudiencePlatform; mediaId: string }>) {
        this.logEvent('info', 'audience_batch_fetch_started', {
            requestCount: requests.length,
        });

        const results = await Promise.all(
            requests.map(req =>
                this.getAudienceV1ByPlaywright(req.mediaType, req.mediaId)
            )
        );

        const successCount = results.filter(r => r !== null).length;
        this.logEvent('info', 'audience_batch_fetch_completed', {
            requestCount: requests.length,
            successCount,
        });

        return results;
    }

    async cleanup() {
        if (this.sharedBrowser) {
            await this.sharedBrowser.close();
        }
    }

    private extractAudienceData(
        response: unknown,
        mediaType: AudiencePlatform,
        mediaId: string,
        traceId: string,
    ): AudiencePayload | null {
        for (const extractor of AUDIENCE_EXTRACTORS) {
            const extracted = extractor.extract(response);
            if (extracted) {
                this.logEvent('info', 'audience_response_extracted', {
                    traceId,
                    mediaType,
                    mediaId,
                    extractor: extractor.name,
                });
                return extracted;
            }
        }

        return null;
    }

    private async writeUnknownShapeFailedPayload(input: {
        traceId: string;
        mediaType: AudiencePlatform;
        mediaId: string;
        response: unknown;
        reason: string;
    }): Promise<void> {
        try {
            const rootDir = findRepositoryRoot(process.cwd());
            const failedDir = path.join(rootDir, FAILED_RECORDS_DIR);
            fs.mkdirSync(failedDir, { recursive: true });

            const timestamp = new Date().toISOString();
            const filepath = path.join(
                failedDir,
                `audience-${input.mediaType}-${sanitizeForFilename(input.mediaId)}-${formatTimestampForFilename(timestamp)}.json`,
            );

            const failedPayload = {
                failedAt: timestamp,
                source: 'worker-service:audience-facade',
                traceId: input.traceId,
                mediaType: input.mediaType,
                mediaId: input.mediaId,
                reason: input.reason,
                topLevelKeys: topLevelKeys(input.response),
                triedExtractors: AUDIENCE_EXTRACTORS.map((extractor) => extractor.name),
                rawResponse: redactForFailedRecord(input.response),
            };

            fs.writeFileSync(filepath, JSON.stringify(failedPayload, null, 2));
            this.logEvent('warn', 'audience_failed_payload_saved', {
                traceId: input.traceId,
                mediaType: input.mediaType,
                mediaId: input.mediaId,
                filepath,
            });
        } catch (error) {
            this.logEvent('error', 'audience_failed_payload_write_failed', {
                traceId: input.traceId,
                mediaType: input.mediaType,
                mediaId: input.mediaId,
                errorName: (error as Error).name,
                message: (error as Error).message,
            });
        }
    }

    private createTraceId(mediaType: AudiencePlatform, mediaId: string): string {
        return `audience-${mediaType}-${sanitizeForFilename(mediaId)}-${Date.now()}`;
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

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    return value as Record<string, unknown>;
}

function toAudiencePayload(value: unknown): AudiencePayload | null {
    const record = asRecord(value);
    if (!record) {
        return null;
    }

    const payload: AudiencePayload = {};
    const gender = toMetricArray(record.gender);
    const age = toMetricArray(record.age);
    const geography = toGeography(record.geography);

    if (gender) {
        payload.gender = gender;
    }

    if (age) {
        payload.age = age;
    }

    if (geography) {
        payload.geography = geography;
    }

    if (payload.gender || payload.age || payload.geography) {
        return payload;
    }

    return null;
}

function toMetricArray(value: unknown): AudienceMetric[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const metrics = value.map((item): AudienceMetric | null => {
        const record = asRecord(item);
        const numericValue = toNonNegativeNumber(record?.value);
        if (typeof record?.label !== 'string' || record.label.trim().length === 0 || numericValue === null) {
            return null;
        }

        return {
            label: record.label.trim(),
            value: numericValue,
        };
    }).filter((metric): metric is AudienceMetric => metric !== null);

    return metrics.length > 0 ? metrics : null;
}

function toGeography(value: unknown): AudiencePayload['geography'] | null {
    const geography = asRecord(value);
    if (!geography || !Array.isArray(geography.countries)) {
        return null;
    }

    const countries = geography.countries.map((item): AudienceCountry | null => {
        const record = asRecord(item);
        const percentage = toNonNegativeNumber(record?.percentage);
        if (typeof record?.name !== 'string'
            || record.name.trim().length === 0
            || typeof record.code !== 'string'
            || record.code.trim().length === 0
            || percentage === null) {
            return null;
        }

        return {
            name: record.name.trim(),
            code: record.code.trim(),
            percentage,
        };
    }).filter((country): country is AudienceCountry => country !== null);

    return countries.length > 0 ? { countries } : null;
}

function toNonNegativeNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return null;
        }

        const numeric = Number(trimmed);
        return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    }

    return null;
}

function topLevelKeys(value: unknown): string[] {
    const record = asRecord(value);
    return record ? Object.keys(record) : [];
}

function redactForFailedRecord(value: unknown): unknown {
    const redacted = JSON.parse(JSON.stringify(value, (key, nestedValue: unknown) => {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.includes('token')
            || normalizedKey.includes('authorization')
            || normalizedKey.includes('password')
            || normalizedKey.includes('secret')) {
            return '[REDACTED]';
        }

        if (typeof nestedValue === 'string' && nestedValue.length > 1000) {
            return `${nestedValue.slice(0, 1000)}...[TRUNCATED]`;
        }

        return nestedValue;
    })) as unknown;

    const json = JSON.stringify(redacted);
    if (json.length > 12000) {
        return {
            truncated: true,
            preview: `${json.slice(0, 12000)}...[TRUNCATED]`,
        };
    }

    return redacted;
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

function sanitizeForFilename(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function formatTimestampForFilename(value: string): string {
    return value.replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
}
